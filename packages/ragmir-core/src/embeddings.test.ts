import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  clearTransformersCache,
  disposeTransformersCache,
  embedText,
  embedTexts,
  prepareEmbeddingText,
  pullEmbeddingModel,
} from "./embeddings.js"
import { testConfig } from "./test-support/config.js"
import type { Config } from "./types.js"

const transformersMock = vi.hoisted(() => ({
  env: {
    localModelPath: "initial-local-path",
    cacheDir: "initial-cache-dir",
    allowRemoteModels: false,
  },
  pipeline: vi.fn(),
}))

vi.mock("@huggingface/transformers", () => transformersMock)

beforeEach(async () => {
  await disposeTransformersCache()
  transformersMock.env.localModelPath = "initial-local-path"
  transformersMock.env.cacheDir = "initial-cache-dir"
  transformersMock.env.allowRemoteModels = false
  transformersMock.pipeline.mockReset()
  transformersMock.pipeline.mockImplementation(async () => async (texts: string[]) => ({
    tolist: () => texts.map((_text, index) => [index + 1, 0]),
  }))
})

afterEach(async () => {
  await disposeTransformersCache()
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
        allowRemoteModels: true,
      },
    ])
    expect(transformersMock.env).toEqual({
      localModelPath: "initial-local-path",
      cacheDir: "initial-cache-dir",
      allowRemoteModels: false,
    })
  })

  it("should restore the Transformers environment when pipeline creation fails", async () => {
    transformersMock.pipeline.mockRejectedValue(new Error("model load failed"))

    await expect(embedTexts(["query"], transformerConfig())).rejects.toThrow("model load failed")
    expect(transformersMock.env).toEqual({
      localModelPath: "initial-local-path",
      cacheDir: "initial-cache-dir",
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
    let allowRemoteModelsDuringCreation = false
    transformersMock.pipeline.mockImplementation(async () => {
      allowRemoteModelsDuringCreation = transformersMock.env.allowRemoteModels
      return async (texts: string[]) => ({ tolist: () => texts.map(() => [1, 0]) })
    })
    const config = transformerConfig({ transformersAllowRemoteModels: false })

    await expect(pullEmbeddingModel(config)).resolves.toMatchObject({
      embeddingModel: "test/embedding-model",
      embeddingModelPath: "/tmp/ragmir-embedding-model",
    })
    expect(allowRemoteModelsDuringCreation).toBe(true)
    expect(transformersMock.env.allowRemoteModels).toBe(false)
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

  it("should reject every waiter when the cache is cleared during pipeline loading", async () => {
    let releaseCreation: (() => void) | undefined
    const creationGate = new Promise<void>((resolve) => {
      releaseCreation = resolve
    })
    const dispose = vi.fn(async () => undefined)
    const extractor = Object.assign(
      async (texts: string[]) => ({ tolist: () => texts.map(() => [1, 0]) }),
      { dispose },
    )
    transformersMock.pipeline.mockImplementation(async () => {
      await creationGate
      return extractor
    })
    const config = transformerConfig()
    const first = embedTexts(["first"], config)
    const second = embedTexts(["second"], config)
    await vi.waitFor(() => expect(transformersMock.pipeline).toHaveBeenCalledOnce())

    await disposeTransformersCache()
    releaseCreation?.()

    const results = await Promise.allSettled([first, second])
    expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"])
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

    expect(disposals.filter((dispose) => dispose.mock.calls.length > 0)).toHaveLength(1)
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
