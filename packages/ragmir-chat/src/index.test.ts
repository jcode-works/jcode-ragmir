import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  buildChatMessages,
  doctor,
  ensureAnswerCitations,
  extractGeneratedAnswer,
  formatSources,
  generateChatAnswer,
  setupChatModel,
  type TextGenerator,
} from "./index.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("generateChatAnswer", () => {
  it("generates a cited answer from injected Ragmir sources", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-chat-"))
    tempDirs.push(root)
    const seenMessages: unknown[] = []
    const generator: TextGenerator = async (messages, options) => {
      seenMessages.push(...messages)
      expect(options).toEqual({ max_new_tokens: 128, do_sample: false })
      return [
        {
          generated_text: [
            ...messages,
            { role: "assistant", content: "The approval is in the review note [1]." },
          ],
        },
      ]
    }

    const result = await generateChatAnswer({
      cwd: root,
      question: "What proves offline approval?",
      maxNewTokens: 128,
      sources: [
        {
          relativePath: "raw/review.md",
          chunkIndex: 3,
          text: "Offline approval was granted by the review board.",
          distance: null,
        },
      ],
      generator,
    })

    expect(result.answer).toBe("The approval is in the review note [1].")
    expect(result.emptyContext).toBe(false)
    expect(result.allowRemoteModels).toBe(false)
    expect(result.modelPath).toBe(path.join(root, ".ragmir/models/chat"))
    expect(JSON.stringify(seenMessages)).toContain("raw/review.md#3")
  })

  it("does not call the generator when no Ragmir context is available", async () => {
    const generator: TextGenerator = async () => {
      throw new Error("generator should not be called")
    }

    const result = await generateChatAnswer({
      question: "What is missing?",
      sources: [],
      generator,
    })

    expect(result.emptyContext).toBe(true)
    expect(result.answer).toContain("No relevant Ragmir passages")
  })
})

describe("buildChatMessages", () => {
  it("builds a grounded chat prompt with citation instructions", () => {
    const messages = buildChatMessages({
      question: "Summarize the evidence.",
      sources: [
        {
          relativePath: "raw/evidence.md",
          chunkIndex: 0,
          text: "Evidence text.",
        },
      ],
    })

    expect(messages).toEqual([
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("Cite evidence"),
      }),
      expect.objectContaining({
        role: "user",
        content: expect.stringContaining("[1] raw/evidence.md#0"),
      }),
    ])
  })
})

describe("formatSources", () => {
  it("truncates context to the configured character limit", () => {
    const formatted = formatSources(
      [
        {
          relativePath: "raw/long.md",
          chunkIndex: 0,
          text: "alpha ".repeat(200),
        },
      ],
      80,
    )

    expect(formatted).toContain("[1] raw/long.md#0")
    expect(formatted).toContain("[truncated]")
    expect(formatted.length).toBeLessThanOrEqual(94)
  })
})

describe("extractGeneratedAnswer", () => {
  it("extracts the assistant message from Transformers.js chat output", () => {
    expect(
      extractGeneratedAnswer([
        {
          generated_text: [
            { role: "user", content: "Question" },
            { role: "assistant", content: "Answer [1]." },
          ],
        },
      ]),
    ).toBe("Answer [1].")
  })

  it("extracts string outputs", () => {
    expect(extractGeneratedAnswer([{ generated_text: "Answer text." }])).toBe("Answer text.")
    expect(extractGeneratedAnswer([{ text: "Fallback text." }])).toBe("Fallback text.")
  })

  it("rejects unsupported outputs", () => {
    expect(() => extractGeneratedAnswer([{ generated_text: [] }])).toThrow(
      "unsupported text-generation response",
    )
  })
})

describe("ensureAnswerCitations", () => {
  it("keeps existing citations", () => {
    expect(ensureAnswerCitations("Answer [2].", 3)).toBe("Answer [2].")
  })

  it("adds a fallback citation when generated text omits one", () => {
    expect(ensureAnswerCitations("Answer.", 2)).toBe("Answer. [1]")
  })

  it("does not add citations without sources", () => {
    expect(ensureAnswerCitations("Answer.", 0)).toBe("Answer.")
  })
})

describe("setupChatModel", () => {
  it("creates the model cache directory and reports setup defaults with an injected generator", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-chat-setup-"))
    tempDirs.push(root)

    const result = await setupChatModel({
      cwd: root,
      allowRemoteModels: false,
      generator: async () => [{ generated_text: "ok" }],
    })

    expect(result.ready).toBe(true)
    expect(result.allowRemoteModels).toBe(false)
    expect(result.modelPath).toBe(path.join(root, ".ragmir/models/chat"))
  })
})

describe("doctor", () => {
  it("reports a Transformers.js offline chat provider without Ollama or Python", async () => {
    await expect(doctor()).resolves.toMatchObject({
      provider: "transformers",
      defaultAllowRemoteModels: false,
      defaultSetupAllowsRemoteModels: true,
      ollamaRequired: false,
      pythonRequired: false,
      storesRawPrompts: false,
    })
  })
})
