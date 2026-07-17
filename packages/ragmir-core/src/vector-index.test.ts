import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { connectStore, openRowsTable, writeRows } from "./store.js"
import { testConfig } from "./test-support/config.js"
import type { Config, VectorRow } from "./types.js"
import {
  ANN_MINIMUM_ROWS,
  adaptiveVectorIndexPolicy,
  configureAdaptiveVectorQuery,
  maintainAdaptiveIndices,
  vectorIndexManifestCompatible,
  vectorModelFingerprint,
} from "./vector-index.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const directory of tempDirs.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

describe("adaptive vector indexing", () => {
  it("should keep exact search below the measured crossover", () => {
    expect(adaptiveVectorIndexPolicy(ANN_MINIMUM_ROWS - 1, 384)).toEqual({
      strategy: "exact",
      parameters: {},
    })
    expect(adaptiveVectorIndexPolicy(ANN_MINIMUM_ROWS, 384)).toEqual({
      strategy: "ivf-pq",
      parameters: {
        numPartitions: 316,
        numSubVectors: 24,
        nprobes: 32,
        refineFactor: 10,
      },
    })
    expect(adaptiveVectorIndexPolicy(1_000_000, 384)).toEqual({
      strategy: "ivf-pq",
      parameters: {
        numPartitions: 1_000,
        numSubVectors: 24,
        nprobes: 1_000,
        refineFactor: 100,
      },
    })
  })

  it("should leave a small table on exact search without scalar index overhead", async () => {
    const { config, table } = await tableFixture(32)

    const report = await maintainAdaptiveIndices(table, config)

    expect(report.desiredVectorStrategy).toBe("exact")
    expect(report.vectorIndex).toEqual(
      expect.objectContaining({ strategy: "exact", coverage: 1, indexedRows: 32 }),
    )
    expect(report.relativePathIndex.present).toBe(false)
    expect(report.plannedActions).toEqual([])
  })

  it("should build complete adaptive and relative-path indices above their gates", async () => {
    const { config, table } = await tableFixture(2_000)

    const report = await maintainAdaptiveIndices(table, config, {
      annMinimumRows: 1_000,
      scalarMinimumRows: 1_000,
    })

    expect(report.completedActions).toEqual(["create-vector-index", "create-relative-path-index"])
    expect(report.vectorIndex).toEqual(
      expect.objectContaining({
        strategy: "ivf-pq",
        indexType: "IVF_PQ",
        indexedRows: 2_000,
        unindexedRows: 0,
        coverage: 1,
      }),
    )
    expect(report.relativePathIndex).toEqual(
      expect.objectContaining({ indexType: "BTREE", indexedRows: 2_000, coverage: 1 }),
    )

    const unchanged = await maintainAdaptiveIndices(table, config, {
      annMinimumRows: 1_000,
      scalarMinimumRows: 1_000,
      previousPolicySignature: report.policySignature,
    })
    expect(unchanged.plannedActions).toEqual([])

    const changed = await maintainAdaptiveIndices(table, config, {
      annMinimumRows: 1_000,
      scalarMinimumRows: 1_000,
      previousPolicySignature: "outdated-policy",
    })
    expect(changed.completedActions).toContain("refresh-vector-index")
  })

  it("should fall back to exact search when an ANN policy refresh fails", async () => {
    const { config, table } = await tableFixture(2_000)
    const initial = await maintainAdaptiveIndices(table, config, {
      annMinimumRows: 1_000,
    })
    vi.spyOn(table, "createIndex").mockRejectedValueOnce(new Error("simulated refresh failure"))

    const report = await maintainAdaptiveIndices(table, config, {
      annMinimumRows: 1_000,
      previousPolicySignature: "outdated-policy",
    })

    expect(initial.vectorIndex.strategy).toBe("ivf-pq")
    expect(report.warning).toContain("simulated refresh failure")
    expect(report.vectorIndex.strategy).toBe("exact")
    expect(report.vectorIndex.parameters).toEqual({})
  })

  it("should refresh ANN coverage and preserve exact top ten results", async () => {
    const { config, table } = await tableFixture(2_000)
    const initial = await maintainAdaptiveIndices(table, config, {
      annMinimumRows: 1_000,
      scalarMinimumRows: 1_000,
    })
    const extraRow = rowFor(config, 2_000)
    await table.add([extraRow])

    const refreshed = await maintainAdaptiveIndices(table, config, {
      annMinimumRows: 1_000,
      scalarMinimumRows: 1_000,
    })
    const exact = await configureAdaptiveVectorQuery(
      table.vectorSearch(extraRow.vector).select(["id", "_distance"]).limit(10),
      refreshed.vectorIndex,
      true,
    ).toArray()
    const adaptive = await configureAdaptiveVectorQuery(
      table.vectorSearch(extraRow.vector).select(["id", "_distance"]).limit(10),
      refreshed.vectorIndex,
      false,
    ).toArray()

    expect(initial.vectorIndex.coverage).toBe(1)
    expect(refreshed.completedActions).toEqual([
      "refresh-vector-index",
      "refresh-relative-path-index",
    ])
    expect(refreshed.vectorIndex.coverage).toBe(1)
    expect(adaptive.map((row) => row.id)).toEqual(exact.map((row) => row.id))
  })

  it("should bind index compatibility to model revision, dimension, and metric", () => {
    const config = testConfig(undefined, { embeddingModelRevision: "revision-a" })
    const fingerprint = vectorModelFingerprint(config, 384)
    const manifest = {
      policyVersion: 1 as const,
      strategy: "exact" as const,
      indexName: null,
      indexType: null,
      column: "vector" as const,
      distanceMetric: "l2",
      dimension: 384,
      modelFingerprint: fingerprint,
      indexedRows: 10,
      unindexedRows: 0,
      coverage: 1,
      parameters: {},
    }

    expect(vectorIndexManifestCompatible(manifest, config, 384)).toBe(true)
    expect(
      vectorIndexManifestCompatible(
        manifest,
        testConfig(undefined, { embeddingModelRevision: "revision-b" }),
        384,
      ),
    ).toBe(false)
    expect(vectorIndexManifestCompatible(manifest, config, 768)).toBe(false)
  })
})

async function tableFixture(rowCount: number): Promise<{
  config: Config
  table: NonNullable<Awaited<ReturnType<typeof openRowsTable>>>
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-vector-index-test-"))
  tempDirs.push(root)
  const config = testConfig(root)
  await writeRows(
    Array.from({ length: rowCount }, (_, index) => rowFor(config, index)),
    config,
  )
  const connection = await connectStore(config)
  const table = await openRowsTable(config, connection)
  connection.close()
  if (!table) {
    throw new Error("Vector index test table was not created.")
  }
  return { config, table }
}

function rowFor(config: Config, index: number): VectorRow {
  const relativePath = `.ragmir/raw/vector-${index}.md`
  const vector = Array.from({ length: 16 }, (_, dimension) =>
    Math.sin((index + 1) * (dimension + 1) * 0.013),
  )
  return {
    id: `${relativePath}#0`,
    source: path.basename(relativePath),
    relativePath,
    chunkIndex: 0,
    contextPath: "Evidence",
    searchText: `Evidence\nvector row ${index}`,
    text: `vector row ${index}`,
    charStart: 0,
    charEnd: 10,
    lineStart: 1,
    lineEnd: 1,
    checksum: `checksum-${index}`,
    bytes: 10,
    mtimeMs: index + 1,
    vector,
    embeddingProvider: config.embeddingProvider,
    embeddingModel: config.embeddingModel,
  }
}
