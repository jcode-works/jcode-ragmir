import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { RagmirClient } from "./client.js"
import {
  clearTransformersCache,
  disposeTransformersCache,
  embeddingModelArtifactDigest,
  embedText,
  embedTexts,
  prepareEmbeddingText,
  pullEmbeddingModel,
  retainEmbeddingModel,
  transformersCacheSnapshotForTests,
} from "./embeddings.js"
import { indexPolicyFingerprint } from "./index-policy.js"
import { testConfig } from "./test-support/config.js"
import type { Config } from "./types.js"

const transformersMock = vi.hoisted(() => ({
  env: {
    localModelPath: "initial-local-path",
    cacheDir: "initial-cache-dir",
    allowLocalModels: true,
    allowRemoteModels: false,
  },
  pipeline: vi.fn(),
}))
const tempDirs: string[] = []
const revisionArtifacts: Record<string, string> = {
  "config.json": '{"model_type":"test","revision":"pinned"}\n',
  "onnx/model.onnx": "deterministic-model",
  "tokenizer.json": '{"version":"1.0"}\n',
  "tokenizer_config.json": '{"tokenizer_class":"TestTokenizer"}\n',
}

vi.mock("@huggingface/transformers", () => transformersMock)

beforeEach(async () => {
  await disposeTransformersCache()
  transformersMock.env.localModelPath = "initial-local-path"
  transformersMock.env.cacheDir = "initial-cache-dir"
  transformersMock.env.allowLocalModels = true
  transformersMock.env.allowRemoteModels = false
  transformersMock.pipeline.mockReset()
  transformersMock.pipeline.mockImplementation(async () => async (texts: string[]) => ({
    tolist: () => texts.map((_text, index) => [index + 1, 0]),
  }))
})

