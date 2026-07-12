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
    await mkdir(path.join(root, ".ragmir"), { recursive: true })
    await writeFile(
      path.join(root, ".ragmir/config.json"),
      JSON.stringify({ rawDir: "docs", storageDir: ".ragmir/index" }),
      "utf8",
    )
    const nested = path.join(root, "packages/app")
    await mkdir(nested, { recursive: true })

    expect(findProjectRoot(nested)).toBe(root)

    const config = await loadConfig(nested)
    expect(config.rawDir).toBe(path.join(root, "docs"))
    expect(config.storageDir).toBe(path.join(root, ".ragmir/index"))
    expect(config.accessLogPath).toBe(path.join(root, ".ragmir/access.log"))
    expect(config.embeddingModelPath).toBe(path.join(root, ".ragmir/models"))
    expect(config.embeddingProvider).toBe("local-hash")
    expect(config.privacyProfile).toBe("private")
    expect(config.retrievalProfile).toBe("balanced")
    expect(config.acceptedRisks).toEqual([])
    expect(config.embeddingModel).toBe("intfloat/multilingual-e5-small")
    expect(config.embeddingModelRevision).toBe("main")
    expect(config.transformersAllowRemoteModels).toBe(false)
    expect(config.redaction.enabled).toBe(true)
    expect(config.accessLog).toBe(true)
    expect(config.mcpMaxTopK).toBe(10)
    expect(config.mcpMaxOutputBytes).toBe(32_768)
    expect(config.sources).toEqual([])
    expect(config.includeExtensions).toEqual([])
    expect(config.pdfOcrCommand).toEqual([])
    expect(config.pdfOcrTimeoutMs).toBe(120_000)
    expect(config.imageOcrCommand).toEqual([])
    expect(config.imageOcrTimeoutMs).toBe(120_000)
    expect(config.legacyWordCommand).toEqual([])
    expect(config.legacyWordTimeoutMs).toBe(120_000)
  })

  it("should select the nearest Ragmir config inside a monorepo", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-config-monorepo-"))
    tempDirs.push(root)
    const app = path.join(root, "apps", "web")
    const appSource = path.join(app, "src", "features")
    await mkdir(path.join(root, ".ragmir"), { recursive: true })
    await mkdir(path.join(app, ".ragmir"), { recursive: true })
    await mkdir(appSource, { recursive: true })
    await writeFile(path.join(root, ".ragmir", "config.json"), "{}\n", "utf8")
    await writeFile(
      path.join(app, ".ragmir", "config.json"),
      JSON.stringify({ rawDir: ".ragmir/app-raw" }),
      "utf8",
    )

    expect(findProjectRoot(root)).toBe(root)
    expect(findProjectRoot(appSource)).toBe(app)
    expect((await loadConfig(appSource)).rawDir).toBe(path.join(app, ".ragmir", "app-raw"))
  })

  it("keeps inline source paths and globs from config", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "jcode-kb-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".ragmir"), { recursive: true })
    await writeFile(
      path.join(root, ".ragmir/config.json"),
      JSON.stringify({ sources: ["../apps/*/README.md", "!../apps/**/node_modules/**"] }),
      "utf8",
    )

    const config = await loadConfig(root)
    expect(config.sources).toEqual(["../apps/*/README.md", "!../apps/**/node_modules/**"])
  })

  it("normalizes custom text extensions from config and env", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "jcode-kb-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".ragmir"), { recursive: true })
    await writeFile(
      path.join(root, ".ragmir/config.json"),
      JSON.stringify({ includeExtensions: ["transcript", ".Custom"] }),
      "utf8",
    )

    const original = process.env.RAGMIR_INCLUDE_EXTENSIONS
    process.env.RAGMIR_INCLUDE_EXTENSIONS = "logbook,.evidence"
    try {
      const config = await loadConfig(root)
      expect(config.includeExtensions).toEqual([".evidence", ".logbook"])
    } finally {
      if (original === undefined) {
        delete process.env.RAGMIR_INCLUDE_EXTENSIONS
      } else {
        process.env.RAGMIR_INCLUDE_EXTENSIONS = original
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
    await mkdir(path.join(root, ".ragmir"), { recursive: true })
    await writeFile(
      path.join(root, ".ragmir/config.json"),
      JSON.stringify({
        embeddingProvider: "transformers",
        embeddingModel: "example/local-embedder",
        embeddingModelPath: ".ragmir/custom-models",
        transformersAllowRemoteModels: false,
      }),
      "utf8",
    )

    const originalEmbedding = process.env.RAGMIR_EMBEDDING_PROVIDER
    const originalModel = process.env.RAGMIR_EMBEDDING_MODEL
    const originalModelPath = process.env.RAGMIR_EMBEDDING_MODEL_PATH
    const originalRemoteModels = process.env.RAGMIR_TRANSFORMERS_ALLOW_REMOTE_MODELS
    process.env.RAGMIR_EMBEDDING_PROVIDER = "local-hash"
    process.env.RAGMIR_EMBEDDING_MODEL = "example/env-embedder"
    process.env.RAGMIR_EMBEDDING_MODEL_PATH = ".ragmir/env-models"
    process.env.RAGMIR_TRANSFORMERS_ALLOW_REMOTE_MODELS = "true"
    try {
      const config = await loadConfig(root)
      expect(config.embeddingProvider).toBe("local-hash")
      expect(config.embeddingModel).toBe("example/env-embedder")
      expect(config.embeddingModelPath).toBe(path.join(root, ".ragmir/env-models"))
      expect(config.transformersAllowRemoteModels).toBe(true)
    } finally {
      if (originalEmbedding === undefined) {
        delete process.env.RAGMIR_EMBEDDING_PROVIDER
      } else {
        process.env.RAGMIR_EMBEDDING_PROVIDER = originalEmbedding
      }
      if (originalModel === undefined) {
        delete process.env.RAGMIR_EMBEDDING_MODEL
      } else {
        process.env.RAGMIR_EMBEDDING_MODEL = originalModel
      }
      if (originalModelPath === undefined) {
        delete process.env.RAGMIR_EMBEDDING_MODEL_PATH
      } else {
        process.env.RAGMIR_EMBEDDING_MODEL_PATH = originalModelPath
      }
      if (originalRemoteModels === undefined) {
        delete process.env.RAGMIR_TRANSFORMERS_ALLOW_REMOTE_MODELS
      } else {
        process.env.RAGMIR_TRANSFORMERS_ALLOW_REMOTE_MODELS = originalRemoteModels
      }
    }
  })

  it("loads optional PDF OCR command from config and env", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "jcode-kb-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".ragmir"), { recursive: true })
    await writeFile(
      path.join(root, ".ragmir/config.json"),
      JSON.stringify({
        pdfOcrCommand: ["ocr-wrapper", "{input}"],
        pdfOcrTimeoutMs: 30_000,
      }),
      "utf8",
    )

    const originalCommand = process.env.RAGMIR_PDF_OCR_COMMAND
    const originalTimeout = process.env.RAGMIR_PDF_OCR_TIMEOUT_MS
    process.env.RAGMIR_PDF_OCR_COMMAND = JSON.stringify(["env-ocr-wrapper"])
    process.env.RAGMIR_PDF_OCR_TIMEOUT_MS = "45000"
    try {
      const config = await loadConfig(root)
      expect(config.pdfOcrCommand).toEqual(["env-ocr-wrapper"])
      expect(config.pdfOcrTimeoutMs).toBe(45_000)
    } finally {
      if (originalCommand === undefined) {
        delete process.env.RAGMIR_PDF_OCR_COMMAND
      } else {
        process.env.RAGMIR_PDF_OCR_COMMAND = originalCommand
      }
      if (originalTimeout === undefined) {
        delete process.env.RAGMIR_PDF_OCR_TIMEOUT_MS
      } else {
        process.env.RAGMIR_PDF_OCR_TIMEOUT_MS = originalTimeout
      }
    }
  })

  it("loads optional image OCR command from config and env", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "jcode-kb-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".ragmir"), { recursive: true })
    await writeFile(
      path.join(root, ".ragmir/config.json"),
      JSON.stringify({
        imageOcrCommand: ["image-ocr-wrapper", "{input}"],
        imageOcrTimeoutMs: 30_000,
      }),
      "utf8",
    )

    const originalCommand = process.env.RAGMIR_IMAGE_OCR_COMMAND
    const originalTimeout = process.env.RAGMIR_IMAGE_OCR_TIMEOUT_MS
    process.env.RAGMIR_IMAGE_OCR_COMMAND = JSON.stringify(["env-image-ocr-wrapper"])
    process.env.RAGMIR_IMAGE_OCR_TIMEOUT_MS = "45000"
    try {
      const config = await loadConfig(root)
      expect(config.imageOcrCommand).toEqual(["env-image-ocr-wrapper"])
      expect(config.imageOcrTimeoutMs).toBe(45_000)
    } finally {
      if (originalCommand === undefined) {
        delete process.env.RAGMIR_IMAGE_OCR_COMMAND
      } else {
        process.env.RAGMIR_IMAGE_OCR_COMMAND = originalCommand
      }
      if (originalTimeout === undefined) {
        delete process.env.RAGMIR_IMAGE_OCR_TIMEOUT_MS
      } else {
        process.env.RAGMIR_IMAGE_OCR_TIMEOUT_MS = originalTimeout
      }
    }
  })

  it("loads optional legacy Word command from config and env", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "jcode-kb-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".ragmir"), { recursive: true })
    await writeFile(
      path.join(root, ".ragmir/config.json"),
      JSON.stringify({
        legacyWordCommand: ["doc-wrapper", "{input}"],
        legacyWordTimeoutMs: 30_000,
      }),
      "utf8",
    )

    const originalCommand = process.env.RAGMIR_LEGACY_WORD_COMMAND
    const originalTimeout = process.env.RAGMIR_LEGACY_WORD_TIMEOUT_MS
    process.env.RAGMIR_LEGACY_WORD_COMMAND = JSON.stringify(["env-doc-wrapper"])
    process.env.RAGMIR_LEGACY_WORD_TIMEOUT_MS = "45000"
    try {
      const config = await loadConfig(root)
      expect(config.legacyWordCommand).toEqual(["env-doc-wrapper"])
      expect(config.legacyWordTimeoutMs).toBe(45_000)
    } finally {
      if (originalCommand === undefined) {
        delete process.env.RAGMIR_LEGACY_WORD_COMMAND
      } else {
        process.env.RAGMIR_LEGACY_WORD_COMMAND = originalCommand
      }
      if (originalTimeout === undefined) {
        delete process.env.RAGMIR_LEGACY_WORD_TIMEOUT_MS
      } else {
        process.env.RAGMIR_LEGACY_WORD_TIMEOUT_MS = originalTimeout
      }
    }
  })

  it("rejects a chunkOverlap greater than or equal to chunkSize", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "jcode-kb-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".ragmir"), { recursive: true })
    await writeFile(
      path.join(root, ".ragmir/config.json"),
      JSON.stringify({ chunkSize: 500, chunkOverlap: 500 }),
      "utf8",
    )

    await expect(loadConfig(root)).rejects.toThrow("chunkOverlap must be lower than chunkSize.")
  })

  it("overrides mcpMaxTopK from env and falls back to the default on invalid values", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "jcode-kb-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".ragmir"), { recursive: true })
    await writeFile(path.join(root, ".ragmir/config.json"), "{}\n", "utf8")

    const original = process.env.RAGMIR_MCP_MAX_TOP_K
    process.env.RAGMIR_MCP_MAX_TOP_K = "3"
    try {
      expect((await loadConfig(root)).mcpMaxTopK).toBe(3)
      process.env.RAGMIR_MCP_MAX_TOP_K = "not-a-number"
      expect((await loadConfig(root)).mcpMaxTopK).toBe(10)
    } finally {
      if (original === undefined) {
        delete process.env.RAGMIR_MCP_MAX_TOP_K
      } else {
        process.env.RAGMIR_MCP_MAX_TOP_K = original
      }
    }
  })

  it("should override the MCP output budget from env and reject undersized config values", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-mcp-output-budget-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".ragmir"), { recursive: true })
    await writeFile(path.join(root, ".ragmir/config.json"), "{}\n", "utf8")

    const original = process.env.RAGMIR_MCP_MAX_OUTPUT_BYTES
    process.env.RAGMIR_MCP_MAX_OUTPUT_BYTES = "8192"
    try {
      expect((await loadConfig(root)).mcpMaxOutputBytes).toBe(8_192)
      process.env.RAGMIR_MCP_MAX_OUTPUT_BYTES = "invalid"
      expect((await loadConfig(root)).mcpMaxOutputBytes).toBe(32_768)
      process.env.RAGMIR_MCP_MAX_OUTPUT_BYTES = "512"
      expect((await loadConfig(root)).mcpMaxOutputBytes).toBe(32_768)
    } finally {
      restoreEnv("RAGMIR_MCP_MAX_OUTPUT_BYTES", original)
    }

    await writeFile(
      path.join(root, ".ragmir/config.json"),
      JSON.stringify({ mcpMaxOutputBytes: 512 }),
    )
    await expect(loadConfig(root)).rejects.toThrow()
  })

  it("defaults hybridTextScanLimit and overrides it from env", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "jcode-kb-scan-limit-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".ragmir"), { recursive: true })
    await writeFile(path.join(root, ".ragmir/config.json"), "{}\n", "utf8")

    expect((await loadConfig(root)).hybridTextScanLimit).toBe(5000)

    const original = process.env.RAGMIR_HYBRID_TEXT_SCAN_LIMIT
    process.env.RAGMIR_HYBRID_TEXT_SCAN_LIMIT = "2000"
    try {
      expect((await loadConfig(root)).hybridTextScanLimit).toBe(2000)
    } finally {
      if (original === undefined) {
        delete process.env.RAGMIR_HYBRID_TEXT_SCAN_LIMIT
      } else {
        process.env.RAGMIR_HYBRID_TEXT_SCAN_LIMIT = original
      }
    }
  })

  it("rejects unknown config keys so typos surface instead of being ignored", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "jcode-kb-strict-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".ragmir"), { recursive: true })
    await writeFile(path.join(root, ".ragmir/config.json"), JSON.stringify({ topKk: 5 }), "utf8")

    await expect(loadConfig(root)).rejects.toThrow(/topKk|Unrecognized key/i)
  })

  it("enforces the strict privacy floor after environment overrides", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-config-strict-profile-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".ragmir"), { recursive: true })
    await writeFile(
      path.join(root, ".ragmir", "config.json"),
      JSON.stringify({
        privacyProfile: "strict",
        transformersAllowRemoteModels: true,
        redaction: { enabled: false, builtIn: false },
        mcpMaxTopK: 50,
        mcpMaxOutputBytes: 100_000,
        pdfOcrCommand: ["ocr-wrapper"],
      }),
    )
    const originalRemote = process.env.RAGMIR_TRANSFORMERS_ALLOW_REMOTE_MODELS
    const originalRedaction = process.env.RAGMIR_REDACTION_ENABLED
    process.env.RAGMIR_TRANSFORMERS_ALLOW_REMOTE_MODELS = "true"
    process.env.RAGMIR_REDACTION_ENABLED = "false"
    try {
      const config = await loadConfig(root)
      expect(config.transformersAllowRemoteModels).toBe(false)
      expect(config.redaction.enabled).toBe(true)
      expect(config.redaction.builtIn).toBe(true)
      expect(config.mcpMaxTopK).toBe(5)
      expect(config.mcpMaxOutputBytes).toBe(16_384)
      expect(config.pdfOcrCommand).toEqual([])
    } finally {
      restoreEnv("RAGMIR_TRANSFORMERS_ALLOW_REMOTE_MODELS", originalRemote)
      restoreEnv("RAGMIR_REDACTION_ENABLED", originalRedaction)
    }
  })

  it("applies retrieval profile defaults without overriding explicit values", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-config-retrieval-profile-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".ragmir"), { recursive: true })
    await writeFile(
      path.join(root, ".ragmir", "config.json"),
      JSON.stringify({ retrievalProfile: "quality" }),
    )
    expect(await loadConfig(root)).toEqual(
      expect.objectContaining({
        retrievalProfile: "quality",
        topK: 12,
        hybridTextScanLimit: 10_000,
      }),
    )

    await writeFile(
      path.join(root, ".ragmir", "config.json"),
      JSON.stringify({ retrievalProfile: "fast", topK: 7, hybridTextScanLimit: 3_000 }),
    )
    expect(await loadConfig(root)).toEqual(
      expect.objectContaining({ retrievalProfile: "fast", topK: 7, hybridTextScanLimit: 3_000 }),
    )
  })

  it("rejects a config file that is not a JSON object", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "jcode-kb-not-object-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".ragmir"), { recursive: true })
    await writeFile(path.join(root, ".ragmir/config.json"), "[1, 2, 3]\n", "utf8")

    await expect(loadConfig(root)).rejects.toThrow("JSON object")
  })
})

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
