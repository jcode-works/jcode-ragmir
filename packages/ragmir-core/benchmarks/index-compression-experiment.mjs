import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { fileURLToPath } from "node:url"
import * as lancedb from "@lancedb/lancedb"
import { Float16, Float32 } from "apache-arrow"
import { directorySize, environmentMetadata, measureSeries } from "./lib/metrics.mjs"

const presets = { XS: 1_683, M: 100_000, L: 1_000_000 }
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const options = parseArguments(process.argv.slice(2))
const sizes = String(options.sizes ?? "M,L")
  .split(",")
  .map((value) => value.trim().toUpperCase())
  .filter(Boolean)
const dimension = positiveInteger(options.dimension ?? "384", "dimension")
const quick = options.quick === true
const samples = quick ? 20 : 100
const warmups = quick ? 3 : 10
const repetitions = quick ? 1 : 3
const queryCount = Math.min(samples, 100)
const resultPath = path.resolve(
  options.result ?? path.join(packageRoot, "benchmarks/.results/exp-003-index-compression.json"),
)
const results = []

for (const size of sizes) {
  const rowCount = presets[size]
  if (!rowCount) throw new Error(`Unknown corpus size: ${size}`)
  results.push(
    await benchmarkSize({
      size,
      rowCount,
      dimension,
      samples,
      warmups,
      repetitions,
      queryCount,
    }),
  )
}

const gates = {
  exactReference: results.every((result) => result.gates.exactReference),
  indexCoverage: results.every((result) => result.gates.indexCoverage),
  annRecall: results.every((result) => result.gates.annRecall),
  paretoCompression: results.every((result) => result.gates.paretoCompression),
}
const accepted = Object.values(gates).every(Boolean)
const report = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  environment: environmentMetadata({ includeSemanticDependencies: false }),
  configuration: {
    sizes,
    dimension,
    samples,
    warmups,
    repetitions,
    queryCount,
    recallLossLimit: 0.01,
    significantStorageReduction: 0.2,
    maximumLatencyRegression: 0.05,
  },
  results,
  gates,
  decision: accepted ? "accept-float16" : "retain-float32",
  passed: true,
}
await mkdir(path.dirname(resultPath), { recursive: true })
await writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
process.stdout.write(`${JSON.stringify({ resultPath, ...report }, null, 2)}\n`)

