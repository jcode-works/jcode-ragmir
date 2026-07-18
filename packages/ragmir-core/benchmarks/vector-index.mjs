import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import * as lancedb from "@lancedb/lancedb"
import { directorySize, environmentMetadata, measureSeries } from "./lib/metrics.mjs"

const PRESETS = { XS: 1_683, S: 10_000, M: 100_000, L: 1_000_000 }
const options = parseArguments(process.argv.slice(2))
const sizes = String(options.sizes ?? "S")
  .split(",")
  .map((value) => value.trim().toUpperCase())
  .filter(Boolean)
const dimension = positiveInteger(options.dimension ?? 384, "dimension")
const requestedNprobes = optionalPositiveInteger(options.nprobes, "nprobes")
const requestedRefineFactor = optionalPositiveInteger(options.refineFactor, "refineFactor")
const ef = positiveInteger(options.ef ?? 200, "ef")
const quick = options.quick === true
const samples = quick ? 20 : 100
const warmups = quick ? 3 : 10
const repetitions = quick ? 1 : 5
const queryCount = Math.min(samples, 100)
const reports = []

for (const size of sizes) {
  const rowCount = PRESETS[size]
  if (!rowCount) {
    throw new Error(`Unknown corpus size "${size}". Expected XS, S, M, or L.`)
  }
  reports.push(
    await benchmarkSize({
      size,
      rowCount,
      dimension,
      samples,
      warmups,
      repetitions,
      queryCount,
      requestedNprobes,
      requestedRefineFactor,
      ef,
    }),
  )
}

const report = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  claimEligible: !quick && warmups >= 10 && samples >= 100 && repetitions >= 5,
  environment: environmentMetadata(),
  configuration: { sizes, dimension, warmups, samples, repetitions },
  results: reports,
  passed: reports.every((entry) => entry.passed),
}
console.log(JSON.stringify(report, null, 2))
if (!report.passed) {
  process.exitCode = 1
}

