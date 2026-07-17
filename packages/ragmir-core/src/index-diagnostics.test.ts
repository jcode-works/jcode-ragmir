import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  getIndexFreshnessWarning,
  getLexicalScanWarning,
  INDEX_SCHEMA_VERSION,
} from "./index-diagnostics.js"
import { indexPolicyFingerprint } from "./index-policy.js"
import { writeIndexManifest } from "./store.js"
import { testConfig } from "./test-support/config.js"
import type { IndexManifest } from "./types.js"
import { vectorModelFingerprint } from "./vector-index.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

function baseManifest(overrides: Partial<IndexManifest> = {}): IndexManifest {
  const config = testConfig()
  return {
    schemaVersion: INDEX_SCHEMA_VERSION,
    createdAt: "2026-01-01T00:00:00.000Z",
    ragmirVersion: "0.4.12",
    embeddingProvider: "local-hash",
    embeddingModel: "intfloat/multilingual-e5-small",
    embeddingModelRevision: config.embeddingModelRevision,
    embeddingModelDigest: config.embeddingModelDigest,
    indexPolicyFingerprint: indexPolicyFingerprint(config),
    vectorDimension: 384,
    vectorDistanceMetric: "l2",
    vectorIndex: {
      policyVersion: 1,
      strategy: "exact",
      indexName: null,
      indexType: null,
      column: "vector",
      distanceMetric: "l2",
      dimension: 384,
      modelFingerprint: vectorModelFingerprint(config, 384),
      indexedRows: 1,
      unindexedRows: 0,
      coverage: 1,
      parameters: {},
    },
    chunkSize: 1200,
    chunkOverlap: 200,
    fileCount: 1,
    chunkCount: 1,
    ...overrides,
  }
}

describe("getIndexFreshnessWarning", () => {
  it("returns null when the index manifest is absent", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-freshness-missing-"))
    tempDirs.push(root)
    const config = testConfig(root)

    expect(await getIndexFreshnessWarning(config)).toBeNull()
  })

  it("returns null when the manifest matches the active config", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-freshness-match-"))
    tempDirs.push(root)
    const config = testConfig(root)
    await writeIndexManifest(baseManifest(), config)

    expect(await getIndexFreshnessWarning(config)).toBeNull()
  })

  it("warns when the embedding provider differs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-freshness-provider-"))
    tempDirs.push(root)
    const config = testConfig(root, { embeddingProvider: "transformers" })
    await writeIndexManifest(baseManifest({ embeddingProvider: "local-hash" }), config)

    const warning = await getIndexFreshnessWarning(config)
    expect(warning).not.toBeNull()
    expect(warning).toContain('"local-hash"')
    expect(warning).toContain('"transformers"')
  })

  it("warns when the embedding model differs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-freshness-model-"))
    tempDirs.push(root)
    const config = testConfig(root, { embeddingModel: "Xenova/all-MiniLM-L6-v2" })
    await writeIndexManifest(
      baseManifest({ embeddingModel: "intfloat/multilingual-e5-small" }),
      config,
    )

    const warning = await getIndexFreshnessWarning(config)
    expect(warning).not.toBeNull()
    expect(warning).toContain("Xenova/all-MiniLM-L6-v2")
  })

  it("warns when the stored schema version is older than the current one", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-freshness-schema-"))
    tempDirs.push(root)
    const config = testConfig(root)
    await writeIndexManifest(baseManifest({ schemaVersion: 0 }), config)

    const warning = await getIndexFreshnessWarning(config)
    expect(warning).not.toBeNull()
    expect(warning).toContain("schema is incompatible")
  })

  it("warns when the redaction policy differs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-freshness-redaction-"))
    tempDirs.push(root)
    const config = testConfig(root, { redaction: { enabled: false, builtIn: true, patterns: [] } })
    await writeIndexManifest(baseManifest(), config)

    expect(await getIndexFreshnessWarning(config)).toContain("content policy differs")
  })

  it("warns when the chunk size differs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-freshness-chunksize-"))
    tempDirs.push(root)
    const config = testConfig(root, { chunkSize: 800 })
    await writeIndexManifest(baseManifest({ chunkSize: 1200 }), config)

    const warning = await getIndexFreshnessWarning(config)
    expect(warning).not.toBeNull()
    expect(warning).toContain("chunkSize")
  })

  it("warns when the vector distance metric differs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-freshness-metric-"))
    tempDirs.push(root)
    const config = testConfig(root)
    await writeIndexManifest({ ...baseManifest(), vectorDistanceMetric: "cosine" }, config)

    const warning = await getIndexFreshnessWarning(config)
    expect(warning).not.toBeNull()
    expect(warning).toContain("vector distance metric")
  })

  it("warns when vector index coverage is incomplete", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-freshness-vector-coverage-"))
    tempDirs.push(root)
    const config = testConfig(root)
    const manifest = baseManifest()
    const vectorIndex = manifest.vectorIndex
    if (!vectorIndex) {
      throw new Error("Expected the fixture manifest to include vector index metadata.")
    }
    await writeIndexManifest(
      {
        ...manifest,
        vectorIndex: {
          ...vectorIndex,
          indexedRows: 0,
          unindexedRows: 1,
          coverage: 0,
        },
      },
      config,
    )

    expect(await getIndexFreshnessWarning(config)).toContain("coverage is incomplete")
  })
})

describe("getLexicalScanWarning", () => {
  it("returns null when the chunk count is within the limit", () => {
    const config = testConfig({ hybridTextScanLimit: 5000 })
    expect(getLexicalScanWarning(config, 5000)).toBeNull()
  })

  it("warns when the chunk count exceeds the limit", () => {
    const config = testConfig({ hybridTextScanLimit: 5000 })
    const warning = getLexicalScanWarning(config, 8000)
    expect(warning).not.toBeNull()
    expect(warning).toContain("5000")
    expect(warning).toContain("8000")
    expect(warning).toContain("hybridTextScanLimit")
  })
})