async function benchmarkSize(input) {
  const root = await mkdtemp(path.join(os.tmpdir(), `ragmir-index-compression-${input.size}-`))
  const storageDir = path.join(root, "storage")
  const connection = await lancedb.connect(storageDir)
  const centroids = createCentroids(input.dimension)
  const generatedVectorsFinite = validateGeneratedVectors(input, centroids)
  const queries = Array.from({ length: input.queryCount }, (_value, index) => {
    const row = Math.floor((index * input.rowCount) / input.queryCount)
    return { row, vector: vectorFor(row, input.dimension, centroids) }
  })
  let exactReference
  const precision = []
  try {
    for (const type of ["float32", "float16"]) {
      const tableName = `vectors_${type}`
      const tablePath = path.join(storageDir, `${tableName}.lance`)
      process.stderr.write(`[${input.size}/${type}] building data and exact reference\n`)
      let table
      try {
        table = await createTable(connection, tableName, type, input, centroids)
        await table.optimize({ cleanupOlderThan: new Date(), deleteUnverified: true })
        const flatBytes = await directorySize(tablePath)
        const exact = await measureStrategy(table, queries, input, (query) =>
          query.bypassVectorIndex(),
        )
        exactReference ??= exact.results
        const exactRecallAt10 = recallAt10(exactReference, exact.results)

        const partitions = Math.max(16, Math.round(Math.sqrt(input.rowCount)))
        process.stderr.write(`[${input.size}/${type}] evaluating IVF-PQ\n`)
        const ivfPq = await benchmarkIndex({
          table,
          tablePath,
          flatBytes,
          build: () =>
            lancedb.Index.ivfPq({
              distanceType: "l2",
              numPartitions: partitions,
              numSubVectors: preferredSubVectors(input.dimension),
            }),
          measure: async () => {
            const profiles = []
            for (const profile of ivfQueryProfiles(input.size, partitions)) {
              const measurement = await measureStrategy(table, queries, input, (query) =>
                query.nprobes(profile.nprobes).refineFactor(profile.refineFactor),
              )
              profiles.push({
                ...profile,
                recallAt10: recallAt10(exactReference, measurement.results),
                ...measurement.measurement,
              })
            }
            return profiles
          },
        })

        process.stderr.write(`[${input.size}/${type}] evaluating HNSW-SQ\n`)
        const hnswSq = await benchmarkIndex({
          table,
          tablePath,
          flatBytes,
          build: () =>
            lancedb.Index.hnswSq({
              distanceType: "l2",
              numPartitions: input.rowCount >= presets.L ? 4 : 1,
              m: 20,
              efConstruction: 300,
            }),
          measure: async () => {
            const profiles = []
            for (const ef of [100, 200, 400]) {
              const measurement = await measureStrategy(table, queries, input, (query) =>
                query.ef(ef),
              )
              profiles.push({
                ef,
                recallAt10: recallAt10(exactReference, measurement.results),
                ...measurement.measurement,
              })
            }
            return profiles
          },
        })
        const strategies = [
          strategyRow("exact", exactRecallAt10, exact.measurement, flatBytes),
          ...ivfPq.profiles.map((profile) =>
            strategyRow(
              `ivf-pq-${profile.name}`,
              profile.recallAt10,
              profile,
              ivfPq.physicalBytes,
            ),
          ),
          ...hnswSq.profiles.map((profile) =>
            strategyRow(
              `hnsw-sq-ef-${profile.ef}`,
              profile.recallAt10,
              profile,
              hnswSq.physicalBytes,
            ),
          ),
        ]
        precision.push({
          type,
          error: null,
          generatedVectorsFinite,
          flat: { physicalBytes: flatBytes, recallAt10: exactRecallAt10, ...exact.measurement },
          ivfPq: {
            ...ivfPq,
            parameters: {
              numPartitions: partitions,
              numSubVectors: preferredSubVectors(input.dimension),
            },
          },
          hnswSq: {
            ...hnswSq,
            parameters: {
              numPartitions: input.rowCount >= presets.L ? 4 : 1,
              m: 20,
              efConstruction: 300,
            },
          },
          recommendation: recommend(strategies),
        })
      } catch (error) {
        precision.push({
          type,
          error: errorDetail(error),
          generatedVectorsFinite,
          flat: null,
          ivfPq: null,
          hnswSq: null,
          recommendation: null,
        })
      } finally {
        table?.close()
        await rm(tablePath, { recursive: true, force: true })
      }
    }
  } finally {
    connection.close()
    await rm(root, { recursive: true, force: true })
  }

  const float32 = precision.find((entry) => entry.type === "float32")
  const float16 = precision.find((entry) => entry.type === "float16")
  if (!float32 || !float16) throw new Error("Both precision experiments must complete.")
  const storageReduction =
    float16.recommendation && float32.recommendation
      ? 1 - float16.recommendation.physicalBytes / float32.recommendation.physicalBytes
      : null
  const latencyRatio =
    float16.recommendation && float32.recommendation
      ? float16.recommendation.p95Ms / float32.recommendation.p95Ms
      : null
  const gates = {
    exactReference:
      generatedVectorsFinite && exactReference?.every((rows) => rows.length === 10) === true,
    indexCoverage: precision.every(
      (entry) =>
        entry.error === null &&
        entry.ivfPq !== null &&
        entry.hnswSq !== null &&
        entry.ivfPq.error === null &&
        entry.hnswSq.error === null &&
        entry.ivfPq.index?.numUnindexedRows === 0 &&
        entry.hnswSq.index?.numUnindexedRows === 0,
    ),
    annRecall: precision.every(
      (entry) => entry.recommendation !== null && entry.recommendation.recallAt10 >= 0.99,
    ),
    paretoCompression:
      storageReduction !== null &&
      latencyRatio !== null &&
      storageReduction >= 0.2 &&
      float16.recommendation !== null &&
      float16.recommendation.recallAt10 >= 0.99 &&
      latencyRatio <= 1.05,
  }
  return {
    size: input.size,
    rowCount: input.rowCount,
    dimension: input.dimension,
    precision,
    comparison: {
      float32: float32.recommendation,
      float16: float16.recommendation,
      storageReduction,
      latencyRatio,
    },
    gates,
  }
}

