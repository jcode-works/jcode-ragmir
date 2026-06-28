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
    await mkdir(path.join(root, ".kb"), { recursive: true })
    await writeFile(
      path.join(root, ".kb/config.json"),
      JSON.stringify({ rawDir: "docs", storageDir: ".kb/index" }),
      "utf8",
    )
    const nested = path.join(root, "packages/app")
    await mkdir(nested, { recursive: true })

    expect(findProjectRoot(nested)).toBe(root)

    const config = await loadConfig(nested)
    expect(config.rawDir).toBe(path.join(root, "docs"))
    expect(config.storageDir).toBe(path.join(root, ".kb/index"))
    expect(config.accessLogPath).toBe(path.join(root, ".kb/access.log"))
    expect(config.embeddingModelPath).toBe(path.join(root, ".mimir/models"))
    expect(config.embeddingProvider).toBe("local-hash")
    expect(config.embeddingModel).toBe("mixedbread-ai/mxbai-embed-xsmall-v1")
    expect(config.transformersAllowRemoteModels).toBe(false)
    expect(config.redaction.enabled).toBe(true)
    expect(config.accessLog).toBe(true)
    expect(config.mcpMaxTopK).toBe(10)
    expect(config.includeExtensions).toEqual([])
  })

  it("normalizes custom text extensions from config and env", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "jcode-kb-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".kb"), { recursive: true })
    await writeFile(
      path.join(root, ".kb/config.json"),
      JSON.stringify({ includeExtensions: ["transcript", ".Custom"] }),
      "utf8",
    )

    const original = process.env.KB_INCLUDE_EXTENSIONS
    process.env.KB_INCLUDE_EXTENSIONS = "logbook,.evidence"
    try {
      const config = await loadConfig(root)
      expect(config.includeExtensions).toEqual([".evidence", ".logbook"])
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
    await mkdir(path.join(root, ".kb"), { recursive: true })
    await writeFile(
      path.join(root, ".kb/config.json"),
      JSON.stringify({
        embeddingProvider: "transformers",
        embeddingModel: "example/local-embedder",
        embeddingModelPath: ".mimir/custom-models",
        transformersAllowRemoteModels: false,
      }),
      "utf8",
    )

    const originalEmbedding = process.env.KB_EMBEDDING_PROVIDER
    const originalModel = process.env.KB_EMBEDDING_MODEL
    const originalModelPath = process.env.KB_EMBEDDING_MODEL_PATH
    const originalRemoteModels = process.env.KB_TRANSFORMERS_ALLOW_REMOTE_MODELS
    process.env.KB_EMBEDDING_PROVIDER = "local-hash"
    process.env.KB_EMBEDDING_MODEL = "example/env-embedder"
    process.env.KB_EMBEDDING_MODEL_PATH = ".mimir/env-models"
    process.env.KB_TRANSFORMERS_ALLOW_REMOTE_MODELS = "true"
    try {
      const config = await loadConfig(root)
      expect(config.embeddingProvider).toBe("local-hash")
      expect(config.embeddingModel).toBe("example/env-embedder")
      expect(config.embeddingModelPath).toBe(path.join(root, ".mimir/env-models"))
      expect(config.transformersAllowRemoteModels).toBe(true)
    } finally {
      if (originalEmbedding === undefined) {
        delete process.env.KB_EMBEDDING_PROVIDER
      } else {
        process.env.KB_EMBEDDING_PROVIDER = originalEmbedding
      }
      if (originalModel === undefined) {
        delete process.env.KB_EMBEDDING_MODEL
      } else {
        process.env.KB_EMBEDDING_MODEL = originalModel
      }
      if (originalModelPath === undefined) {
        delete process.env.KB_EMBEDDING_MODEL_PATH
      } else {
        process.env.KB_EMBEDDING_MODEL_PATH = originalModelPath
      }
      if (originalRemoteModels === undefined) {
        delete process.env.KB_TRANSFORMERS_ALLOW_REMOTE_MODELS
      } else {
        process.env.KB_TRANSFORMERS_ALLOW_REMOTE_MODELS = originalRemoteModels
      }
    }
  })
})
