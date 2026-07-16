import { PassThrough } from "node:stream"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  type ChatRuntime,
  type ChatServerEvent,
  parseChatServerRequest,
  serveChat,
} from "./index.js"

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("serveChat", () => {
  it("should emit strict NDJSON and reuse one runtime across completed turns", async () => {
    const input = new PassThrough()
    const output: string[] = []
    let createRuntimeCalls = 0
    let generateCalls = 0
    let disposeCalls = 0
    const runtime: ChatRuntime = {
      generate: async (options) => {
        generateCalls += 1
        if (generateCalls === 1) {
          options.onEvent?.({
            type: "loading",
            active: true,
            profile: "fast",
            model: "google/gemma-4-E2B-it-qat-q4_0-gguf",
          })
          options.onEvent?.({
            type: "loading",
            active: false,
            profile: "fast",
            model: "google/gemma-4-E2B-it-qat-q4_0-gguf",
          })
        }
        options.onEvent?.({ type: "reasoning", active: true, thoughtTokens: 0 })
        options.onEvent?.({ type: "reasoning", active: false, thoughtTokens: 8 })
        options.onEvent?.({ type: "delta", text: `Visible turn ${generateCalls} [1].` })
        return {
          answer: `Visible turn ${generateCalls} [1].`,
          stopReason: "eogToken",
          thoughtTokens: 8,
        }
      },
      cancel: vi.fn(),
      dispose: async () => {
        disposeCalls += 1
      },
    }
    const server = serveChat({
      input,
      writeLine: (line) => output.push(line),
      createRuntime: async () => {
        createRuntimeCalls += 1
        return runtime
      },
    })

    input.write(`${JSON.stringify(generateRequest("turn-1"))}\n`)
    await waitForEvent(output, "completed", 1)
    input.write(`${JSON.stringify(generateRequest("turn-2"))}\n`)
    await waitForEvent(output, "completed", 2)
    input.write(`${JSON.stringify({ id: "shutdown", type: "shutdown" })}\n`)
    input.end()
    await server

    const events = parseOutput(output)
    expect(createRuntimeCalls).toBe(1)
    expect(generateCalls).toBe(2)
    expect(disposeCalls).toBe(1)
    expect(events).toContainEqual(
      expect.objectContaining({ id: "turn-1", event: "loading", active: true }),
    )
    expect(events).toContainEqual({
      id: "turn-1",
      event: "reasoning",
      active: false,
      thoughtTokens: 8,
    })
    expect(events).toContainEqual({
      id: "turn-1",
      event: "delta",
      text: "Visible turn 1 [1].",
    })
    expect(events.filter((event) => event.event === "completed").map((event) => event.id)).toEqual([
      "turn-1",
      "turn-2",
    ])
    expect(
      events.filter((event) => event.event === "reasoning").every((event) => !("text" in event)),
    ).toBe(true)
    expect(output.every(isSingleJsonLine)).toBe(true)
  })

  it("should reject a concurrent turn with BUSY and cancel the target generation", async () => {
    const input = new PassThrough()
    const output: string[] = []
    const runtime: ChatRuntime = {
      generate: async (options) => {
        options.onEvent?.({ type: "reasoning", active: true, thoughtTokens: 4 })
        options.onEvent?.({ type: "delta", text: "Partial answer [1]" })
        return new Promise((resolve) => {
          const finish = () => {
            options.onEvent?.({ type: "reasoning", active: false, thoughtTokens: 4 })
            resolve({
              answer: "Partial answer [1]",
              stopReason: "abort",
              thoughtTokens: 4,
            })
          }
          if (options.signal?.aborted) finish()
          else options.signal?.addEventListener("abort", finish, { once: true })
        })
      },
      cancel: vi.fn(),
      dispose: vi.fn(async () => undefined),
    }
    const server = serveChat({
      input,
      writeLine: (line) => output.push(line),
      createRuntime: async () => runtime,
    })

    input.write(`${JSON.stringify(generateRequest("turn-active"))}\n`)
    await waitForEvent(output, "delta", 1)
    input.write(`${JSON.stringify(generateRequest("turn-busy"))}\n`)
    await waitForEvent(output, "error", 1)
    input.write(
      `${JSON.stringify({ id: "cancel-command", type: "cancel", targetId: "turn-active" })}\n`,
    )
    await waitForEvent(output, "cancelled", 1)
    input.write(`${JSON.stringify({ id: "shutdown", type: "shutdown" })}\n`)
    input.end()
    await server

    const events = parseOutput(output)
    expect(events).toContainEqual({
      id: "turn-busy",
      event: "error",
      code: "BUSY",
      message: "Another local chat generation is already running.",
    })
    expect(events).toContainEqual({
      id: "turn-active",
      event: "cancelled",
      partialAnswer: "Partial answer [1]",
    })
    expect(events).not.toContainEqual(
      expect.objectContaining({ id: "turn-active", event: "completed" }),
    )
    expect(output.every(isSingleJsonLine)).toBe(true)
  })

  it("should use the environment profile for both the runtime and result metadata", async () => {
    vi.stubEnv("RAGMIR_CHAT_PROFILE", "lite")
    const input = new PassThrough()
    const output: string[] = []
    let runtimeProfile: string | undefined
    let runtimeThinking: string | undefined
    const runtime: ChatRuntime = {
      generate: async (options) => {
        runtimeThinking = options.thinking
        options.onEvent?.({ type: "delta", text: "Visible answer [1]." })
        return {
          answer: "Visible answer [1].",
          stopReason: "eogToken",
          thoughtTokens: 0,
        }
      },
      cancel: vi.fn(),
      dispose: vi.fn(async () => undefined),
    }
    const server = serveChat({
      input,
      writeLine: (line) => output.push(line),
      createRuntime: async (options) => {
        runtimeProfile = options.profile
        return runtime
      },
    })

    input.write(`${JSON.stringify(generateRequest("turn-lite"))}\n`)
    await waitForEvent(output, "completed", 1)
    input.write(`${JSON.stringify({ id: "shutdown", type: "shutdown" })}\n`)
    input.end()
    await server

    const completed = parseOutput(output).find((event) => event.event === "completed")
    expect(runtimeProfile).toBe("lite")
    expect(runtimeThinking).toBe("off")
    expect(completed).toEqual(
      expect.objectContaining({
        id: "turn-lite",
        event: "completed",
        result: expect.objectContaining({ profile: "lite", thinking: "off" }),
      }),
    )
  })

  it("should dispose the runtime when writing a response fails", async () => {
    const input = new PassThrough()
    const dispose = vi.fn(async () => undefined)
    const runtime: ChatRuntime = {
      generate: async () => ({
        answer: "Visible answer [1].",
        stopReason: "eogToken",
        thoughtTokens: 0,
      }),
      cancel: vi.fn(),
      dispose,
    }
    const server = serveChat({
      input,
      writeLine: () => {
        throw new Error("writer failed")
      },
      createRuntime: async () => runtime,
    })

    input.end(`${JSON.stringify(generateRequest("turn-writer-failure"))}\n`)

    await expect(server).rejects.toThrow("writer failed")
    expect(dispose).toHaveBeenCalledOnce()
  })
})