async function createTable(connection, tableName, type, input, centroids) {
  const batchSize = input.size === "L" ? 2_000 : 1_000
  const vectorType = type === "float16" ? new Float16() : new Float32()
  let table
  for (let start = 0; start < input.rowCount; start += batchSize) {
    const count = Math.min(batchSize, input.rowCount - start)
    const rows = Array.from({ length: count }, (_value, offset) => {
      const row = start + offset
      const vector = vectorFor(row, input.dimension, centroids)
      if (!vector.every(Number.isFinite)) {
        throw new Error(`Generated vector ${row} contains a non-finite value.`)
      }
      return {
        id: `row-${String(row).padStart(9, "0")}`,
        vector,
      }
    })
    const arrow = lancedb.makeArrowTable(rows, {
      vectorColumns: { vector: { type: vectorType } },
    })
    if (!table) table = await connection.createTable(tableName, arrow)
    else await table.add(arrow)
  }
  if (!table) throw new Error("Index-compression benchmark did not create a table.")
  return table
}

async function buildIndex(table, config) {
  const startedAt = performance.now()
  await table.createIndex("vector", { config: config(), replace: true })
  return performance.now() - startedAt
}

async function benchmarkIndex({ table, tablePath, flatBytes, build, measure }) {
  try {
    const buildMs = await buildIndex(table, build)
    const profiles = await measure()
    const index = await indexSnapshot(table, "vector_idx")
    await table.optimize({ cleanupOlderThan: new Date(), deleteUnverified: true })
    const physicalBytes = await directorySize(tablePath)
    return {
      buildMs,
      physicalBytes,
      indexBytes: Math.max(0, physicalBytes - flatBytes),
      index,
      profiles,
      error: null,
    }
  } catch (error) {
    return {
      buildMs: null,
      physicalBytes: await directorySize(tablePath),
      indexBytes: null,
      index: null,
      profiles: [],
      error: errorDetail(error),
    }
  }
}

async function measureStrategy(table, queries, input, configure) {
  const measurement = await measureSeries({
    warmups: input.warmups,
    samples: input.samples,
    repetitions: input.repetitions,
    operation: async (index) => {
      const candidate = queries[index % queries.length]
      await configure(
        table
          .vectorSearch(candidate.vector)
          .distanceType("l2")
          .select(["id", "_distance"])
          .limit(10),
      ).toArray()
    },
  })
  const results = []
  for (const candidate of queries) {
    results.push(
      (
        await configure(
          table
            .vectorSearch(candidate.vector)
            .distanceType("l2")
            .select(["id", "_distance"])
            .limit(10),
        ).toArray()
      ).map((row) => row.id),
    )
  }
  return { measurement, results }
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

function strategyRow(name, recallAt10, measurement, physicalBytes) {
  return {
    strategy: name,
    recallAt10,
    p95Ms: measurement.latency.p95Ms,
    physicalBytes,
  }
}

function recommend(strategies) {
  const eligible = strategies
    .filter((strategy) => strategy.recallAt10 >= 0.99)
    .sort(
      (left, right) =>
        left.p95Ms - right.p95Ms ||
        left.physicalBytes - right.physicalBytes ||
        left.strategy.localeCompare(right.strategy),
    )
  const selected = eligible[0]
  if (!selected) throw new Error("No strategy preserved the ANN recall limit.")
  return selected
}

function ivfQueryProfiles(size, partitions) {
  if (size === "L") {
    return [
      { name: "speed", nprobes: Math.min(partitions, 64), refineFactor: 10 },
      { name: "balanced", nprobes: Math.min(partitions, 256), refineFactor: 25 },
      { name: "quality", nprobes: partitions, refineFactor: 100 },
    ]
  }
  return [
    { name: "speed", nprobes: Math.min(partitions, 16), refineFactor: 5 },
    { name: "balanced", nprobes: Math.min(partitions, 32), refineFactor: 10 },
    { name: "quality", nprobes: Math.min(partitions, 64), refineFactor: 20 },
  ]
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
  return Array.from({ length: 1_024 }, (_value, cluster) =>
    normalizedVector(dimension, cluster + 1, 0),
  )
}

function validateGeneratedVectors(input, centroids) {
  for (let row = 0; row < input.rowCount; row += 1) {
    if (!vectorFor(row, input.dimension, centroids).every(Number.isFinite)) return false
  }
  return true
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
  if (dimension % 16 === 0) return dimension / 16
  if (dimension % 8 === 0) return dimension / 8
  return 1
}

function positiveInteger(value, name) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be positive.`)
  return parsed
}

function errorDetail(error) {
  return error instanceof Error ? error.message : String(error)
}

function parseArguments(values) {
  const parsed = {}
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (value === "--") continue
    if (value === "--quick") {
      parsed.quick = true
      continue
    }
    if (value?.startsWith("--") && values[index + 1] && !values[index + 1].startsWith("--")) {
      parsed[toCamelCase(value.slice(2))] = values[index + 1]
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${value}`)
  }
  return parsed
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())
}
