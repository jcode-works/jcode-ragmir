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
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-semantic-"))
    tempDirs.push(root)

    const result = await enableSemanticEmbeddings(root)
    const config = JSON.parse(await readFile(result.configPath, "utf8")) as {
      embeddingProvider: string
      embeddingModel: string
      embeddingModelRevision: string
      embeddingModelDigest: string | null
      embeddingModelPath: string
      transformersAllowRemoteModels: boolean
    }

    expect(config.embeddingProvider).toBe("transformers")
    expect(config.embeddingModel).toBe("intfloat/multilingual-e5-small")
    expect(config.embeddingModelRevision).toMatch(/^[0-9a-f]{40}$/u)
    expect(config.embeddingModelDigest).toBeNull()
    expect(config.embeddingModelPath).toBe(".ragmir/models")
    expect(config.transformersAllowRemoteModels).toBe(false)
    expect(result.transformersAllowRemoteModels).toBe(false)
  })

  it("should persist the resolved artifact identity from model pull", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-semantic-"))
    tempDirs.push(root)
    const digest = `sha256:${"a".repeat(64)}`

    const result = await enableSemanticEmbeddings(root, {
      embeddingModelRevision: "b".repeat(40),
      embeddingModelDigest: digest,
    })

    expect(result).toMatchObject({
      embeddingModelRevision: "b".repeat(40),
      embeddingModelDigest: digest,
    })
    await expect(readFile(result.configPath, "utf8")).resolves.toContain(digest)
  })

  it("should reject a malformed resolved artifact identity", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-semantic-"))
    tempDirs.push(root)

    await expect(
      enableSemanticEmbeddings(root, {
        embeddingModelRevision: "b".repeat(40),
        embeddingModelDigest: "sha256:not-a-digest",
      }),
    ).rejects.toThrow("lowercase SHA-256")
  })

  it("preserves custom model settings while disabling remote loading", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-semantic-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".kb"), { recursive: true })
    await writeFile(
      path.join(root, ".kb", "config.json"),
      JSON.stringify({
        rawDir: "docs",
        embeddingProvider: "local-hash",
        embeddingModel: "example/custom-embedder",
        embeddingModelPath: ".ragmir/custom-models",
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
    expect(config.embeddingModelPath).toBe(".ragmir/custom-models")
    expect(config.transformersAllowRemoteModels).toBe(false)
  })
})
