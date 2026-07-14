import path from "node:path"
import type {
  ChatHistoryItem,
  Llama,
  LlamaContext,
  LlamaContextSequence,
  LlamaGpuType,
  LlamaModel,
} from "node-llama-cpp"
import {
  chatModelDefinition,
  chatModelProfile,
  DEFAULT_CHAT_MODEL_PATH,
  DEFAULT_CHAT_PROFILE,
  inspectChatModel,
  resolveChatModelPaths,
} from "./profiles.js"
import type {
  ChatComputeBackend,
  ChatGenerationEvent,
  ChatMessage,
  ChatModelProfile,
  ChatRuntime,
  ChatRuntimeGenerationOptions,
  ChatRuntimeGenerationResult,
  ChatRuntimeInspection,
  ChatThinkingMode,
} from "./types.js"

export const CHAT_CONTEXT_SIZE = chatModelDefinition(DEFAULT_CHAT_PROFILE).contextSize
export const LITE_CHAT_CONTEXT_SIZE = chatModelDefinition("lite").contextSize
export const MAX_CHAT_GENERATION_TOKENS =
  chatModelDefinition(DEFAULT_CHAT_PROFILE).maxGenerationTokens
export const CHAT_THOUGHT_TOKEN_BUDGETS = {
  off: 0,
  standard: 256,
  deep: 768,
} satisfies Record<ChatThinkingMode, number>

type NodeLlamaCppModule = typeof import("node-llama-cpp")

export interface CreateChatRuntimeOptions {
  cwd?: string
  profile?: ChatModelProfile
  modelPath?: string
}

export interface ChatRuntimeDependencies {
  loadNodeLlama?: () => Promise<unknown>
}

export class NodeLlamaChatRuntime implements ChatRuntime {
  readonly profile: ChatModelProfile
  readonly modelId: string
  readonly modelFile: string

  private readonly loadNodeLlama: () => Promise<NodeLlamaCppModule>
  private nodeLlama: NodeLlamaCppModule | null = null
  private llama: Llama | null = null
  private model: LlamaModel | null = null
  private context: LlamaContext | null = null
  private sequence: LlamaContextSequence | null = null
  private loading: Promise<void> | null = null
  private activeController: AbortController | null = null
  private activeGeneration: Promise<ChatRuntimeGenerationResult> | null = null
  private disposed = false

  constructor(
    options: { profile: ChatModelProfile; modelId: string; modelFile: string },
    dependencies: ChatRuntimeDependencies = {},
  ) {
    this.profile = options.profile
    this.modelId = options.modelId
    this.modelFile = options.modelFile
    this.loadNodeLlama = dependencies.loadNodeLlama
      ? validatedNodeLlamaLoader(dependencies.loadNodeLlama)
      : defaultNodeLlamaLoader
  }

  async generate(options: ChatRuntimeGenerationOptions): Promise<ChatRuntimeGenerationResult> {
    if (this.disposed) {
      throw new Error("The local chat runtime has been disposed.")
    }
    if (this.activeGeneration !== null) {
      throw new Error("A local chat generation is already running.")
    }

    const linkedAbort = linkedAbortController(options.signal)
    const controller = linkedAbort.controller
    this.activeController = controller
    const generation = this.runGeneration(options, controller)
    this.activeGeneration = generation

    try {
      return await generation
    } finally {
      if (this.activeGeneration === generation) {
        this.activeGeneration = null
        this.activeController = null
      }
      linkedAbort.unlink()
    }
  }

  cancel(reason?: unknown): void {
    this.activeController?.abort(reason ?? new Error("Chat generation cancelled."))
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.cancel(new Error("Chat runtime disposed."))
    await this.activeGeneration?.catch(() => undefined)
    this.sequence?.dispose()
    this.sequence = null
    await this.context?.dispose()
    this.context = null
    await this.model?.dispose()
    this.model = null
    await this.llama?.dispose()
    this.llama = null
    this.nodeLlama = null
  }

