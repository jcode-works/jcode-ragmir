import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { DEFAULT_CONFIG } from "../dist/defaults.js"
import { maintainOpenStorageTable } from "../dist/storage-maintenance.js"
import { openRowsTable, writeRows } from "../dist/store.js"

const MUTATION_BATCHES = 24
const LATENCY_SAMPLES = 40
const QUERIES_PER_SAMPLE = 10
const STABLE_ROWS = 2_000
const P95_REGRESSION_LIMIT = 0.1

const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ragmir-storage-benchmark-"))

try {
  const config = benchmarkConfig(projectRoot)
  const stableRows = Array.from({ length: STABLE_ROWS }, (_, index) =>
    rowFor(config, `.ragmir/raw/stable-${index}.md`, 0, "maintenance baseline evidence", index),
  )
  await writeRows(stableRows, config)

  const table = await openRowsTable(config)
  if (!table) {
    throw new Error("Storage benchmark table was not created.")
  }
  for (let mutation = 1; mutation <= MUTATION_BATCHES; mutation += 1) {
    await table.add(
      [
        rowFor(
          config,
          `.ragmir/raw/mutation-${mutation}.md`,
          0,
          `mutable evidence revision ${mutation}`,
          STABLE_ROWS + mutation,
        ),
      ],
    )
  }

  const healthBefore = await table.stats()
  const versionBefore = await table.version()
  const coverageBefore = await table.indexStats("searchText_idx")
  const evidenceBefore = await queryEvidence(table)
  await measureP95(table, 5, 2)
  const p95BeforeMs = await measureP95(table, LATENCY_SAMPLES, QUERIES_PER_SAMPLE)

  const maintenance = await maintainOpenStorageTable(table, config.tableName, config, {
    additionalMutations: MUTATION_BATCHES,
  })
  const healthAfter = await table.stats()
  const versionAfter = await table.version()
  const coverageAfter = await table.indexStats("searchText_idx")
  const evidenceAfter = await queryEvidence(table)
  await measureP95(table, 5, 2)
  const p95AfterMs = await measureP95(table, LATENCY_SAMPLES, QUERIES_PER_SAMPLE)

  const gates = {
    fullTextCoverage:
      coverageAfter?.numIndexedRows === STABLE_ROWS + MUTATION_BATCHES &&
      coverageAfter.numUnindexedRows === 0,
    evidenceStable: JSON.stringify(evidenceAfter) === JSON.stringify(evidenceBefore),
    p95Regression:
      p95BeforeMs === 0 || (p95AfterMs - p95BeforeMs) / p95BeforeMs <= P95_REGRESSION_LIMIT,
    fragmentHealthBounded:
      healthAfter.fragmentStats.numFragments < 8 ||
      healthAfter.fragmentStats.numSmallFragments / healthAfter.fragmentStats.numFragments < 0.25,
    versionGrowthBounded: versionAfter - versionBefore <= 4,
  }
  const report = {
    schemaVersion: 1,
    workload: {
      stableRows: STABLE_ROWS,
      mutationBatches: MUTATION_BATCHES,
      latencySamples: LATENCY_SAMPLES,
      queriesPerSample: QUERIES_PER_SAMPLE,
    },
    before: {
      version: versionBefore,
      fragments: healthBefore.fragmentStats,
      fullTextIndex: coverageBefore,
      p95Ms: p95BeforeMs,
      evidence: evidenceBefore,
    },
    after: {
      version: versionAfter,
      fragments: healthAfter.fragmentStats,
      fullTextIndex: coverageAfter,
      p95Ms: p95AfterMs,
      evidence: evidenceAfter,
    },
    maintenance,
    gates,
    passed: Object.values(gates).every(Boolean),
  }
  console.log(JSON.stringify(report, null, 2))
  if (!report.passed) {
    process.exitCode = 1
  }
} finally {
  await rm(projectRoot, { recursive: true, force: true })
}

function benchmarkConfig(root) {
  return {
    ...DEFAULT_CONFIG,
    projectRoot: root,
    rawDir: path.join(root, DEFAULT_CONFIG.rawDir),
    storageDir: path.join(root, DEFAULT_CONFIG.storageDir),
    sourcesFile: path.join(root, DEFAULT_CONFIG.sourcesFile),
    accessLogPath: path.join(root, DEFAULT_CONFIG.accessLogPath),
    embeddingModelPath: path.join(root, DEFAULT_CONFIG.embeddingModelPath),
    acceptedRisks: [...DEFAULT_CONFIG.acceptedRisks],
    sources: [...DEFAULT_CONFIG.sources],
    includeExtensions: [...DEFAULT_CONFIG.includeExtensions],
    pdfOcrCommand: [...DEFAULT_CONFIG.pdfOcrCommand],
    imageOcrCommand: [...DEFAULT_CONFIG.imageOcrCommand],
    legacyWordCommand: [...DEFAULT_CONFIG.legacyWordCommand],
    redaction: {
      ...DEFAULT_CONFIG.redaction,
      patterns: [...DEFAULT_CONFIG.redaction.patterns],
    },
  }
}

function rowFor(config, relativePath, chunkIndex, text, seed) {
  return {
    id: `${relativePath}#${chunkIndex}`,
    source: path.basename(relativePath),
    relativePath,
    chunkIndex,
    contextPath: "Evidence",
    searchText: `Evidence\n${text}`,
    text,
    charStart: 0,
    charEnd: text.length,
    lineStart: 1,
    lineEnd: 1,
    checksum: `checksum-${seed}`,
    bytes: text.length,
    mtimeMs: seed + 1,
    vector: Array.from({ length: 16 }, (_, index) => ((seed + index) % 31) / 31),
    embeddingProvider: config.embeddingProvider,
    embeddingModel: config.embeddingModel,
  }
}

async function queryEvidence(table) {
  const rows = await table
    .search("maintenance baseline", "fts", "searchText")
    .select(["relativePath", "chunkIndex", "lineStart", "lineEnd", "_score"])
    .limit(10)
    .toArray()
  return rows
    .map((row) => ({
      relativePath: row.relativePath,
      chunkIndex: row.chunkIndex,
      citation: `${row.relativePath}:${row.lineStart}-${row.lineEnd}`,
    }))
    .sort((left, right) =>
      `${left.relativePath}\0${left.chunkIndex}`.localeCompare(
        `${right.relativePath}\0${right.chunkIndex}`,
      ),
    )
}

async function measureP95(table, samples, queriesPerSample) {
  const measurements = []
  for (let sample = 0; sample < samples; sample += 1) {
    const startedAt = performance.now()
    for (let query = 0; query < queriesPerSample; query += 1) {
      await table
        .search("maintenance baseline", "fts", "searchText")
        .select(["relativePath", "_score"])
        .limit(10)
        .toArray()
    }
    measurements.push((performance.now() - startedAt) / queriesPerSample)
  }
  measurements.sort((left, right) => left - right)
  return measurements[Math.ceil(measurements.length * 0.95) - 1] ?? 0
}