async function benchmarkSize(input) {
  const root = await mkdtemp(path.join(os.tmpdir(), `ragmir-vector-index-${input.size}-`))
  const storageDir = path.join(root, "storage")
  const memory = { start: memorySnapshot() }
  try {
    const connection = await lancedb.connect(storageDir)
    try {
      const centroids = createCentroids(input.dimension)
      const buildStartedAt = performance.now()
      const table = await createTable(connection, input, centroids)
      const dataBuildMs = performance.now() - buildStartedAt
      memory.afterDataBuild = memorySnapshot()
      const queries = Array.from({ length: input.queryCount }, (_, index) => {
        const row = Math.floor((index * input.rowCount) / input.queryCount)
        return { row, vector: vectorFor(row, input.dimension, centroids) }
      })

      const exact = await measureStrategy(table, queries, input, (query) =>
        query.bypassVectorIndex(),
      )
      const groundTruth = exact.results
      const flatStats = await table.stats()
      memory.afterExactSearch = memorySnapshot()

      const ivfPartitions = Math.max(16, Math.round(Math.sqrt(input.rowCount)))
      const ivfBuild = await timedIndexBuild(table, () =>
        lancedb.Index.ivfPq({
          distanceType: "l2",
          numPartitions: ivfPartitions,
          numSubVectors: preferredSubVectors(input.dimension),
        }),
      )
      const nprobes = Math.min(
        ivfPartitions,
        input.requestedNprobes ?? (input.rowCount >= PRESETS.L ? ivfPartitions : 32),
      )
      const refineFactor =
        input.requestedRefineFactor ?? (input.rowCount >= PRESETS.L ? 100 : 10)
      const ivf = await measureStrategy(table, queries, input, (query) =>
        query.nprobes(nprobes).refineFactor(refineFactor),
      )
      const ivfStats = await indexSnapshot(table, "vector_idx")
      memory.afterIvfPq = memorySnapshot()

      const hnswBuild = await timedIndexBuild(table, () =>
        lancedb.Index.hnswSq({
          distanceType: "l2",
          numPartitions: input.rowCount >= PRESETS.L ? 4 : 1,
          m: 20,
          efConstruction: 300,
        }),
      )
      const hnsw = await measureStrategy(table, queries, input, (query) => query.ef(input.ef))
      const hnswStats = await indexSnapshot(table, "vector_idx")
      memory.afterHnswSq = memorySnapshot()

      const scalarBefore = await measureScalarLookup(table, input, false)
      const scalarBuildStartedAt = performance.now()
      await table.createIndex("relativePath", { config: lancedb.Index.btree(), replace: true })
      const scalarBuildMs = performance.now() - scalarBuildStartedAt
      const scalarAfter = await measureScalarLookup(table, input, true)
      const scalarStats = await indexSnapshot(table, "relativePath_idx")
      memory.afterScalarIndex = memorySnapshot()

      const ivfRecallAt10 = recallAt10(groundTruth, ivf.results)
      const hnswRecallAt10 = recallAt10(groundTruth, hnsw.results)
      const exactP95 = exact.measurement.latency.p95Ms
      const recommendation = recommendedStrategy({
        exactP95,
        ivfP95: ivf.measurement.latency.p95Ms,
        ivfRecallAt10,
        hnswP95: hnsw.measurement.latency.p95Ms,
        hnswRecallAt10,
      })
      const recommendedP95 =
        recommendation === "ivf-pq"
          ? ivf.measurement.latency.p95Ms
          : recommendation === "hnsw-sq"
            ? hnsw.measurement.latency.p95Ms
            : exactP95
      const recommendedRecall =
        recommendation === "ivf-pq"
          ? ivfRecallAt10
          : recommendation === "hnsw-sq"
            ? hnswRecallAt10
            : 1
      const gates = {
        exactGroundTruthComplete: groundTruth.every((rows) => rows.length === 10),
        ivfCoverage: ivfStats?.numUnindexedRows === 0,
        hnswCoverage: hnswStats?.numUnindexedRows === 0,
        selectedRecallLoss: 1 - recommendedRecall < 0.01,
        selectedP95ImprovesOrStaysExact:
          recommendation === "exact" || recommendedP95 < exactP95,
        latencyGate:
          input.size === "M"
            ? recommendedP95 <= 300
            : input.size === "L"
              ? recommendedP95 <= 1_000
              : true,
      }
      return {
        size: input.size,
        rowCount: input.rowCount,
        dimension: input.dimension,
        dataBuildMs,
        flat: { bytes: flatStats.totalBytes, ...exact.measurement },
        ivfPq: {
          buildMs: ivfBuild.buildMs,
          parameters: {
            numPartitions: ivfPartitions,
            numSubVectors: preferredSubVectors(input.dimension),
            nprobes,
            refineFactor,
          },
          recallAt10: ivfRecallAt10,
          index: ivfStats,
          ...ivf.measurement,
        },
        hnswSq: {
          buildMs: hnswBuild.buildMs,
          parameters: {
            numPartitions: input.rowCount >= PRESETS.L ? 4 : 1,
            m: 20,
            efConstruction: 300,
            ef: input.ef,
          },
          recallAt10: hnswRecallAt10,
          index: hnswStats,
          ...hnsw.measurement,
        },
        scalarRelativePath: {
          buildMs: scalarBuildMs,
          before: scalarBefore,
          after: scalarAfter,
          index: scalarStats,
        },
        recommendation: {
          strategy: recommendation,
          p95Ms: recommendedP95,
          recallAt10: recommendedRecall,
        },
        physicalBytes: await directorySize(storageDir),
        memory,
        gates,
        passed: Object.values(gates).every(Boolean),
      }
    } finally {
      connection.close()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function memorySnapshot() {
  return {
    rssBytes: process.memoryUsage().rss,
    maxRssKiB: process.resourceUsage().maxRSS,
  }
}

function recommendedStrategy(input) {
  const candidates = [
    { strategy: "exact", p95Ms: input.exactP95, recallAt10: 1 },
    { strategy: "ivf-pq", p95Ms: input.ivfP95, recallAt10: input.ivfRecallAt10 },
    { strategy: "hnsw-sq", p95Ms: input.hnswP95, recallAt10: input.hnswRecallAt10 },
  ].filter((candidate) => 1 - candidate.recallAt10 < 0.01)
  const fastest = candidates.sort((left, right) => left.p95Ms - right.p95Ms)[0]
  if (!fastest || fastest.strategy === "exact" || fastest.p95Ms >= input.exactP95) {
    return "exact"
  }
  return fastest.strategy
}

async function createTable(connection, input, centroids) {
  const batchSize = input.size === "L" ? 2_000 : 1_000
  let table
  for (let start = 0; start < input.rowCount; start += batchSize) {
    const count = Math.min(batchSize, input.rowCount - start)
    const rows = Array.from({ length: count }, (_, offset) => {
      const row = start + offset
      return {
        id: `row-${String(row).padStart(9, "0")}`,
        relativePath: `.ragmir/raw/document-${String(row).padStart(9, "0")}.md`,
        vector: vectorFor(row, input.dimension, centroids),
      }
    })
    if (!table) {
      table = await connection.createTable("vectors", rows)
    } else {
      await table.add(rows)
    }
  }
  if (!table) {
    throw new Error("Vector benchmark did not create a table.")
  }
  return table
}

async function timedIndexBuild(table, config) {
  const startedAt = performance.now()
  await table.createIndex("vector", { config: config(), replace: true })
  return { buildMs: performance.now() - startedAt }
}

async function measureStrategy(table, queries, input, configure) {
  const results = []
  const measurement = await measureSeries({
    warmups: input.warmups,
    samples: input.samples,
    repetitions: input.repetitions,
    operation: async (index) => {
      const candidate = queries[index % queries.length]
      const rows = await configure(
        table
          .vectorSearch(candidate.vector)
          .distanceType("l2")
          .select(["id", "_distance"])
          .limit(10),
      ).toArray()
      if (index < queries.length && results.length < queries.length) {
        results[index] = rows.map((row) => row.id)
      }
    },
  })
  if (results.length < queries.length) {
    for (let index = results.length; index < queries.length; index += 1) {
      const candidate = queries[index]
      results[index] = (
        await configure(
          table
            .vectorSearch(candidate.vector)
            .distanceType("l2")
            .select(["id", "_distance"])
            .limit(10),
        ).toArray()
      ).map((row) => row.id)
    }
  }
  return { measurement, results }
}

async function measureScalarLookup(table, input, indexed) {
  const measurement = await measureSeries({
    warmups: input.warmups,
    samples: input.samples,
    repetitions: input.repetitions,
    operation: async (index) => {
      const row = Math.floor(((index % input.queryCount) * input.rowCount) / input.queryCount)
      const relativePath = `.ragmir/raw/document-${String(row).padStart(9, "0")}.md`
      const rows = await table
        .query()
        .select(["id"])
        .where(`relativePath = '${relativePath}'`)
        .limit(1)
        .toArray()
      if (rows.length !== 1) {
        throw new Error(`Scalar ${indexed ? "indexed" : "flat"} lookup missed ${relativePath}.`)
      }
    },
  })
  return measurement
}

async function indexSnapshot(table, name) {
  const stats = await table.indexStats(name)
  return stats
    ? {
        indexType: stats.indexType,
        distanceType: stats.distanceType ?? null,
        numIndexedRows: stats.numIndexedRows,
        numUnindexedRows: stats.numUnindexedRows,
        numIndices: stats.numIndices ?? null,
      }
    : null
}

function recallAt10(expected, actual) {
  let hits = 0
  let total = 0
  for (let index = 0; index < expected.length; index += 1) {
    const expectedRows = expected[index] ?? []
    const actualRows = new Set(actual[index] ?? [])
    hits += expectedRows.filter((id) => actualRows.has(id)).length
    total += expectedRows.length
  }
  return total === 0 ? 0 : hits / total
}

function createCentroids(dimension) {
  return Array.from({ length: 1_024 }, (_, cluster) =>
    normalizedVector(dimension, cluster + 1, 0),
  )
}

function vectorFor(row, dimension, centroids) {
  const centroid = centroids[row % centroids.length]
  const noise = normalizedVector(dimension, row + 1, 1)
  return centroid.map((value, index) => value + (noise[index] ?? 0) * 0.025)
}

function normalizedVector(dimension, seed, stream) {
  let state = (seed * 2_654_435_761 + stream * 1_013_904_223) >>> 0
  const vector = Array.from({ length: dimension }, () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return ((state >>> 0) / 0xffffffff) * 2 - 1
  })
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1
  return vector.map((value) => value / norm)
}

function preferredSubVectors(dimension) {
  if (dimension % 16 === 0) {
    return dimension / 16
  }
  if (dimension % 8 === 0) {
    return dimension / 8
  }
  return 1
}

function positiveInteger(value, name) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`)
  }
  return parsed
}

function optionalPositiveInteger(value, name) {
  return value === undefined ? undefined : positiveInteger(value, name)
}

function parseArguments(values) {
  const parsed = {}
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (value === "--quick") {
      parsed.quick = true
      continue
    }
    if (value?.startsWith("--") && values[index + 1] && !values[index + 1].startsWith("--")) {
      parsed[toCamelCase(value.slice(2))] = values[index + 1]
      index += 1
    }
  }
  return parsed
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())
}