  private async runGeneration(
    options: ChatRuntimeGenerationOptions,
    controller: AbortController,
  ): Promise<ChatRuntimeGenerationResult> {
    await this.ensureLoaded(options.onEvent)
    const nodeLlama = this.nodeLlama
    const model = this.model
    const sequence = this.sequence
    if (nodeLlama === null || model === null || sequence === null) {
      throw new Error("The local chat runtime did not initialize correctly.")
    }

    const { history, prompt } = splitMessages(options.messages)
    const definition = chatModelDefinition(this.profile)
    const thinking = definition.supportsThinking ? options.thinking : "off"
    const thoughtBudget = CHAT_THOUGHT_TOKEN_BUDGETS[thinking]
    const chatWrapper =
      definition.family === "gemma4"
        ? new nodeLlama.Gemma4ChatWrapper({
            reasoning: thinking !== "off",
            keepOnlyLastThought: true,
          })
        : nodeLlama.resolveChatWrapper(model)
    const session = new nodeLlama.LlamaChatSession({
      contextSequence: sequence,
      chatWrapper,
      autoDisposeSequence: false,
    })
    session.setChatHistory(history)

    let partialAnswer = ""
    let thoughtTokens = 0
    let reasoningActive = false

    try {
      const { responseText, stopReason } = await session.promptWithMeta(prompt, {
        signal: controller.signal,
        stopOnAbortSignal: true,
        maxTokens: Math.min(options.maxNewTokens + thoughtBudget, definition.maxGenerationTokens),
        temperature: definition.temperature,
        topP: definition.topP,
        topK: definition.topK,
        ...(definition.seed === undefined ? {} : { seed: definition.seed }),
        ...(definition.repeatPenalty === undefined
          ? {}
          : {
              repeatPenalty: {
                lastTokens: 64,
                penalty: definition.repeatPenalty,
                penalizeNewLine: false,
              },
            }),
        budgets: { thoughtTokens: thoughtBudget },
        trimWhitespaceSuffix: true,
        onTextChunk: (text) => {
          if (text.length === 0) return
          partialAnswer += text
          options.onEvent?.({ type: "delta", text })
        },
        onResponseChunk: (chunk) => {
          if (chunk.type !== "segment" || chunk.segmentType !== "thought") return
          if (!reasoningActive) {
            reasoningActive = true
            emitReasoning(options.onEvent, true, thoughtTokens)
          }
          thoughtTokens += chunk.tokens.length
          if (chunk.segmentEndTime !== undefined) {
            reasoningActive = false
            emitReasoning(options.onEvent, false, thoughtTokens)
          }
        },
      })

      if (reasoningActive) {
        emitReasoning(options.onEvent, false, thoughtTokens)
      }
      const answer = responseText.trim() || partialAnswer.trim()
      if (!answer) {
        throw new Error("The local chat model returned an empty visible answer.")
      }
      return {
        answer,
        stopReason,
        thoughtTokens,
      }
    } catch (error) {
      if (controller.signal.aborted) {
        if (reasoningActive) {
          emitReasoning(options.onEvent, false, thoughtTokens)
        }
        return {
          answer: partialAnswer.trim(),
          stopReason: "abort",
          thoughtTokens,
        }
      }
      throw error
    } finally {
      session.dispose({ disposeSequence: false })
    }
  }

  private async ensureLoaded(onEvent?: (event: ChatGenerationEvent) => void): Promise<void> {
    if (this.sequence !== null) return
    if (this.loading !== null) {
      await this.loading
      return
    }

    onEvent?.({
      type: "loading",
      active: true,
      profile: this.profile,
      model: this.modelId,
    })
    this.loading = this.load()
    try {
      await this.loading
    } finally {
      this.loading = null
      onEvent?.({
        type: "loading",
        active: false,
        profile: this.profile,
        model: this.modelId,
      })
    }
  }

  private async load(): Promise<void> {
    const nodeLlama = await this.loadNodeLlama()
    const llama = await getOfflineLlama(nodeLlama)
    const definition = chatModelDefinition(this.profile)
    try {
      const model = await llama.loadModel({
        modelPath: this.modelFile,
        gpuLayers: "auto",
        useMmap: "auto",
        defaultContextFlashAttention: true,
      })
      try {
        const context = await model.createContext({
          contextSize: definition.contextSize,
          sequences: 1,
          flashAttention: true,
        })
        this.nodeLlama = nodeLlama
        this.llama = llama
        this.model = model
        this.context = context
        this.sequence = context.getSequence()
      } catch (error) {
        await model.dispose()
        throw error
      }
    } catch (error) {
      await llama.dispose()
      throw error
    }
  }
}

export async function createChatRuntime(
  options: CreateChatRuntimeOptions = {},
  dependencies: ChatRuntimeDependencies = {},
): Promise<NodeLlamaChatRuntime> {
  const cwd = path.resolve(options.cwd ?? process.cwd())
  const profile = chatModelProfile(options.profile ?? DEFAULT_CHAT_PROFILE)
  const modelPath =
    options.modelPath ?? process.env.RAGMIR_CHAT_MODEL_PATH ?? DEFAULT_CHAT_MODEL_PATH
  const definition = chatModelDefinition(profile)
  const paths = resolveChatModelPaths(cwd, modelPath, profile)
  const inspection = await inspectChatModel(paths, definition)
  if (!inspection.ready) {
    throw new Error(
      `Local chat profile ${profile} is not ready locally. Run \`rgr-chat setup --profile ${profile}\` while online first.`,
    )
  }

  return new NodeLlamaChatRuntime(
    { profile, modelId: definition.modelId, modelFile: paths.modelFile },
    dependencies,
  )
}