afterEach(async () => {
  await disposeTransformersCache()
  for (const directory of tempDirs.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

describe("local hash embeddings", () => {
  it("creates deterministic normalized embeddings without a model runtime", async () => {
    const config = testConfig()

    const first = await embedText("offline model approval", config)
    const second = await embedText("offline model approval", config)
    const batch = await embedTexts(["offline model approval", "dataset residency"], config)

    expect(first).toHaveLength(384)
    expect(second).toEqual(first)
    expect(batch).toHaveLength(2)
    expect(Math.round(vectorMagnitude(first) * 1000) / 1000).toBe(1)
    expect(transformersMock.pipeline).not.toHaveBeenCalled()
  })

  it("returns an empty array for empty input without invoking a provider", async () => {
    const config = testConfig()

    expect(await embedTexts([], config)).toEqual([])
  })

  it("should return one local embedding when one query is provided", async () => {
    const config = testConfig()
    const embedding = await embedText("solo query", config)

    expect(embedding).toHaveLength(384)
  })

  it("should preserve the local hash vector fingerprint across batch cache optimization", async () => {
    const config = testConfig()
    const embeddings = await embedTexts(
      [
        "repeat repeat repeat retrieval retrieval evidence",
        "La preuve répétée répétée reste locale.",
        "本地检索本地检索保留证据。",
        "token_rotation token_rotation policy-v2 policy-v2",
      ],
      config,
    )

    expect(createHash("sha256").update(JSON.stringify(embeddings)).digest("hex")).toBe(
      "ff73d6acfd912077a9ec4461e36b9db729f8fa10e40c500fffd95ed0a93ee868",
    )
  })

  it("keeps inflected terms closer than unrelated text", async () => {
    const config = testConfig()
    const query = await embedText("token rotation", config)
    const related = await embedTexts(["tokens must be rotated"], config)
    const unrelated = await embedTexts(["facility maintenance calendar"], config)

    expect(dotProduct(query, related[0] ?? [])).toBeGreaterThan(
      dotProduct(query, unrelated[0] ?? []),
    )
  })
})

describe("embedding model adapters", () => {
  it("reuses a single-query embedding without caching document vectors or sharing mutable arrays", async () => {
    const extractor = vi.fn(async (texts: string[]) => ({
      tolist: () => texts.map(() => [0.25, 0.75]),
    }))
    transformersMock.pipeline.mockResolvedValue(extractor)
    const config = transformerConfig()

    const first = await embedText("same evidence", config)
    first[0] = 99
    expect(await embedText("same evidence", config)).toEqual([0.25, 0.75])
    await embedTexts(["same evidence"], config)
    await embedTexts(["same evidence"], config)

    expect(extractor).toHaveBeenCalledTimes(3)
  })

  it("isolates query vectors by project root and exact model identity", async () => {
    const extractor = vi.fn(async (texts: string[]) => ({
      tolist: () => texts.map(() => [1, 0]),
    }))
    transformersMock.pipeline.mockResolvedValue(extractor)
    const config = transformerConfig()
    await embedText("same evidence", config)
    await embedText("same evidence", { ...config, projectRoot: "/tmp/another-project" })
    await embedText("same evidence", { ...config, embeddingModelRevision: "new-revision" })
    await embedText("same evidence", {
      ...config,
      embeddingModelDigest: `sha256:${"a".repeat(64)}`,
    })

    expect(extractor).toHaveBeenCalledTimes(4)
    expect(transformersMock.pipeline).toHaveBeenCalledTimes(3)
  })

  it("evicts the least recently used query when the entry limit is reached", async () => {
    const extractor = vi.fn(async (texts: string[]) => ({
      tolist: () => texts.map(() => [1, 0]),
    }))
    transformersMock.pipeline.mockResolvedValue(extractor)
    const config = transformerConfig()
    for (let index = 0; index < 128; index += 1) await embedText(`query ${index}`, config)
    await embedText("query 0", config)
    await embedText("query 128", config)
    await embedText("query 0", config)
    expect(extractor).toHaveBeenCalledTimes(129)

    await embedText("query 1", config)
    expect(extractor).toHaveBeenCalledTimes(130)
  })

  it("bounds cached vector values independently from the entry count", async () => {
    const extractor = vi.fn(async (texts: string[]) => ({
      tolist: () => texts.map(() => Array.from({ length: 40_000 }, () => 1)),
    }))
    transformersMock.pipeline.mockResolvedValue(extractor)
    const config = transformerConfig()
    await embedText("first", config)
    await embedText("second", config)
    await embedText("second", config)
    expect(extractor).toHaveBeenCalledTimes(2)

    await embedText("first", config)
    expect(extractor).toHaveBeenCalledTimes(3)
  })

  it("does not cache a vector larger than the total cache budget", async () => {
    const extractor = vi.fn(async (texts: string[]) => ({
      tolist: () => texts.map(() => Array.from({ length: 65_537 }, () => 1)),
    }))
    transformersMock.pipeline.mockResolvedValue(extractor)
    const config = transformerConfig()
    await embedText("oversized", config)
    await embedText("oversized", config)

    expect(extractor).toHaveBeenCalledTimes(2)
  })

  it("retries failed inference and drops query vectors when the model is disposed", async () => {
    const extractor = vi.fn(async (texts: string[]) => ({
      tolist: () => texts.map(() => [1, 0]),
    }))
    extractor.mockRejectedValueOnce(new Error("inference failed"))
    transformersMock.pipeline.mockResolvedValue(extractor)
    const config = transformerConfig()

    await expect(embedText("same evidence", config)).rejects.toThrow("inference failed")
    await expect(embedText("same evidence", config)).resolves.toEqual([1, 0])
    await embedText("same evidence", config)
    expect(extractor).toHaveBeenCalledTimes(2)
    await disposeTransformersCache()
    await embedText("same evidence", config)
    expect(extractor).toHaveBeenCalledTimes(3)
  })

  it("rejects an aborted cached query without running inference", async () => {
    const extractor = vi.fn(async (texts: string[]) => ({
      tolist: () => texts.map(() => [1, 0]),
    }))
    transformersMock.pipeline.mockResolvedValue(extractor)
    const config = transformerConfig()
    await embedText("same evidence", config)
    const controller = new AbortController()
    controller.abort()

    await expect(embedText("same evidence", config, controller.signal)).rejects.toMatchObject({
      code: "ABORTED",
    })
    expect(extractor).toHaveBeenCalledTimes(1)
  })

  it("refreshes search evidence after ingestion while reusing the query vector", async () => {
    const extractor = vi.fn(async (texts: string[]) => ({
      tolist: () => texts.map(() => [1, 0]),
    }))
    transformersMock.pipeline.mockResolvedValue(extractor)
    const modelConfig = await transformerArtifactConfig()
    const root = path.dirname(modelConfig.embeddingModelPath)
    const config = testConfig(root, {
      embeddingProvider: "transformers",
      embeddingModel: modelConfig.embeddingModel,
      embeddingModelRevision: modelConfig.embeddingModelRevision,
      embeddingModelPath: modelConfig.embeddingModelPath,
    })
    await mkdir(config.rawDir, { recursive: true })
    const sourcePath = path.join(config.rawDir, "decision.md")
    await writeFile(sourcePath, "Production approval requires the original evidence.\n")
    const reader = await RagmirClient.createWithConfig(config)
    let writer: RagmirClient | undefined
    try {
      await reader.ingest()
      const first = await reader.search("production approval")
      const warm = await reader.search("production approval")
      expect(warm).toEqual(first)

      await writeFile(sourcePath, "Production approval now requires signed refreshed evidence.\n")
      writer = await RagmirClient.createWithConfig(config)
      await writer.ingest({ rebuild: true })
      await writer.close()
      const inferenceCalls = extractor.mock.calls.length
      const refreshed = await reader.search("production approval")

      expect(refreshed[0]?.text).toContain("signed refreshed evidence")
      expect(refreshed[0]?.evidence.id).not.toBe(first[0]?.evidence.id)
      expect(extractor).toHaveBeenCalledTimes(inferenceCalls)
    } finally {
      await writer?.close()
      await reader.close()
    }
  })

  it("bounds every semantic model call and preserves input order across batches", async () => {
    const extractor = vi.fn(async (texts: string[]) => ({
      tolist: () => texts.map((text) => [Number(text.match(/\d+$/u)?.[0]), 0]),
    }))
    transformersMock.pipeline.mockResolvedValue(extractor)
    const config = transformerConfig({ embeddingBatchSize: 2 })

    expect(await embedTexts(["row 0", "row 1", "row 2", "row 3", "row 4"], config)).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
    ])
    expect(extractor.mock.calls.map(([texts]) => texts.length)).toEqual([2, 2, 1])
  })

  it("enforces the hard batch ceiling even for a directly supplied config", async () => {
    const extractor = vi.fn(async (texts: string[]) => ({
      tolist: () => texts.map(() => [1, 0]),
    }))
    transformersMock.pipeline.mockResolvedValue(extractor)

    await embedTexts(
      Array.from({ length: 129 }, () => "evidence"),
      transformerConfig({ embeddingBatchSize: 1_000 }),
    )
    expect(extractor.mock.calls.map(([texts]) => texts.length)).toEqual([128, 1])
  })

  it("stops between semantic batches and releases the model after cancellation", async () => {
    const controller = new AbortController()
    const dispose = vi.fn(async () => undefined)
    const extractor = vi.fn(async (texts: string[]) => {
      controller.abort()
      return { tolist: () => texts.map(() => [1, 0]) }
    })
    transformersMock.pipeline.mockResolvedValue(Object.assign(extractor, { dispose }))

    await expect(
      embedTexts(
        ["first", "second", "third"],
        transformerConfig({ embeddingBatchSize: 2 }),
        "document",
        controller.signal,
      ),
    ).rejects.toMatchObject({ code: "ABORTED" })
    expect(extractor).toHaveBeenCalledTimes(1)
    await disposeTransformersCache()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it("adds the asymmetric E5 retrieval prefixes", () => {
    const model = "intfloat/multilingual-e5-small"

    expect(prepareEmbeddingText("where is the policy", model, "query")).toBe(
      "query: where is the policy",
    )
    expect(prepareEmbeddingText("policy evidence", model, "document")).toBe(
      "passage: policy evidence",
    )
  })

  it("should restore the Transformers environment after creating a local extractor", async () => {
    const snapshots: Array<typeof transformersMock.env> = []
    transformersMock.pipeline.mockImplementation(async () => {
      snapshots.push({ ...transformersMock.env })
      return async (texts: string[]) => ({ tolist: () => texts.map(() => [0.25, 0.75]) })
    })
    const config = transformerConfig({
      embeddingModelPath: "/tmp/ragmir-transformer-model",
      transformersAllowRemoteModels: true,
    })

    await expect(embedTexts(["first", "second"], config)).resolves.toEqual([
      [0.25, 0.75],
      [0.25, 0.75],
    ])
    expect(snapshots).toEqual([
      {
        localModelPath: "/tmp/ragmir-transformer-model",
        cacheDir: "/tmp/ragmir-transformer-model",
        allowLocalModels: true,
        allowRemoteModels: true,
      },
    ])
    expect(transformersMock.env).toEqual({
      localModelPath: "initial-local-path",
      cacheDir: "initial-cache-dir",
      allowLocalModels: true,
      allowRemoteModels: false,
    })
  })

  it("should restore the Transformers environment when pipeline creation fails", async () => {
    transformersMock.pipeline.mockRejectedValue(new Error("model load failed"))

    await expect(embedTexts(["query"], transformerConfig())).rejects.toThrow("model load failed")
    expect(transformersMock.env).toEqual({
      localModelPath: "initial-local-path",
      cacheDir: "initial-cache-dir",
      allowLocalModels: true,
      allowRemoteModels: false,
    })
  })

  it("should reject a Transformers result with the wrong batch cardinality", async () => {
    transformersMock.pipeline.mockResolvedValue(async () => ({ tolist: () => [[1, 0]] }))

    await expect(embedTexts(["first", "second"], transformerConfig())).rejects.toThrow(
      "Expected 2 embeddings, received 1",
    )
  })

  it("should reject a non-numeric Transformers tensor", async () => {
    transformersMock.pipeline.mockResolvedValue(async () => ({
      tolist: () => [["not-a-number"]],
    }))

    await expect(embedTexts(["query"], transformerConfig())).rejects.toThrow(
      "not a numeric vector matrix",
    )
  })

  it("should enable remote loading only while explicitly pulling a model", async () => {
    let downloadEnvironment: typeof transformersMock.env | undefined
    mockTransformersDownload((env) => {
      downloadEnvironment = { ...env }
    })
    const config = await transformerArtifactConfig({ transformersAllowRemoteModels: false })

    await expect(pullEmbeddingModel(config)).resolves.toMatchObject({
      embeddingModel: "test/embedding-model",
      embeddingModelRevision: "test-revision",
      embeddingModelDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      embeddingModelPath: config.embeddingModelPath,
    })
    expect(downloadEnvironment).toMatchObject({ allowRemoteModels: true, allowLocalModels: false })
    expect(downloadEnvironment?.cacheDir).not.toBe(config.embeddingModelPath)
    expect(transformersMock.env).toMatchObject({
      cacheDir: "initial-cache-dir",
      allowLocalModels: true,
      allowRemoteModels: false,
    })
  })

  it("should install the pinned revision where offline discovery reads it", async () => {
    mockTransformersDownload()
    const config = await transformerArtifactConfig()
    const modelRoot = path.join(config.embeddingModelPath, "test", "embedding-model")

    const result = await pullEmbeddingModel(config)

    expect((await listFiles(modelRoot)).sort()).toEqual(Object.keys(revisionArtifacts).sort())
    await expect(readFile(path.join(modelRoot, "config.json"), "utf8")).resolves.toBe(
      revisionArtifacts["config.json"],
    )
    expect(result.embeddingModelDigest).toBe(await embeddingModelArtifactDigest(config))
    expect(await readdir(config.embeddingModelPath)).toEqual(["test"])
    expect(await readdir(path.join(config.embeddingModelPath, "test"))).toEqual(["embedding-model"])
  })

  it.skipIf(process.platform === "win32")(
    "should create the model directory with owner-only permissions",
    async () => {
      mockTransformersDownload()
      const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-embedding-private-"))
      tempDirs.push(root)
      const config = transformerConfig({ embeddingModelPath: path.join(root, "models") })

      await pullEmbeddingModel(config)

      expect((await stat(config.embeddingModelPath)).mode & 0o077).toBe(0)
    },
  )

  it("should keep the installed model when the download cannot load offline", async () => {
    mockTransformersDownload(undefined, { omit: "tokenizer_config.json" })
    const config = await transformerArtifactConfig()
    const modelRoot = path.join(config.embeddingModelPath, "test", "embedding-model")
    const before = await embeddingModelArtifactDigest(config)

    await expect(pullEmbeddingModel(config)).rejects.toThrow(
      "did not download tokenizer_config.json",
    )
    expect(await embeddingModelArtifactDigest(config)).toBe(before)
    expect(await readdir(config.embeddingModelPath)).toEqual(["test"])
    await expect(readFile(path.join(modelRoot, "config.json"), "utf8")).resolves.toBe(
      '{"model_type":"test"}\n',
    )
  })

  it("should keep the installed model when the recorded digest does not match", async () => {
    mockTransformersDownload()
    const config = await transformerArtifactConfig({
      embeddingModelDigest: `sha256:${"0".repeat(64)}`,
    })
    const before = await embeddingModelArtifactDigest(config)

    await expect(pullEmbeddingModel(config)).rejects.toThrow("Embedding model digest mismatch")
    expect(await embeddingModelArtifactDigest(config)).toBe(before)
  })

  it("should replace an unloadable revision cache recorded by an earlier pull", async () => {
    mockTransformersDownload()
    const config = await transformerArtifactConfig()
    const modelRoot = path.join(config.embeddingModelPath, "test", "embedding-model")
    await rm(modelRoot, { recursive: true, force: true })
    await writeArtifacts(path.join(modelRoot, "test-revision"), revisionArtifacts, {
      omit: "config.json",
    })
    await writeFile(
      path.join(modelRoot, "config.json"),
      '{"model_type":"test","revision":"main"}\n',
    )
    const legacyDigest = await embeddingModelArtifactDigest(config)

    const result = await pullEmbeddingModel({ ...config, embeddingModelDigest: legacyDigest })

    expect(result.embeddingModelDigest).not.toBe(legacyDigest)
    expect((await listFiles(modelRoot)).sort()).toEqual(Object.keys(revisionArtifacts).sort())
  })

  it("should explain a pipeline that Transformers.js loaded without its tokenizer", async () => {
    const dispose = vi.fn(async () => undefined)
    transformersMock.pipeline.mockResolvedValue(
      Object.assign(async (texts: string[]) => ({ tolist: () => texts.map(() => [1, 0]) }), {
        dispose,
        tokenizer: null,
      }),
    )

    await expect(embedTexts(["query"], transformerConfig())).rejects.toThrow(
      "Run `rgr models pull --enable`",
    )
    expect(dispose).toHaveBeenCalledOnce()
  })

  it("should deduplicate concurrent creation of the same Transformers pipeline", async () => {
    let releaseCreation: (() => void) | undefined
    const creationGate = new Promise<void>((resolve) => {
      releaseCreation = resolve
    })
    transformersMock.pipeline.mockImplementation(async () => {
      await creationGate
      return async (texts: string[]) => ({ tolist: () => texts.map(() => [1, 0]) })
    })
    const config = transformerConfig()

    const first = embedTexts(["first"], config)
    const second = embedTexts(["second"], config)
    await vi.waitFor(() => expect(transformersMock.pipeline).toHaveBeenCalledTimes(1))
    releaseCreation?.()

    await expect(Promise.all([first, second])).resolves.toEqual([[[1, 0]], [[1, 0]]])
    expect(transformersMock.pipeline).toHaveBeenCalledTimes(1)
  })

  it("should defer disposal until an active inference releases its lease", async () => {
    let releaseInference: (() => void) | undefined
    const inferenceGate = new Promise<void>((resolve) => {
      releaseInference = resolve
    })
    let inferenceStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      inferenceStarted = resolve
    })
    const dispose = vi.fn(async () => undefined)
    const extractor = Object.assign(
      async (texts: string[]) => {
        inferenceStarted?.()
        await inferenceGate
        return { tolist: () => texts.map(() => [1, 0]) }
      },
      { dispose },
    )
    transformersMock.pipeline.mockResolvedValue(extractor)
    const config = transformerConfig()
    const inference = embedTexts(["first"], config)
    await started

    const disposal = disposeTransformersCache()
    await Promise.resolve()
    expect(dispose).not.toHaveBeenCalled()
    expect(transformersCacheSnapshotForTests()).toMatchObject({ entries: 0 })
    releaseInference?.()

    await expect(inference).resolves.toEqual([[1, 0]])
    await disposal
    expect(dispose).toHaveBeenCalledOnce()
  })

  it("should keep concurrent Transformers pipeline creation within the LRU capacity", async () => {
    const disposals: Array<ReturnType<typeof vi.fn>> = []
    transformersMock.pipeline.mockImplementation(async () => {
      const dispose = vi.fn(async () => undefined)
      disposals.push(dispose)
      return Object.assign(async (texts: string[]) => ({ tolist: () => texts.map(() => [1, 0]) }), {
        dispose,
      })
    })

    await Promise.all(
      Array.from({ length: 4 }, (_value, index) =>
        embedTexts(
          [`model-${index}`],
          transformerConfig({ embeddingModel: `test/embedding-model-${index}` }),
        ),
      ),
    )

    expect(disposals.filter((dispose) => dispose.mock.calls.length > 0)).toHaveLength(3)
    await disposeTransformersCache()
    expect(disposals.every((dispose) => dispose.mock.calls.length === 1)).toBe(true)
  })

  it("should cache a new pipeline when disposing an evicted pipeline fails", async () => {
    const disposals: Array<ReturnType<typeof vi.fn>> = []
    transformersMock.pipeline.mockImplementation(async () => {
      const dispose =
        disposals.length === 0
          ? vi.fn(async () => {
              throw new Error("dispose failed")
            })
          : vi.fn(async () => undefined)
      disposals.push(dispose)
      return Object.assign(async (texts: string[]) => ({ tolist: () => texts.map(() => [1, 0]) }), {
        dispose,
      })
    })

    for (let index = 0; index < 3; index += 1) {
      await embedTexts(
        [`model-${index}`],
        transformerConfig({ embeddingModel: `test/embedding-model-${index}` }),
      )
    }

    await expect(
      embedTexts(["new model"], transformerConfig({ embeddingModel: "test/new-model" })),
    ).resolves.toEqual([[1, 0]])
    expect(disposals[0]).toHaveBeenCalledOnce()
  })

  it("should dispose cached Transformers pipelines during deterministic cleanup", async () => {
    const dispose = vi.fn(async () => undefined)
    const extractor = Object.assign(
      async (texts: string[]) => ({ tolist: () => texts.map(() => [1, 0]) }),
      { dispose },
    )
    transformersMock.pipeline.mockResolvedValue(extractor)

    await embedTexts(["query"], transformerConfig())
    await disposeTransformersCache()

    expect(dispose).toHaveBeenCalledOnce()
  })

  it("should keep a shared pipeline until the final client owner closes", async () => {
    const dispose = vi.fn(async () => undefined)
    transformersMock.pipeline.mockResolvedValue(
      Object.assign(async (texts: string[]) => ({ tolist: () => texts.map(() => [1, 0]) }), {
        dispose,
      }),
    )
    const config = transformerConfig()
    const releaseFirst = retainEmbeddingModel(config)
    const releaseSecond = retainEmbeddingModel(config)
    await embedTexts(["query"], config)

    await releaseFirst()
    expect(dispose).not.toHaveBeenCalled()
    await releaseSecond()

    expect(dispose).toHaveBeenCalledOnce()
    expect(transformersCacheSnapshotForTests()).toEqual({
      entries: 0,
      activeLeases: 0,
      owners: 0,
    })
  })

  it("should produce the same digest and policy fingerprint for identical clean artifacts", async () => {
    mockTransformersDownload()
    const firstConfig = await transformerArtifactConfig()
    const secondConfig = await transformerArtifactConfig()

    const first = await pullEmbeddingModel(firstConfig)
    const second = await pullEmbeddingModel(secondConfig)

    expect(second.embeddingModelDigest).toBe(first.embeddingModelDigest)
    expect(
      indexPolicyFingerprint({
        ...firstConfig,
        embeddingModelDigest: first.embeddingModelDigest,
      }),
    ).toBe(
      indexPolicyFingerprint({
        ...secondConfig,
        embeddingModelDigest: second.embeddingModelDigest,
      }),
    )
  })
})

describe("clearTransformersCache", () => {
  it("runs without error and is safe to call when nothing is cached", () => {
    expect(() => clearTransformersCache()).not.toThrow()
  })

  it("should stop reusing a cached pipeline when disposal is still running", async () => {
    let releaseDisposal: (() => void) | undefined
    const disposalGate = new Promise<void>((resolve) => {
      releaseDisposal = resolve
    })
    let pipelineNumber = 0
    transformersMock.pipeline.mockImplementation(async () => {
      pipelineNumber += 1
      const value = pipelineNumber
      return Object.assign(
        async (texts: string[]) => ({ tolist: () => texts.map(() => [value, 0]) }),
        { dispose: vi.fn(async () => disposalGate) },
      )
    })
    const config = transformerConfig()

    await expect(embedTexts(["first"], config)).resolves.toEqual([[1, 0]])
    clearTransformersCache()
    const refreshed = embedTexts(["second"], config)
    await vi.waitFor(() => expect(transformersMock.pipeline).toHaveBeenCalledTimes(2))
    releaseDisposal?.()

    await expect(refreshed).resolves.toEqual([[2, 0]])
  })
})

function vectorMagnitude(vector: number[]): number {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
}

function dotProduct(left: number[], right: number[]): number {
  return left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0)
}

