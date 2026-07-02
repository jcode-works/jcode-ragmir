import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { findProjectRoot, loadConfig } from "./config.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("loadConfig", () => {
  it("resolves project config upward and paths from the project root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "jcode-kb-"))
    tempDirs.push(root)
    await writeFile(path.join(root, ".kb-config-placeholder"), "", "utf8")
    await mkdir(path.join(root, ".mimir"), { recursive: true })
    await writeFile(
      path.join(root, ".mimir/config.json"),
      JSON.stringify({ rawDir: "docs", storageDir: ".mimir/index" }),
      "utf8",
    )
    const nested = path.join(root, "packages/app")
    await mkdir(nested, { recursive: true })

    expect(findProjectRoot(nested)).toBe(root)

    const config = await loadConfig(nested)
    expect(config.rawDir).toBe(path.join(root, "docs"))
    expect(config.storageDir).toBe(path.join(root, ".mimir/index"))
    expect(config.accessLogPath).toBe(path.join(root, ".mimir/access.log"))
    expect(config.embeddingModelPath).toBe(path.join(root, ".mimir/models"))
    expect(config.embeddingProvider).toBe("local-hash")
    expect(config.embeddingModel).toBe("mixedbread-ai/mxbai-embed-xsmall-v1")
    expect(config.transformersAllowRemoteModels).toBe(false)
    expect(config.redaction.enabled).toBe(true)
    expect(config.accessLog).toBe(true)
    expect(config.mcpMaxTopK).toBe(10)
    expect(config.sources).toEqual([])
    expect(config.includeExtensions).toEqual([])
    expect(config.pdfOcrCommand).toEqual([])
    expect(config.pdfOcrTimeoutMs).toBe(120_000)
    expect(config.imageOcrCommand).toEqual([])
    expect(config.imageOcrTimeoutMs).toBe(120_000)
    expect(config.legacyWordCommand).toEqual([])
    expect(config.legacyWordTimeoutMs).toBe(120_000)
  })

  it("keeps inline source paths and globs from config", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "jcode-kb-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".mimir"), { recursive: true })
    await writeFile(
      path.join(root, ".mimir/config.json"),
      JSON.stringify({ sources: ["../apps/*/README.md", "!../apps/**/node_modules/**"] }),
      "utf8",
    )

    const config = await loadConfig(root)
    expect(config.sources).toEqual(["../apps/*/README.md", "!../apps/**/node_modules/**"])
  })

  it("normalizes custom text extensions from config and env", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "jcode-kb-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".mimir"), { recursive: true })
    await writeFile(
      path.join(root, ".mimir/config.json"),
      JSON.stringify({ includeExtensions: ["transcript", ".Custom"] }),
      "utf8",
    )

    const original = process.env.MIMIR_INCLUDE_EXTENSIONS
    process.env.MIMIR_INCLUDE_EXTENSIONS = "logbook,.evidence"
    try {
      const config = await loadConfig(root)
      expect(config.includeExtensions).toEqual([".evidence", ".logbook"])
    } finally {
      if (original === undefined) {
        delete process.env.MIMIR_INCLUDE_EXTENSIONS
      } else {
        process.env.MIMIR_INCLUDE_EXTENSIONS = original
      }
    }
  })

  it("loads legacy .kb config files and KB_* env aliases", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "jcode-kb-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".kb"), { recursive: true })
    await writeFile(path.join(root, ".kb/config.json"), JSON.stringify({}), "utf8")

    const original = process.env.KB_INCLUDE_EXTENSIONS
    process.env.KB_INCLUDE_EXTENSIONS = "legacy"
    try {
      expect(findProjectRoot(path.join(root, "nested"))).toBe(root)
      const config = await loadConfig(root)
      expect(config.rawDir).toBe(path.join(root, "private"))
      expect(config.storageDir).toBe(path.join(root, ".kb/storage"))
      expect(config.sourcesFile).toBe(path.join(root, ".kb/sources.txt"))
      expect(config.accessLogPath).toBe(path.join(root, ".kb/access.log"))
      expect(config.includeExtensions).toEqual([".legacy"])
    } finally {
      if (original === undefined) {
        delete process.env.KB_INCLUDE_EXTENSIONS
      } else {
        process.env.KB_INCLUDE_EXTENSIONS = original
      }
    }
  })

  it("loads provider overrides from config and env", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "jcode-kb-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".mimir"), { recursive: true })
    await writeFile(
      path.join(root, ".mimir/config.json"),
      JSON.stringify({
        embeddingProvider: "transformers",
        embeddingModel: "example/local-embedder",
        embeddingModelPath: ".mimir/custom-models",
        transformersAllowRemoteModels: false,
      }),
      "utf8",
    )

    const originalEmbedding = process.env.MIMIR_EMBEDDING_PROVIDER
    const originalModel = process.env.MIMIR_EMBEDDING_MODEL
    const originalModelPath = process.env.MIMIR_EMBEDDING_MODEL_PATH
    const originalRemoteModels = process.env.MIMIR_TRANSFORMERS_ALLOW_REMOTE_MODELS
    process.env.MIMIR_EMBEDDING_PROVIDER = "local-hash"
    process.env.MIMIR_EMBEDDING_MODEL = "example/env-embedder"
    process.env.MIMIR_EMBEDDING_MODEL_PATH = ".mimir/env-models"
    process.env.MIMIR_TRANSFORMERS_ALLOW_REMOTE_MODELS = "true"
    try {
      const config = await loadConfig(root)
      expect(config.embeddingProvider).toBe("local-hash")
      expect(config.embeddingModel).toBe("example/env-embedder")
      expect(config.embeddingModelPath).toBe(path.join(root, ".mimir/env-models"))
      expect(config.transformersAllowRemoteModels).toBe(true)
    } finally {
      if (originalEmbedding === undefined) {
        delete process.env.MIMIR_EMBEDDING_PROVIDER
      } else {
        process.env.MIMIR_EMBEDDING_PROVIDER = originalEmbedding
      }
      if (originalModel === undefined) {
        delete process.env.MIMIR_EMBEDDING_MODEL
      } else {
        process.env.MIMIR_EMBEDDING_MODEL = originalModel
      }
      if (originalModelPath === undefined) {
        delete process.env.MIMIR_EMBEDDING_MODEL_PATH
      } else {
        process.env.MIMIR_EMBEDDING_MODEL_PATH = originalModelPath
      }
      if (originalRemoteModels === undefined) {
        delete process.env.MIMIR_TRANSFORMERS_ALLOW_REMOTE_MODELS
      } else {
        process.env.MIMIR_TRANSFORMERS_ALLOW_REMOTE_MODELS = originalRemoteModels
      }
    }
  })

  it("loads optional PDF OCR command from config and env", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "jcode-kb-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".mimir"), { recursive: true })
    await writeFile(
      path.join(root, ".mimir/config.json"),
      JSON.stringify({
        pdfOcrCommand: ["ocr-wrapper", "{input}"],
        pdfOcrTimeoutMs: 30_000,
      }),
      "utf8",
    )

    const originalCommand = process.env.MIMIR_PDF_OCR_COMMAND
    const originalTimeout = process.env.MIMIR_PDF_OCR_TIMEOUT_MS
    process.env.MIMIR_PDF_OCR_COMMAND = JSON.stringify(["env-ocr-wrapper"])
    process.env.MIMIR_PDF_OCR_TIMEOUT_MS = "45000"
    try {
      const config = await loadConfig(root)
      expect(config.pdfOcrCommand).toEqual(["env-ocr-wrapper"])
      expect(config.pdfOcrTimeoutMs).toBe(45_000)
    } finally {
      if (originalCommand === undefined) {
        delete process.env.MIMIR_PDF_OCR_COMMAND
      } else {
        process.env.MIMIR_PDF_OCR_COMMAND = originalCommand
      }
      if (originalTimeout === undefined) {
        delete process.env.MIMIR_PDF_OCR_TIMEOUT_MS
      } else {
        process.env.MIMIR_PDF_OCR_TIMEOUT_MS = originalTimeout
      }
    }
  })

  it("loads optional image OCR command from config and env", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "jcode-kb-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".mimir"), { recursive: true })
    await writeFile(
      path.join(root, ".mimir/config.json"),
      JSON.stringify({
        imageOcrCommand: ["image-ocr-wrapper", "{input}"],
        imageOcrTimeoutMs: 30_000,
      }),
      "utf8",
    )

    const originalCommand = process.env.MIMIR_IMAGE_OCR_COMMAND
    const originalTimeout = process.env.MIMIR_IMAGE_OCR_TIMEOUT_MS
    process.env.MIMIR_IMAGE_OCR_COMMAND = JSON.stringify(["env-image-ocr-wrapper"])
    process.env.MIMIR_IMAGE_OCR_TIMEOUT_MS = "45000"
    try {
      const config = await loadConfig(root)
      expect(config.imageOcrCommand).toEqual(["env-image-ocr-wrapper"])
      expect(config.imageOcrTimeoutMs).toBe(45_000)
    } finally {
      if (originalCommand === undefined) {
        delete process.env.MIMIR_IMAGE_OCR_COMMAND
      } else {
        process.env.MIMIR_IMAGE_OCR_COMMAND = originalCommand
      }
      if (originalTimeout === undefined) {
        delete process.env.MIMIR_IMAGE_OCR_TIMEOUT_MS
      } else {
        process.env.MIMIR_IMAGE_OCR_TIMEOUT_MS = originalTimeout
      }
    }
  })

  it("loads optional legacy Word command from config and env", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "jcode-kb-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".mimir"), { recursive: true })
    await writeFile(
      path.join(root, ".mimir/config.json"),
      JSON.stringify({
        legacyWordCommand: ["doc-wrapper", "{input}"],
        legacyWordTimeoutMs: 30_000,
      }),
      "utf8",
    )

    const originalCommand = process.env.MIMIR_LEGACY_WORD_COMMAND
    const originalTimeout = process.env.MIMIR_LEGACY_WORD_TIMEOUT_MS
    process.env.MIMIR_LEGACY_WORD_COMMAND = JSON.stringify(["env-doc-wrapper"])
    process.env.MIMIR_LEGACY_WORD_TIMEOUT_MS = "45000"
    try {
      const config = await loadConfig(root)
      expect(config.legacyWordCommand).toEqual(["env-doc-wrapper"])
      expect(config.legacyWordTimeoutMs).toBe(45_000)
    } finally {
      if (originalCommand === undefined) {
        delete process.env.MIMIR_LEGACY_WORD_COMMAND
      } else {
        process.env.MIMIR_LEGACY_WORD_COMMAND = originalCommand
      }
      if (originalTimeout === undefined) {
        delete process.env.MIMIR_LEGACY_WORD_TIMEOUT_MS
      } else {
        process.env.MIMIR_LEGACY_WORD_TIMEOUT_MS = originalTimeout
      }
    }
  })

  it("rejects a chunkOverlap greater than or equal to chunkSize", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "jcode-kb-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".mimir"), { recursive: true })
    await writeFile(
      path.join(root, ".mimir/config.json"),
      JSON.stringify({ chunkSize: 500, chunkOverlap: 500 }),
      "utf8",
    )

    await expect(loadConfig(root)).rejects.toThrow("chunkOverlap must be lower than chunkSize.")
  })

  it("overrides mcpMaxTopK from env and falls back to the default on invalid values", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "jcode-kb-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".mimir"), { recursive: true })
    await writeFile(path.join(root, ".mimir/config.json"), "{}\n", "utf8")

    const original = process.env.MIMIR_MCP_MAX_TOP_K
    process.env.MIMIR_MCP_MAX_TOP_K = "3"
    try {
      expect((await loadConfig(root)).mcpMaxTopK).toBe(3)
      process.env.MIMIR_MCP_MAX_TOP_K = "not-a-number"
      expect((await loadConfig(root)).mcpMaxTopK).toBe(10)
    } finally {
      if (original === undefined) {
        delete process.env.MIMIR_MCP_MAX_TOP_K
      } else {
        process.env.MIMIR_MCP_MAX_TOP_K = original
      }
    }
  })
})
