import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import * as lancedb from "@lancedb/lancedb"
import { directorySize, environmentMetadata, measureSeries, sha256 } from "./lib/metrics.mjs"

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const options = parseArguments(process.argv.slice(2))
const quick = options.quick === true
const canonicalRows = positiveInteger(
  options.canonicalRows ?? (quick ? "1000" : "20000"),
  "canonical-rows",
)
const mirrorFactor = positiveInteger(options.mirrorFactor ?? "5", "mirror-factor")
const aliasRows = canonicalRows * mirrorFactor
const dimension = positiveInteger(options.dimension ?? "384", "dimension")
const samples = quick ? 20 : 100
const warmups = quick ? 3 : 10
const repetitions = quick ? 1 : 3
const queryCount = Math.min(samples, canonicalRows)
const resultPath = path.resolve(
  options.result ?? path.join(packageRoot, "benchmarks/.results/exp-004-content-dedup.json"),
)
const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-content-dedup-"))

try {
  const storageDir = path.join(root, "storage")
  const connection = await lancedb.connect(storageDir)
  try {
    const baseline = await createBaselineTable(connection)
    const canonical = await createCanonicalTable(connection)
    const aliases = await createAliasTable(connection)
    try {
      await Promise.all([compact(baseline), compact(canonical), compact(aliases)])
      await aliases.createIndex("contentId", { config: lancedb.Index.btree(), replace: true })
      await compact(aliases)

      const queries = Array.from({ length: queryCount }, (_value, index) => {
        const content = Math.floor((index * canonicalRows) / queryCount)
        return {
          contentId: contentId(content),
          vector: normalizedVector(dimension, content + 1),
          citations: expectedCitations(content),
        }
      })
      const baselineMeasurement = await measureSearches({
        queries,
        operation: (query) => baselineSearch(baseline, query.vector),
      })
      const deduplicatedMeasurement = await measureSearches({
        queries,
        operation: (query) => deduplicatedSearch(canonical, aliases, query.vector),
      })
      const baselineCorrectness = await verifyQueries(
        queries,
        (query) => baselineSearch(baseline, query.vector),
      )
      const deduplicatedCorrectness = await verifyQueries(
        queries,
        (query) => deduplicatedSearch(canonical, aliases, query.vector),
      )
      const baselineBytes = await directorySize(path.join(storageDir, "baseline.lance"))
      const canonicalBytes = await directorySize(path.join(storageDir, "canonical.lance"))
      const aliasBytes = await directorySize(path.join(storageDir, "aliases.lance"))
      const deduplicatedBytes = canonicalBytes + aliasBytes
      const storageReduction = 1 - deduplicatedBytes / baselineBytes
      const latencyRatio =
        deduplicatedMeasurement.latency.p95Ms / baselineMeasurement.latency.p95Ms
      const deletion = await verifyDeletionBehavior(connection)
      const gates = {
        storageSignificant: storageReduction >= 0.2,
        latencyNotHarmed: latencyRatio <= 1.05,
        sourceCitations:
          baselineCorrectness.citationRate === 1 &&
          deduplicatedCorrectness.citationRate === 1,
        rankingEquivalent:
          baselineCorrectness.fingerprint === deduplicatedCorrectness.fingerprint,
        singleAliasDeletion: deletion.singleAliasPreserved,
        lastAliasDeletion: deletion.lastAliasRemoved,
        crashSafeDeletion: deletion.crashSafe,
      }
      const accepted = Object.values(gates).every(Boolean)
      const report = {
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        environment: environmentMetadata({ includeSemanticDependencies: false }),
        configuration: {
          canonicalRows,
          aliasRows,
          mirrorFactor,
          dimension,
          samples,
          warmups,
          repetitions,
          queryCount,
          significantStorageReduction: 0.2,
          maximumLatencyRegression: 0.05,
        },
        baseline: {
          physicalBytes: baselineBytes,
          tableQueriesPerSearch: 1,
          measurement: baselineMeasurement,
          correctness: baselineCorrectness,
        },
        deduplicated: {
          physicalBytes: deduplicatedBytes,
          canonicalBytes,
          aliasBytes,
          tableQueriesPerSearch: 2,
          measurement: deduplicatedMeasurement,
          correctness: deduplicatedCorrectness,
        },
        comparison: { storageReduction, latencyRatio },
        deletion,
        gates,
        decision: accepted ? "accept" : "reject",
        passed: true,
      }
      await mkdir(path.dirname(resultPath), { recursive: true })
      await writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
      process.stdout.write(`${JSON.stringify({ resultPath, ...report }, null, 2)}\n`)
    } finally {
      baseline.close()
      canonical.close()
      aliases.close()
    }
  } finally {
    connection.close()
  }
} finally {
  await rm(root, { recursive: true, force: true })
}

