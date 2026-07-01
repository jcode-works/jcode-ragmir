import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { enableSemanticEmbeddings } from "./semantic-config.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("enableSemanticEmbeddings", () => {
  it("initializes a project and enables the safe Transformers provider", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mimir-semantic-"))
    tempDirs.push(root)

    const result = await enableSemanticEmbeddings(root)
    const config = JSON.parse(await readFile(result.configPath, "utf8")) as {
      embeddingProvider: string
      embeddingModel: string
      embeddingModelPath: string
      transformersAllowRemoteModels: boolean
    }

    expect(config.embeddingProvider).toBe("transformers")
    expect(config.embeddingModel).toBe("mixedbread-ai/mxbai-embed-xsmall-v1")
    expect(config.embeddingModelPath).toBe(".mimir/models")
    expect(config.transformersAllowRemoteModels).toBe(false)
    expect(result.transformersAllowRemoteModels).toBe(false)
  })

  it("preserves custom model settings while disabling remote loading", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mimir-semantic-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".kb"), { recursive: true })
    await writeFile(
      path.join(root, ".kb", "config.json"),
      JSON.stringify({
        rawDir: "docs",
        embeddingProvider: "local-hash",
        embeddingModel: "example/custom-embedder",
        embeddingModelPath: ".mimir/custom-models",
        transformersAllowRemoteModels: true,
      }),
      "utf8",
    )

    await enableSemanticEmbeddings(root)
    const config = JSON.parse(await readFile(path.join(root, ".kb", "config.json"), "utf8")) as {
      rawDir: string
      embeddingProvider: string
      embeddingModel: string
      embeddingModelPath: string
      transformersAllowRemoteModels: boolean
    }

    expect(config.rawDir).toBe("docs")
    expect(config.embeddingProvider).toBe("transformers")
    expect(config.embeddingModel).toBe("example/custom-embedder")
    expect(config.embeddingModelPath).toBe(".mimir/custom-models")
    expect(config.transformersAllowRemoteModels).toBe(false)
  })
})
