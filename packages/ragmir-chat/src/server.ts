import { createInterface } from "node:readline"
import type { Readable } from "node:stream"
import { DEFAULT_CHAT_THINKING, generateChatAnswer } from "./index.js"
import { chatModelProfile, DEFAULT_CHAT_PROFILE } from "./profiles.js"
import { type CreateChatRuntimeOptions, createChatRuntime } from "./runtime.js"
import type {
  ChatGenerationEvent,
  ChatHistoryMessage,
  ChatModelProfile,
  ChatRuntime,
  ChatSource,
  ChatThinkingMode,
  GenerateChatAnswerResult,
} from "./types.js"

const UNKNOWN_REQUEST_ID = "unknown"

export interface GenerateChatServerRequest {
  id: string
  type: "generate"
  question: string
  history?: ChatHistoryMessage[]
  sources: ChatSource[]
  thinking?: ChatThinkingMode
  maxNewTokens?: number
  contextCharLimit?: number
}

export interface CancelChatServerRequest {
  id: string
  type: "cancel"
  targetId: string
}

export interface ShutdownChatServerRequest {
  id: string
  type: "shutdown"
}

export type ChatServerRequest =
  | GenerateChatServerRequest
  | CancelChatServerRequest
  | ShutdownChatServerRequest

export type ChatServerEvent =
  | {
      id: string
      event: "loading"
      active: boolean
      profile: ChatModelProfile
      model: string
    }
  | {
      id: string
      event: "reasoning"
      active: boolean
      thoughtTokens: number
    }
  | {
      id: string
      event: "delta"
      text: string
    }
  | {
      id: string
      event: "completed"
      result: GenerateChatAnswerResult
    }
  | {
      id: string
      event: "cancelled"
      partialAnswer: string
    }
  | {
      id: string
      event: "error"
      code: "BUSY" | "GENERATION_FAILED" | "INVALID_REQUEST" | "NOT_FOUND"
      message: string
    }

export interface ServeChatOptions extends CreateChatRuntimeOptions {
  input?: Readable
  writeLine?: (line: string) => void
  createRuntime?: (options: CreateChatRuntimeOptions) => Promise<ChatRuntime>
}

interface ActiveGeneration {
  id: string
  controller: AbortController
  partialAnswer: string
}

export async function serveChat(options: ServeChatOptions = {}): Promise<void> {
  const input = options.input ?? process.stdin
  const writeLine = options.writeLine ?? ((line: string) => process.stdout.write(line))
  const profile = chatModelProfile(
    options.profile ?? process.env.RAGMIR_CHAT_PROFILE ?? DEFAULT_CHAT_PROFILE,
  )
  const readline = createInterface({ input, crlfDelay: Infinity })
  const state: {
    runtimePromise: Promise<ChatRuntime> | null
    active: ActiveGeneration | null
    activeTask: Promise<void> | null
  } = {
    runtimePromise: null,
    active: null,
    activeTask: null,
  }
  let shutdownRequested = false

  const emit = (event: ChatServerEvent): void => {
    writeLine(`${JSON.stringify(event)}\n`)
  }

  const getRuntime = (): Promise<ChatRuntime> => {
    if (state.runtimePromise === null) {
      const runtimeOptions: CreateChatRuntimeOptions = { profile }
      if (options.cwd !== undefined) runtimeOptions.cwd = options.cwd
      if (options.modelPath !== undefined) runtimeOptions.modelPath = options.modelPath
      state.runtimePromise = (options.createRuntime ?? createChatRuntime)(runtimeOptions).catch(
        (error) => {
          state.runtimePromise = null
          throw error
        },
      )
    }
    return state.runtimePromise
  }

  const startGeneration = (request: GenerateChatServerRequest): void => {
    if (state.active !== null) {
      emit({
        id: request.id,
        event: "error",
        code: "BUSY",
        message: "Another local chat generation is already running.",
      })
      return
    }

    const current: ActiveGeneration = {
      id: request.id,
      controller: new AbortController(),
      partialAnswer: "",
    }
    state.active = current
    state.activeTask = (async () => {
      try {
        const runtime = await getRuntime()
        const generationOptions: Parameters<typeof generateChatAnswer>[0] = {
          question: request.question,
          sources: request.sources,
          thinking: request.thinking ?? DEFAULT_CHAT_THINKING,
          runtime,
          signal: current.controller.signal,
          onEvent: (event: ChatGenerationEvent) => {
            if (event.type === "delta") {
              current.partialAnswer += event.text
            }
            emitRuntimeEvent(request.id, event, emit)
          },
          profile,
        }
        if (options.modelPath !== undefined) generationOptions.modelPath = options.modelPath
        if (request.maxNewTokens !== undefined) {
          generationOptions.maxNewTokens = request.maxNewTokens
        }
        if (request.contextCharLimit !== undefined) {
          generationOptions.contextCharLimit = request.contextCharLimit
        }
        if (request.history !== undefined) generationOptions.history = request.history
        const result = await generateChatAnswer(generationOptions)
        if (result.stopReason === "abort" || current.controller.signal.aborted) {
          emit({
            id: request.id,
            event: "cancelled",
            partialAnswer: result.answer || current.partialAnswer.trim(),
          })
          return
        }
        emit({ id: request.id, event: "completed", result })
      } catch {
        if (current.controller.signal.aborted) {
          emit({
            id: request.id,
            event: "cancelled",
            partialAnswer: current.partialAnswer.trim(),
          })
          return
        }
        emit({
          id: request.id,
          event: "error",
          code: "GENERATION_FAILED",
          message: "Local chat generation failed. Run `rgr-chat doctor` for diagnostics.",
        })
      } finally {
        if (state.active === current) {
          state.active = null
          state.activeTask = null
        }
      }
    })()
  }

  for await (const line of readline) {
    if (shutdownRequested || !line.trim()) continue

    const parsed = parseChatServerRequest(line)
    if (!parsed.ok) {
      emit({
        id: parsed.id,
        event: "error",
        code: "INVALID_REQUEST",
        message: parsed.message,
      })
      continue
    }

    const request = parsed.request
    if (request.type === "generate") {
      startGeneration(request)
      continue
    }
    if (request.type === "cancel") {
      if (state.active?.id !== request.targetId) {
        emit({
          id: request.id,
          event: "error",
          code: "NOT_FOUND",
          message: "No matching local chat generation is active.",
        })
        continue
      }
      state.active.controller.abort(new Error("Chat generation cancelled."))
      continue
    }

    shutdownRequested = true
    state.active?.controller.abort(new Error("Chat server shutting down."))
    readline.close()
  }

  await state.activeTask
  if (state.runtimePromise !== null) {
    const runtime = await state.runtimePromise.catch(() => null)
    await runtime?.dispose()
  }
}