async function createBaselineTable(connection) {
  let table
  for (let start = 0; start < canonicalRows; start += 200) {
    const count = Math.min(200, canonicalRows - start)
    const rows = []
    for (let offset = 0; offset < count; offset += 1) {
      const content = start + offset
      const vector = normalizedVector(dimension, content + 1)
      const text = contentText(content)
      for (let mirror = 0; mirror < mirrorFactor; mirror += 1) {
        rows.push(aliasRow(content, mirror, { text, vector }))
      }
    }
    if (!table) table = await connection.createTable("baseline", rows)
    else await table.add(rows)
  }
  if (!table) throw new Error("Baseline table was not created.")
  return table
}

async function createCanonicalTable(connection) {
  let table
  for (let start = 0; start < canonicalRows; start += 1000) {
    const count = Math.min(1000, canonicalRows - start)
    const rows = Array.from({ length: count }, (_value, offset) => {
      const content = start + offset
      return {
        id: contentId(content),
        text: contentText(content),
        vector: normalizedVector(dimension, content + 1),
      }
    })
    if (!table) table = await connection.createTable("canonical", rows)
    else await table.add(rows)
  }
  if (!table) throw new Error("Canonical table was not created.")
  return table
}

async function createAliasTable(connection) {
  let table
  for (let start = 0; start < canonicalRows; start += 1000) {
    const count = Math.min(1000, canonicalRows - start)
    const rows = []
    for (let offset = 0; offset < count; offset += 1) {
      const content = start + offset
      for (let mirror = 0; mirror < mirrorFactor; mirror += 1) {
        rows.push(aliasRow(content, mirror))
      }
    }
    if (!table) table = await connection.createTable("aliases", rows)
    else await table.add(rows)
  }
  if (!table) throw new Error("Alias table was not created.")
  return table
}

async function baselineSearch(table, vector) {
  return await table
    .vectorSearch(vector)
    .distanceType("l2")
    .bypassVectorIndex()
    .select(["contentId", "relativePath", "citation", "_distance"])
    .limit(10)
    .toArray()
}

async function deduplicatedSearch(canonical, aliases, vector) {
  const content = await canonical
    .vectorSearch(vector)
    .distanceType("l2")
    .bypassVectorIndex()
    .select(["id", "_distance"])
    .limit(10)
    .toArray()
  if (content.length === 0) return []
  const rankByContent = new Map(content.map((row, rank) => [row.id, rank]))
  const distanceByContent = new Map(content.map((row) => [row.id, row._distance]))
  const ids = content.map((row) => sqlString(row.id)).join(", ")
  const sourceRows = await aliases
    .query()
    .select(["contentId", "relativePath", "citation"])
    .where(`contentId IN (${ids})`)
    .toArray()
  return sourceRows
    .map((row) => ({ ...row, _distance: distanceByContent.get(row.contentId) }))
    .sort(
      (left, right) =>
        (rankByContent.get(left.contentId) ?? Number.POSITIVE_INFINITY) -
          (rankByContent.get(right.contentId) ?? Number.POSITIVE_INFINITY) ||
        left.relativePath.localeCompare(right.relativePath),
    )
    .slice(0, 10)
}

async function measureSearches({ queries, operation }) {
  return await measureSeries({
    warmups,
    samples,
    repetitions,
    operation: async (index) => {
      const rows = await operation(queries[index % queries.length])
      if (rows.length !== 10) throw new Error(`Expected 10 search rows, received ${rows.length}.`)
    },
  })
}

