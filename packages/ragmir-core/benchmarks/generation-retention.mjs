import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { DEFAULT_CONFIG } from "../dist/defaults.js"
import { collectGenerationGarbageUnlocked } from "../dist/generation-retention.js"
import { generationTableName } from "../dist/ingestion-state.js"
import { connectStore, writeIndexManifest, writeRowsToTable } from "../dist/store.js"

const GENERATIONS = 10
const ROWS_PER_GENERATION = 250
const MAX_RETAINED_GENERATIONS = 3

const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ragmir-generation-benchmark-"))

try {
  const config = benchmarkConfig(projectRoot)
  const tableNames = []
  for (let generation = 0; generation < GENERATIONS; generation += 1) {
    const runId = `00000000-0000-4000-8000-${String(generation).padStart(12, "0")}`
    const tableName = generationTableName(config.tableName, runId)
    tableNames.push(tableName)
    await writeRowsToTable(rowsForGeneration(config, generation), tableName, config)
  }

  const activeTableName = tableNames.at(-1)
  const rollbackTableName = tableNames.at(-2)
  if (!activeTableName || !rollbackTableName) {
    throw new Error("Generation benchmark did not create active and rollback tables.")
  }
  await writeIndexManifest(manifestFor(config, activeTableName), config)
  const state = ingestionState(activeTableName, rollbackTableName)
  const connection = await connectStore(config)
  try {
    const future = new Date(Date.now() + 10 * 60 * 1_000)
    const dryRun = await collectGenerationGarbageUnlocked(config, connection, {
      dryRun: true,
      now: future,
      state,
    })
    const collected = await collectGenerationGarbageUnlocked(config, connection, {
      now: future,
      state,
    })
    const remaining = collected.generations.filter((generation) => !generation.deleted)
    const bytesBefore = dryRun.generations.reduce((sum, generation) => sum + generation.bytes, 0)
    const bytesAfter = remaining.reduce((sum, generation) => sum + generation.bytes, 0)
    const activeBytes =
      remaining.find((generation) => generation.tableName === activeTableName)?.bytes ?? 0
    const gates = {
      boundedCount: remaining.length <= MAX_RETAINED_GENERATIONS,
      activePreserved: remaining.some((generation) => generation.role === "active"),
      rollbackPreserved: remaining.some((generation) => generation.role === "rollback"),
      reclaimableReported: dryRun.reclaimableBytes > 0,
      reclaimedMatchesPlan: collected.reclaimedBytes === dryRun.reclaimableBytes,
      diskAmplificationBounded: activeBytes > 0 && bytesAfter / activeBytes <= 3.5,
    }
    const report = {
      schemaVersion: 1,
      workload: {
        generations: GENERATIONS,
        rowsPerGeneration: ROWS_PER_GENERATION,
      },
      before: {
        tables: dryRun.generations.length,
        bytes: bytesBefore,
        reclaimableBytes: dryRun.reclaimableBytes,
      },
      after: {
        tables: remaining.length,
        bytes: bytesAfter,
        activeBytes,
        diskAmplification: activeBytes > 0 ? bytesAfter / activeBytes : null,
        deletedTables: collected.deletedTables,
      },
      gates,
      passed: Object.values(gates).every(Boolean),
    }
    console.log(JSON.stringify(report, null, 2))
    if (!report.passed) {
      process.exitCode = 1
    }
  } finally {
    connection.close()
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

function rowsForGeneration(config, generation) {
  return Array.from({ length: ROWS_PER_GENERATION }, (_, index) => {
    const relativePath = `.ragmir/raw/generation-${generation}-${index}.md`
    const text = `generation ${generation} evidence ${index}`
    return {
      id: `${relativePath}#0`,
      source: path.basename(relativePath),
      relativePath,
      chunkIndex: 0,
      contextPath: "Evidence",
      searchText: `Evidence\n${text}`,
      text,
      charStart: 0,
      charEnd: text.length,
      lineStart: 1,
      lineEnd: 1,
      checksum: `checksum-${generation}-${index}`,
      bytes: text.length,
      mtimeMs: generation * ROWS_PER_GENERATION + index + 1,
      vector: Array.from({ length: 16 }, (_, offset) => ((generation + index + offset) % 31) / 31),
      embeddingProvider: config.embeddingProvider,
      embeddingModel: config.embeddingModel,
    }
  })
}

function manifestFor(config, tableName) {
  return {
    schemaVersion: 8,
    createdAt: new Date().toISOString(),
    ragmirVersion: "benchmark",
    embeddingProvider: config.embeddingProvider,
    embeddingModel: config.embeddingModel,
    chunkSize: config.chunkSize,
    chunkOverlap: config.chunkOverlap,
    fileCount: ROWS_PER_GENERATION,
    chunkCount: ROWS_PER_GENERATION,
    tableName,
  }
}

function ingestionState(tableName, previousTableName) {
  const now = new Date().toISOString()
  return {
    version: 3,
    runId: "00000000-0000-4000-8000-999999999999",
    mode: "rebuild",
    status: "completed",
    tableName,
    previousTableName,
    policyFingerprint: "benchmark",
    batchSize: 1,
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
    resumed: false,
    files: [],
  }
}