export function parseChatServerRequest(
  line: string,
): { ok: true; request: ChatServerRequest } | { ok: false; id: string; message: string } {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return { ok: false, id: UNKNOWN_REQUEST_ID, message: "Request must be valid JSON." }
  }
  if (!isRecord(value)) {
    return { ok: false, id: UNKNOWN_REQUEST_ID, message: "Request must be a JSON object." }
  }

  if (typeof value.id !== "string" || value.id.trim() === "") {
    return {
      ok: false,
      id: UNKNOWN_REQUEST_ID,
      message: "Request requires non-empty `id` and `type` fields.",
    }
  }
  const id = value.id
  if (typeof value.type !== "string") {
    return { ok: false, id, message: "Request requires non-empty `id` and `type` fields." }
  }

  if (value.type === "cancel") {
    if (typeof value.targetId !== "string" || !value.targetId.trim()) {
      return { ok: false, id, message: "Cancel request requires a non-empty `targetId`." }
    }
    return { ok: true, request: { id, type: "cancel", targetId: value.targetId } }
  }
  if (value.type === "shutdown") {
    return { ok: true, request: { id, type: "shutdown" } }
  }
  if (value.type !== "generate") {
    return { ok: false, id, message: "Request `type` must be generate, cancel, or shutdown." }
  }
  if (typeof value.question !== "string" || !value.question.trim()) {
    return { ok: false, id, message: "Generate request requires a non-empty `question`." }
  }
  if (!Array.isArray(value.sources) || !value.sources.every(isChatSource)) {
    return { ok: false, id, message: "Generate request requires a valid `sources` array." }
  }
  if (value.history !== undefined && !isChatHistory(value.history)) {
    return { ok: false, id, message: "Generate request `history` is invalid." }
  }
  if (value.thinking !== undefined && !isThinkingMode(value.thinking)) {
    return { ok: false, id, message: "Generate request `thinking` must be off, standard, or deep." }
  }
  if (value.maxNewTokens !== undefined && !isPositiveInteger(value.maxNewTokens)) {
    return { ok: false, id, message: "Generate request `maxNewTokens` must be positive." }
  }
  if (value.contextCharLimit !== undefined && !isPositiveInteger(value.contextCharLimit)) {
    return { ok: false, id, message: "Generate request `contextCharLimit` must be positive." }
  }

  const request: GenerateChatServerRequest = {
    id,
    type: "generate",
    question: value.question,
    sources: value.sources,
  }
  if (value.history !== undefined) request.history = value.history
  if (value.thinking !== undefined) request.thinking = value.thinking
  if (value.maxNewTokens !== undefined) request.maxNewTokens = value.maxNewTokens
  if (value.contextCharLimit !== undefined) request.contextCharLimit = value.contextCharLimit
  return { ok: true, request }
}

function emitRuntimeEvent(
  id: string,
  event: ChatGenerationEvent,
  emit: (event: ChatServerEvent) => void,
): void {
  if (event.type === "loading") {
    emit({ id, event: "loading", active: event.active, profile: event.profile, model: event.model })
    return
  }
  if (event.type === "reasoning") {
    emit({ id, event: "reasoning", active: event.active, thoughtTokens: event.thoughtTokens })
    return
  }
  emit({ id, event: "delta", text: event.text })
}

function isChatSource(value: unknown): value is ChatSource {
  return (
    isRecord(value) &&
    typeof value.relativePath === "string" &&
    value.relativePath.trim() !== "" &&
    typeof value.chunkIndex === "number" &&
    Number.isSafeInteger(value.chunkIndex) &&
    value.chunkIndex >= 0 &&
    typeof value.text === "string" &&
    (value.source === undefined || typeof value.source === "string") &&
    (value.distance === undefined || value.distance === null || typeof value.distance === "number")
  )
}

function isChatHistory(value: unknown): value is ChatHistoryMessage[] {
  return (
    Array.isArray(value) &&
    value.every(
      (message) =>
        isRecord(message) &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string",
    )
  )
}

function isThinkingMode(value: unknown): value is ChatThinkingMode {
  return value === "off" || value === "standard" || value === "deep"
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