function transformerConfig(overrides: Partial<Config> = {}): Config {
  return testConfig({
    embeddingProvider: "transformers",
    embeddingModel: "test/embedding-model",
    embeddingModelRevision: "test-revision",
    embeddingModelPath: "/tmp/ragmir-embedding-model",
    transformersAllowRemoteModels: false,
    ...overrides,
  })
}

/**
 * Mirror the Transformers.js 4.3 file cache: a remote pipeline stores the pinned revision under
 * `<cacheDir>/<model>/<revision>/` and the main-revision discovery config at `<cacheDir>/<model>/`.
 */
function mockTransformersDownload(
  onCreate?: (env: typeof transformersMock.env) => void,
  options: { omit?: string } = {},
): void {
  transformersMock.pipeline.mockImplementation(
    async (_task: string, model: string, { revision }: { revision: string }) => {
      const env = transformersMock.env
      onCreate?.(env)
      if (env.allowRemoteModels) {
        const modelCache = path.join(env.cacheDir, model)
        await writeArtifacts(path.join(modelCache, revision), revisionArtifacts, options)
        await writeFile(
          path.join(modelCache, "config.json"),
          '{"model_type":"test","revision":"main"}\n',
        )
      }
      return async (texts: string[]) => ({ tolist: () => texts.map(() => [1, 0]) })
    },
  )
}

