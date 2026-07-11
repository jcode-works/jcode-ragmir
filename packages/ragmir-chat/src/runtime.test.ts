import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  CHAT_CONTEXT_SIZE,
  type ChatGenerationEvent,
  inspectNodeLlamaRuntime,
  LITE_CHAT_CONTEXT_SIZE,
  NodeLlamaChatRuntime,
} from "./index.js"

const state = vi.hoisted(() => ({
  getLlamaCalls: 0,
  loadModelCalls: 0,
  createContextCalls: 0,
  sessionCalls: 0,
  llamaDisposeCalls: 0,
  modelDisposeCalls: 0,
  contextDisposeCalls: 0,
  sequenceDisposeCalls: 0,
  getLlamaOptions: [] as unknown[],
  modelOptions: [] as unknown[],
  contextOptions: [] as unknown[],
  wrapperOptions: [] as unknown[],
  resolvedWrapperCalls: 0,
  histories: [] as unknown[],
  prompts: [] as unknown[],
  promptOptions: [] as unknown[],
  selectedGpu: "metal" as "metal" | "cuda" | "vulkan" | false,
  supportedGpuTypes: ["metal"] as Array<"metal" | "cuda" | "vulkan" | false>,
  visibleAnswer: "Visible answer [1].",
}))

vi.mock("node-llama-cpp", () => {
  class Gemma4ChatWrapper {
    readonly reasoning: boolean

    constructor(options: { reasoning?: boolean; keepOnlyLastThought?: boolean } = {}) {
      this.reasoning = options.reasoning ?? true
      state.wrapperOptions.push(options)
    }
  }

  class AutoChatWrapper {
    readonly reasoning = false
  }

  class LlamaChatSession {
    private readonly reasoning: boolean

    constructor(options: { chatWrapper: { reasoning?: boolean } }) {
      state.sessionCalls += 1
      this.reasoning = options.chatWrapper.reasoning === true
    }

    setChatHistory(history: unknown[]): void {
      state.histories.push(history)
    }

    async promptWithMeta(prompt: string, options: Record<string, unknown>) {
      state.prompts.push(prompt)
      state.promptOptions.push(options)
      const onResponseChunk = options.onResponseChunk
      const onTextChunk = options.onTextChunk
      if (this.reasoning && typeof onResponseChunk === "function") {
        onResponseChunk({
          type: "segment",
          segmentType: "thought",
          text: "PRIVATE CHAIN OF THOUGHT",
          tokens: [1, 2],
          segmentStartTime: new Date(),
        })
        onResponseChunk({
          type: "segment",
          segmentType: "thought",
          text: "MORE PRIVATE REASONING",
          tokens: [3],
          segmentEndTime: new Date(),
        })
      }
      if (typeof onTextChunk === "function") {
        onTextChunk(state.visibleAnswer)
      }
      return {
        response: [
          {
            type: "segment",
            segmentType: "thought",
            text: "PRIVATE CHAIN OF THOUGHT",
            ended: true,
          },
          state.visibleAnswer,
        ],
        responseText: state.visibleAnswer,
        stopReason: "eogToken",
        remainingGenerationAfterStop: undefined,
      }
    }

    dispose(): void {}
  }

  return {
    Gemma4ChatWrapper,
    getLlamaGpuTypes: async () => state.supportedGpuTypes,
    LlamaChatSession,
    LlamaLogLevel: { error: "error" },
    resolveChatWrapper: () => {
      state.resolvedWrapperCalls += 1
      return new AutoChatWrapper()
    },
    getLlama: async (options: unknown) => {
      state.getLlamaCalls += 1
      state.getLlamaOptions.push(options)
      return {
        gpu: state.selectedGpu,
        loadModel: async (modelOptions: unknown) => {
          state.loadModelCalls += 1
          state.modelOptions.push(modelOptions)
          return {
            createContext: async (contextOptions: unknown) => {
              state.createContextCalls += 1
              state.contextOptions.push(contextOptions)
              return {
                getSequence: () => ({
                  dispose: () => {
                    state.sequenceDisposeCalls += 1
                  },
                }),
                dispose: async () => {
                  state.contextDisposeCalls += 1
                },
              }
            },
            dispose: async () => {
              state.modelDisposeCalls += 1
            },
          }
        },
        dispose: async () => {
          state.llamaDisposeCalls += 1
        },
      }
    },
  }
})