describe("parseChatServerRequest", () => {
  it("should reject invalid JSON without echoing its contents", () => {
    expect(parseChatServerRequest("private raw prompt {not-json")).toEqual({
      ok: false,
      id: "unknown",
      message: "Request must be valid JSON.",
    })
  })

  it("should validate visible user and assistant history", () => {
    expect(
      parseChatServerRequest(
        JSON.stringify({
          ...generateRequest("turn-history"),
          history: [{ role: "system", content: "Hidden override" }],
        }),
      ),
    ).toEqual({
      ok: false,
      id: "turn-history",
      message: "Generate request `history` is invalid.",
    })
  })

  it("should reject oversized requests before parsing private content", () => {
    const oversized = JSON.stringify({
      ...generateRequest("turn-oversized"),
      question: "q".repeat(1_048_576),
    })

    expect(parseChatServerRequest(oversized)).toEqual({
      ok: false,
      id: "unknown",
      message: "Request must not exceed 1048576 bytes.",
    })
  })
})

function generateRequest(id: string) {
  return {
    id,
    type: "generate",
    question: "What was approved?",
    history: [{ role: "user", content: "Use the review." }],
    sources: [
      {
        relativePath: "review.md",
        chunkIndex: 0,
        text: "The board approved offline use.",
      },
    ],
    thinking: "standard",
  }
}

async function waitForEvent(
  output: string[],
  eventName: ChatServerEvent["event"],
  count: number,
): Promise<void> {
  await vi.waitFor(() => {
    expect(parseOutput(output).filter((event) => event.event === eventName)).toHaveLength(count)
  })
}

function parseOutput(output: string[]): ChatServerEvent[] {
  return output.map((line) => JSON.parse(line))
}

function isSingleJsonLine(line: string): boolean {
  if (!line.endsWith("\n") || line.slice(0, -1).includes("\n")) return false
  try {
    JSON.parse(line)
    return true
  } catch {
    return false
  }
}