async function writeArtifacts(
  directory: string,
  artifacts: Record<string, string>,
  options: { omit?: string } = {},
): Promise<void> {
  for (const [name, content] of Object.entries(artifacts)) {
    if (name === options.omit) {
      continue
    }
    await mkdir(path.dirname(path.join(directory, name)), { recursive: true })
    await writeFile(path.join(directory, name), content)
  }
}

async function listFiles(directory: string, prefix = ""): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name
    files.push(
      ...(entry.isDirectory() ? await listFiles(path.join(directory, entry.name), name) : [name]),
    )
  }
  return files
}

async function transformerArtifactConfig(overrides: Partial<Config> = {}): Promise<Config> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-embedding-artifact-"))
  tempDirs.push(root)
  const embeddingModelPath = path.join(root, "models")
  const modelRoot = path.join(embeddingModelPath, "test", "embedding-model")
  await mkdir(path.join(modelRoot, "onnx"), { recursive: true })
  await Promise.all([
    writeFile(path.join(modelRoot, "config.json"), '{"model_type":"test"}\n'),
    writeFile(path.join(modelRoot, "onnx", "model.onnx"), "deterministic-model"),
    writeFile(path.join(modelRoot, "tokenizer.json"), '{"version":"1.0"}\n'),
  ])
  return transformerConfig({ embeddingModelPath, ...overrides })
}