beforeEach(() => {
  state.getLlamaCalls = 0
  state.loadModelCalls = 0
  state.createContextCalls = 0
  state.sessionCalls = 0
  state.llamaDisposeCalls = 0
  state.modelDisposeCalls = 0
  state.contextDisposeCalls = 0
  state.sequenceDisposeCalls = 0
  state.getLlamaOptions.splice(0)
  state.modelOptions.splice(0)
  state.contextOptions.splice(0)
  state.wrapperOptions.splice(0)
  state.resolvedWrapperCalls = 0
  state.histories.splice(0)
  state.prompts.splice(0)
  state.promptOptions.splice(0)
  state.selectedGpu = "metal"
  state.supportedGpuTypes = ["metal"]
  state.visibleAnswer = "Visible answer [1]."
})

describe("NodeLlamaChatRuntime", () => {
  it("should report the selected platform backend", async () => {
    await expect(inspectNodeLlamaRuntime()).resolves.toMatchObject({
      nodeLlamaAvailable: true,
      platform: process.platform,
      arch: process.arch,
      supportedBackends: ["metal"],
      selectedBackend: "metal",
      hardwareAcceleration: true,
    })
  })

  it.each([
    { gpu: "cuda" as const, backend: "cuda" as const },
    { gpu: "vulkan" as const, backend: "vulkan" as const },
    { gpu: false as const, backend: "cpu" as const },
  ])("should normalize the $backend packaged backend", async ({ gpu, backend }) => {
    state.selectedGpu = gpu
    state.supportedGpuTypes = gpu === false ? [] : [gpu]

    await expect(inspectNodeLlamaRuntime()).resolves.toMatchObject({
      nodeLlamaAvailable: true,
      supportedBackends: [backend],
      selectedBackend: backend,
      hardwareAcceleration: backend !== "cpu",
    })
  })

  it("should load the optimized Gemma runtime once and never expose thought text", async () => {
    const runtime = new NodeLlamaChatRuntime({
      profile: "fast",
      modelId: "google/gemma-4-E2B-it-qat-q4_0-gguf",
      modelFile: "/local/model.gguf",
    })
    const events: ChatGenerationEvent[] = []
    const messages = [
      { role: "system" as const, content: "System guard." },
      { role: "user" as const, content: "Earlier question." },
      { role: "assistant" as const, content: "Earlier visible answer [1]." },
      { role: "user" as const, content: "Current question and evidence." },
    ]

    const first = await runtime.generate({
      messages,
      thinking: "standard",
      maxNewTokens: 100,
      onEvent: (event) => events.push(event),
    })
    const second = await runtime.generate({
      messages,
      thinking: "off",
      maxNewTokens: 80,
    })
    const third = await runtime.generate({
      messages,
      thinking: "deep",
      maxNewTokens: 1_500,
    })

    expect(first).toEqual({
      answer: "Visible answer [1].",
      stopReason: "eogToken",
      thoughtTokens: 3,
    })
    expect(second.thoughtTokens).toBe(0)
    expect(third.thoughtTokens).toBe(3)
    expect(JSON.stringify(events)).not.toContain("PRIVATE")
    expect(events.filter((event) => event.type === "reasoning")).toEqual([
      { type: "reasoning", active: true, thoughtTokens: 0 },
      { type: "reasoning", active: false, thoughtTokens: 3 },
    ])
    expect(events.filter((event) => event.type === "delta")).toEqual([
      { type: "delta", text: "Visible answer [1]." },
    ])
    expect(state.getLlamaCalls).toBe(1)
    expect(state.loadModelCalls).toBe(1)
    expect(state.createContextCalls).toBe(1)
    expect(state.sessionCalls).toBe(3)
    expect(state.getLlamaOptions[0]).toMatchObject({
      gpu: "auto",
      build: "never",
      skipDownload: true,
      progressLogs: "stderr",
      logLevel: "error",
    })
    expect(state.modelOptions[0]).toEqual({
      modelPath: "/local/model.gguf",
      gpuLayers: "auto",
      useMmap: "auto",
      defaultContextFlashAttention: true,
    })
    expect(state.contextOptions[0]).toEqual({
      contextSize: CHAT_CONTEXT_SIZE,
      sequences: 1,
      flashAttention: true,
    })
    expect(state.wrapperOptions).toEqual([
      { reasoning: true, keepOnlyLastThought: true },
      { reasoning: false, keepOnlyLastThought: true },
      { reasoning: true, keepOnlyLastThought: true },
    ])
    expect(state.promptOptions[0]).toMatchObject({
      maxTokens: 356,
      temperature: 1,
      topP: 0.95,
      topK: 64,
      budgets: { thoughtTokens: 256 },
    })
    expect(state.promptOptions[1]).toMatchObject({
      maxTokens: 80,
      budgets: { thoughtTokens: 0 },
    })
    expect(state.promptOptions[2]).toMatchObject({
      maxTokens: 2_048,
      budgets: { thoughtTokens: 768 },
    })
    expect(state.histories[0]).toEqual([
      { type: "system", text: "System guard." },
      { type: "user", text: "Earlier question." },
      { type: "model", response: ["Earlier visible answer [1]."] },
    ])
    expect(state.prompts[0]).toBe("Current question and evidence.")

    await runtime.dispose()
    expect(state.sequenceDisposeCalls).toBe(1)
    expect(state.contextDisposeCalls).toBe(1)
    expect(state.modelDisposeCalls).toBe(1)
    expect(state.llamaDisposeCalls).toBe(1)
  })

  it("should reject an empty visible answer", async () => {
    state.visibleAnswer = "   "
    const runtime = new NodeLlamaChatRuntime({
      profile: "fast",
      modelId: "google/gemma-4-E2B-it-qat-q4_0-gguf",
      modelFile: "/local/model.gguf",
    })

    await expect(
      runtime.generate({
        messages: [{ role: "user", content: "Current question and evidence." }],
        thinking: "off",
        maxNewTokens: 100,
      }),
    ).rejects.toThrow("The local chat model returned an empty visible answer.")

    await runtime.dispose()
  })

  it("should use the automatic wrapper and smaller context for the lite profile", async () => {
    const runtime = new NodeLlamaChatRuntime({
      profile: "lite",
      modelId: "Qwen/Qwen2.5-0.5B-Instruct-GGUF",
      modelFile: "/local/lite.gguf",
    })

    const result = await runtime.generate({
      messages: [{ role: "user", content: "Current question and evidence." }],
      thinking: "deep",
      maxNewTokens: 2_000,
    })

    expect(result).toEqual({
      answer: "Visible answer [1].",
      stopReason: "eogToken",
      thoughtTokens: 0,
    })
    expect(state.resolvedWrapperCalls).toBe(1)
    expect(state.wrapperOptions).toEqual([])
    expect(state.contextOptions[0]).toEqual({
      contextSize: LITE_CHAT_CONTEXT_SIZE,
      sequences: 1,
      flashAttention: true,
    })
    expect(state.promptOptions[0]).toMatchObject({
      maxTokens: 512,
      temperature: 0.2,
      topP: 0.8,
      topK: 20,
      seed: 42,
      repeatPenalty: { lastTokens: 64, penalty: 1.15, penalizeNewLine: false },
      budgets: { thoughtTokens: 0 },
    })

    await runtime.dispose()
  })
})