export async function isNodeLlamaAvailable(): Promise<boolean> {
  return (await inspectNodeLlamaRuntime()).nodeLlamaAvailable
}

export async function inspectNodeLlamaRuntime(): Promise<ChatRuntimeInspection> {
  const base = {
    platform: process.platform,
    arch: process.arch,
  }
  try {
    const nodeLlama = await defaultNodeLlamaLoader()
    const supportedGpuTypes = await nodeLlama
      .getLlamaGpuTypes("supported")
      .catch((): LlamaGpuType[] => [])
    const llama = await getOfflineLlama(nodeLlama)
    try {
      const selectedBackend = chatComputeBackend(llama.gpu)
      const supportedBackends = Array.from(
        new Set([...supportedGpuTypes.map(chatComputeBackend), selectedBackend]),
      )
      return {
        ...base,
        nodeLlamaAvailable: true,
        supportedBackends,
        selectedBackend,
        hardwareAcceleration: selectedBackend !== "cpu",
      }
    } finally {
      await llama.dispose()
    }
  } catch {
    return {
      ...base,
      nodeLlamaAvailable: false,
      supportedBackends: [],
      selectedBackend: null,
      hardwareAcceleration: false,
    }
  }
}

function splitMessages(messages: ChatMessage[]): { history: ChatHistoryItem[]; prompt: string } {
  const last = messages.at(-1)
  if (last?.role !== "user" || !last.content.trim()) {
    throw new Error("The final chat message must be a non-empty user prompt.")
  }

  const history = messages.slice(0, -1).map(toChatHistoryItem)
  return { history, prompt: last.content }
}

function toChatHistoryItem(message: ChatMessage): ChatHistoryItem {
  if (message.role === "system") {
    return { type: "system", text: message.content }
  }
  if (message.role === "user") {
    return { type: "user", text: message.content }
  }
  return { type: "model", response: [message.content] }
}

function linkedAbortController(signal?: AbortSignal): {
  controller: AbortController
  unlink: () => void
} {
  const controller = new AbortController()
  const abort = () => controller.abort(signal?.reason)
  if (signal?.aborted) {
    controller.abort(signal.reason)
  } else if (signal !== undefined) {
    signal.addEventListener("abort", abort, { once: true })
  }
  return {
    controller,
    unlink: () => signal?.removeEventListener("abort", abort),
  }
}

function emitReasoning(
  onEvent: ((event: ChatGenerationEvent) => void) | undefined,
  active: boolean,
  thoughtTokens: number,
): void {
  onEvent?.({ type: "reasoning", active, thoughtTokens })
}

async function defaultNodeLlamaLoader(): Promise<NodeLlamaCppModule> {
  return import("node-llama-cpp")
}

function validatedNodeLlamaLoader(
  loadNodeLlama: () => Promise<unknown>,
): () => Promise<NodeLlamaCppModule> {
  return async () => {
    const loaded = await loadNodeLlama()
    if (!isNodeLlamaCppModule(loaded)) {
      throw new Error("The injected node-llama-cpp module is invalid.")
    }
    return loaded
  }
}

function isNodeLlamaCppModule(value: unknown): value is NodeLlamaCppModule {
  if (typeof value !== "object" || value === null) return false
  return (
    "getLlama" in value &&
    typeof value.getLlama === "function" &&
    "getLlamaGpuTypes" in value &&
    typeof value.getLlamaGpuTypes === "function" &&
    "Gemma4ChatWrapper" in value &&
    typeof value.Gemma4ChatWrapper === "function" &&
    "resolveChatWrapper" in value &&
    typeof value.resolveChatWrapper === "function" &&
    "LlamaChatSession" in value &&
    typeof value.LlamaChatSession === "function" &&
    "LlamaLogLevel" in value &&
    typeof value.LlamaLogLevel === "object" &&
    value.LlamaLogLevel !== null &&
    "error" in value.LlamaLogLevel
  )
}

function chatComputeBackend(gpu: LlamaGpuType): ChatComputeBackend {
  return gpu === false ? "cpu" : gpu
}

async function getOfflineLlama(nodeLlama: NodeLlamaCppModule): Promise<Llama> {
  return nodeLlama.getLlama({
    gpu: "auto",
    build: "never",
    skipDownload: true,
    progressLogs: "stderr",
    logLevel: nodeLlama.LlamaLogLevel.error,
    logger: (_level, message) => {
      const normalized = message.endsWith("\n") ? message : `${message}\n`
      process.stderr.write(normalized)
    },
  })
}