async function verifyQueries(queries, operation) {
  let citationHits = 0
  const fingerprints = []
  for (const query of queries) {
    const rows = await operation(query)
    const returned = new Set(rows.map((row) => row.citation))
    const matched = query.citations.filter((citation) => returned.has(citation))
    if (matched.length === query.citations.length) citationHits += 1
    fingerprints.push(queryFingerprint(rows))
  }
  return {
    citationRate: citationHits / queries.length,
    fingerprint: sha256(fingerprints.join("\n")),
  }
}

function queryFingerprint(rows) {
  const groups = new Map()
  for (const row of rows) {
    const existing = groups.get(row.contentId)
    if (existing) {
      existing.citations.push(row.citation)
      continue
    }
    groups.set(row.contentId, {
      distance: row._distance,
      citations: [row.citation],
    })
  }
  return [...groups.entries()]
    .sort(
      ([leftId, left], [rightId, right]) =>
        left.distance - right.distance || leftId.localeCompare(rightId),
    )
    .map(([contentIdValue, group]) =>
      `${contentIdValue}:${group.citations.sort().join(",")}`,
    )
    .join("|")
}

async function verifyDeletionBehavior(connection) {
  const content = 0
  const canonical = await connection.createTable("deletion_canonical", [
    {
      id: contentId(content),
      text: contentText(content),
      vector: normalizedVector(dimension, content + 1),
    },
  ])
  const aliases = await connection.createTable(
    "deletion_aliases",
    Array.from({ length: 3 }, (_value, mirror) => aliasRow(content, mirror)),
  )
  try {
    await aliases.delete(`relativePath = ${sqlString(relativePath(content, 0))}`)
    const remainingAfterOne = await aliases.query().select(["citation"]).toArray()
    const canonicalAfterOne = await canonical.query().select(["id"]).toArray()
    const singleAliasPreserved =
      remainingAfterOne.length === 2 &&
      canonicalAfterOne.length === 1 &&
      remainingAfterOne.every((row) => row.citation !== citation(content, 0))

    await aliases.delete(`contentId = ${sqlString(contentId(content))}`)
    const aliasesAfterCrash = await aliases.query().select(["id"]).toArray()
    const canonicalAfterCrash = await canonical.query().select(["id"]).toArray()
    const orphanObserved = aliasesAfterCrash.length === 0 && canonicalAfterCrash.length === 1
    const crashSafe = !orphanObserved

    await canonical.delete(`id = ${sqlString(contentId(content))}`)
    const lastAliasRemoved =
      (await aliases.query().select(["id"]).toArray()).length === 0 &&
      (await canonical.query().select(["id"]).toArray()).length === 0
    return {
      singleAliasPreserved,
      lastAliasRemoved,
      crashSafe,
      orphanObservedAfterAliasCommit: orphanObserved,
      atomicTablesAvailable: false,
    }
  } finally {
    canonical.close()
    aliases.close()
  }
}

async function compact(table) {
  await table.optimize({ cleanupOlderThan: new Date(), deleteUnverified: true })
}

function aliasRow(content, mirror, payload = {}) {
  return {
    id: `${contentId(content)}:source-${String(mirror).padStart(2, "0")}`,
    contentId: contentId(content),
    relativePath: relativePath(content, mirror),
    citation: citation(content, mirror),
    ...payload,
  }
}

function contentId(content) {
  return `content-${String(content).padStart(8, "0")}`
}

function relativePath(content, mirror) {
  return `.ragmir/raw/mirror-${String(mirror).padStart(2, "0")}/${contentId(content)}.md`
}

function citation(content, mirror) {
  return `${relativePath(content, mirror)}:L1-L8#0`
}

function expectedCitations(content) {
  return Array.from({ length: mirrorFactor }, (_value, mirror) => citation(content, mirror))
}

function contentText(content) {
  const key = contentId(content)
  return `${key} preserves local evidence with source-specific citations. `.repeat(8).trim()
}

function normalizedVector(size, seed) {
  let state = (seed * 2_654_435_761) >>> 0
  const vector = Array.from({ length: size }, () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return ((state >>> 0) / 0xffffffff) * 2 - 1
  })
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1
  return vector.map((value) => value / norm)
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`
}

function positiveInteger(value, name) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be positive.`)
  return parsed
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
