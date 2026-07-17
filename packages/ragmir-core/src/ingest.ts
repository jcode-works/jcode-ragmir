import type { Connection } from "@lancedb/lancedb"
import { recordAccess } from "./access-log.js"
import { summarizeChunkStats } from "./chunk-stats.js"
import { chunkDocument, chunkSearchText } from "./chunking.js"
import { loadConfig } from "./config.js"
import {
  MAX_INGEST_CHUNK_WINDOW,
  MAX_INGEST_CHUNKS_PER_FILE,
  MAX_INGEST_FILE_BATCH_SIZE,
  MAX_INGEST_SOURCE_WINDOW_BYTES,
  MAX_INGEST_VECTOR_BYTES_PER_FILE,
  VECTOR_DISTANCE_METRIC,
} from "./defaults.js"
import { embedTexts } from "./embeddings.js"
import {
  countSkippedByReason,
  inventorySourceFiles,
  summarizeUnsupportedExtensions,
} from "./files.js"
import { collectGenerationGarbageUnlocked } from "./generation-retention.js"
import { INDEX_SCHEMA_VERSION } from "./index-diagnostics.js"
import { indexPolicyFingerprint } from "./index-policy.js"
import { withIndexWriteLock } from "./index-write-lock.js"
import type { IngestionRunState } from "./ingestion-state.js"
import {
  canResumeIngestion,
  compactIngestionState,
  createIngestionRunState,
  finishIngestionState,
  generationTableName,
  ingestionProgress,
  readIngestionState,
  reconcileIngestionFile,
  removeStagedIndexManifest,
  resumeIngestionState,
  updateIngestionFile,
  writeIngestionState,
} from "./ingestion-state.js"
import { operationSignal, throwIfAborted } from "./operation.js"
import { parseFile } from "./parsing.js"
import { redactDocument, totalRedactions } from "./redaction.js"
import { securityAudit } from "./security.js"
import type { StorageMaintenanceReport } from "./storage-maintenance.js"
import { maintainStorageTable } from "./storage-maintenance.js"
import {
  activeIndexTableName,
  dropRowsTable,
  openRowsTable,
  openRowsTableByName,
  readEmptyTextFiles,
  readIndexManifest,
  updateRowsInTable,
  writeEmptyTextFiles,
  writeIndexManifest,
} from "./store.js"
import type {
  AuditReport,
  Config,
  IncrementalFailurePolicy,
  IndexHealthSnapshot,
  IndexMaintenanceSnapshot,
  IndexManifest,
  IndexManifestFile,
  IngestOptions,
  IngestResult,
  OperationOptions,
  PdfOcrMetrics,
  SourceDiagnostics,
  SourceFile,
  SourceInventory,
  TextChunk,
  VectorRow,
} from "./types.js"
import { VERSION } from "./version.js"
import { runWorkload } from "./workload.js"

const MAX_SOURCE_DIAGNOSTIC_ITEMS = 20
const MAX_HEALTH_PREVIEW_ITEMS = 50
const DEFAULT_INGEST_FILE_BATCH_SIZE = 25
const ARCHIVE_PATH_PATTERNS = [
  /(^|[/_-])archive(s)?([/_-]|$)/iu,
  /(^|[/_-])backup(s)?([/_-]|$)/iu,
  /(^|[/_-])legacy([/_-]|$)/iu,
  /(^|[/_-])old([/_-]|$)/iu,
  /(^|[/_-])obsolete([/_-]|$)/iu,
  /(^|[/_-])poc([/_-]|$)/iu,
]
const MIRROR_PATH_PATTERNS = [
  /(^|[/_-])raw[_-]?files([/_-]|$)/iu,
  /(^|[/_-])google[_-]?drive([/_-]|$)/iu,
  /(^|[/_-])drive[_-]?mirror([/_-]|$)/iu,
  /(^|[/_-])export(s)?([/_-]|$)/iu,
]

export async function ingest(options: IngestOptions = {}): Promise<IngestResult> {
  const config = await loadConfig(String(options.cwd ?? process.cwd()))
  return ingestWithConfig(config, options)
}

export async function ingestWithConfig(
  config: Config,
  options: IngestOptions = {},
  connection?: Connection,
): Promise<IngestResult> {
  const signal = operationSignal(options)
  return runWorkload(config, "ingestion", signal, () =>
    withIndexWriteLock(config.storageDir, signal, () =>
      ingestUnlocked(config, options, connection, signal),
    ),
  )
}

async function ingestUnlocked(
  config: Config,
  options: IngestOptions,
  connection: Connection | undefined,
  signal: AbortSignal | undefined,
): Promise<IngestResult> {
  let state: IngestionRunState | null = null
  try {
    throwIfAborted(signal)
    const requestedBatchSize = ingestFileBatchSize(options.batchSize)
    const policyFingerprint = indexPolicyFingerprint(config)
    const existingManifest = await readIndexManifest(config)
    const storedState = await readIngestionState(config)
    const storedEmptyFiles = await readEmptyTextFiles(config)
    const inventory = await inventorySourceFiles(config, signal ? { signal } : {})
    const files = inventory.supportedFiles
    const inventoryMetrics = sourceInventoryMetrics(files)
    const currentFiles = new Map(files.map((file) => [file.relativePath, file]))
    const existingTable = await openRowsTable(config, connection)
    const manifestCompatible =
      !options.rebuild &&
      existingManifest?.schemaVersion === INDEX_SCHEMA_VERSION &&
      existingManifest.indexPolicyFingerprint === policyFingerprint &&
      existingManifest.indexedFiles !== undefined
    const policyRebuild =
      !options.rebuild &&
      existingManifest !== null &&
      (existingManifest.schemaVersion !== INDEX_SCHEMA_VERSION ||
        existingManifest.indexPolicyFingerprint !== policyFingerprint)
    const canReuse = manifestCompatible && existingTable !== null
    const previousIndexedFiles = canReuse ? (existingManifest.indexedFiles ?? []) : []
    const previousEmptyFiles = canReuse ? storedEmptyFiles : []
    const previousFiles = new Map<string, IndexManifestFile>([
      ...previousIndexedFiles.map((file) => [file.relativePath, file] as const),
      ...previousEmptyFiles.map((file) => [file.relativePath, { ...file, chunkCount: 0 }] as const),
    ])
    const reusableIndexedFiles = previousIndexedFiles.filter(
      (file) => currentFiles.get(file.relativePath)?.checksum === file.checksum,
    )
    const reusableEmptyFiles = previousEmptyFiles.filter(
      (file) => currentFiles.get(file.relativePath)?.checksum === file.checksum,
    )
    const reusablePaths = new Set([
      ...reusableIndexedFiles.map((file) => file.relativePath),
      ...reusableEmptyFiles.map((file) => file.relativePath),
    ])
    const activeTableName = await activeIndexTableName(config)
    const resumableTable = storedState
      ? await openRowsTableByName(storedState.tableName, config, connection)
      : null
    const resumableTableAvailable =
      !storedState?.files.some((file) => file.state === "indexed" && file.chunkCount > 0) ||
      resumableTable !== null

    if (
      storedState &&
      resumableTableAvailable &&
      canResumeIngestion(storedState, files, policyFingerprint, options.rebuild === true)
    ) {
      state = resumeIngestionState(await reconcileCommittedFiles(storedState, config, connection))
    } else {
      if (
        storedState?.mode === "rebuild" &&
        storedState.tableName !== activeTableName &&
        storedState.status !== "completed" &&
        storedState.status !== "completed_with_errors"
      ) {
        await dropRowsTable(storedState.tableName, config, connection)
        await removeStagedIndexManifest(storedState.runId, config)
      }
      const mode =
        options.rebuild || (existingTable !== null && !manifestCompatible)
          ? "rebuild"
          : "incremental"
      const reusableChunkCounts = new Map([
        ...reusableIndexedFiles.map((file) => [file.relativePath, file.chunkCount] as const),
        ...reusableEmptyFiles.map((file) => [file.relativePath, 0] as const),
      ])
      state = createIngestionRunState({
        mode,
        tableName: activeTableName,
        previousTableName: mode === "rebuild" ? activeTableName : null,
        policyFingerprint,
        batchSize: requestedBatchSize,
        files,
        reusablePaths: mode === "incremental" ? reusablePaths : new Set(),
        reusableChunkCounts,
        ...(mode === "incremental" ? { previousFiles } : {}),
      })
      if (mode === "rebuild") {
        state.tableName = generationTableName(config.tableName, state.runId)
      }
    }

    await persistIngestionProgress(state, config, options)
    throwIfAborted(signal)

    const previousPaths = new Set(previousIndexedFiles.map((file) => file.relativePath))
    const currentPaths = new Set(files.map((file) => file.relativePath))
    const removedPaths =
      state.mode === "incremental"
        ? [...previousPaths].filter((relativePath) => !currentPaths.has(relativePath))
        : []
    const pendingFiles = state.files
      .filter((file) => file.state !== "indexed")
      .flatMap((file) => {
        const source = currentFiles.get(file.relativePath)
        return source ? [source] : []
      })
    let removalApplied = false
    let lexicalIndexWarning: string | null = null
    let storageWarning: string | null = null
    let storageMutations = 0
    const ocr = emptyPdfOcrMetrics()
    const failurePolicy = incrementalFailurePolicy(options, config)

    for (const fileWindow of ingestionWindows(pendingFiles, state.batchSize, config)) {
      throwIfAborted(signal)
      const parsedWindow = await mapLimit(
        fileWindow,
        config.ingestConcurrency,
        signal,
        async (file) => parseSourceFile(file, config, signal),
      )
      for (const parsed of parsedWindow) {
        mergePdfOcrMetrics(ocr, parsed.ocr)
        state = updateIngestionFile(
          state,
          parsed.file.relativePath,
          parsed.error
            ? { state: "error", redactions: 0, error: parsed.error }
            : {
                state: "parsed",
                chunkCount: parsed.chunks.length,
                redactions: parsed.redactions,
                error: null,
              },
        )
      }
      await persistIngestionProgress(state, config, options)
      throwIfAborted(signal)

      for (const parsed of parsedWindow) {
        throwIfAborted(signal)
        const successful = parsed.error === null
        const chunkCount = parsed.chunks.length
        const rows = successful ? await vectorRowsForChunks(parsed.chunks, config, signal) : []
        if (successful) {
          state = updateIngestionFile(state, parsed.file.relativePath, { state: "embedded" })
          await persistIngestionProgress(state, config, options)
          throwIfAborted(signal)
        }

        const replacePaths = [
          ...(successful || (state.mode === "incremental" && failurePolicy === "remove-stale")
            ? [parsed.file.relativePath]
            : []),
          ...(!removalApplied ? removedPaths : []),
        ]
        if (rows.length > 0 || replacePaths.length > 0) {
          const writeResult = await updateRowsInTable(
            rows,
            replacePaths,
            state.tableName,
            config,
            connection,
          )
          removalApplied = true
          storageMutations += 1
          lexicalIndexWarning ??= writeResult.lexicalIndexWarning
        }

        if (successful) {
          state = updateIngestionFile(state, parsed.file.relativePath, {
            state: "indexed",
            lastGoodChecksum: parsed.file.checksum,
            lastGoodChunkCount: chunkCount,
            lastGoodBytes: parsed.file.bytes,
            lastGoodMtimeMs: parsed.file.mtimeMs,
            staleLastKnownGood: false,
          })
        } else if (state.mode === "incremental" && failurePolicy === "remove-stale") {
          state = updateIngestionFile(state, parsed.file.relativePath, {
            chunkCount: 0,
            lastGoodChecksum: null,
            lastGoodChunkCount: 0,
            lastGoodBytes: null,
            lastGoodMtimeMs: null,
            staleLastKnownGood: false,
          })
        }
        await persistIngestionProgress(state, config, options)
        parsed.chunks.length = 0
        throwIfAborted(signal)
      }
    }

    if (!removalApplied && removedPaths.length > 0) {
      const writeResult = await updateRowsInTable(
        [],
        removedPaths,
        state.tableName,
        config,
        connection,
      )
      storageMutations += 1
      lexicalIndexWarning ??= writeResult.lexicalIndexWarning
    }

    sortIngestionFilesForStorage(state)
    let manifest = await manifestForState(state, config, connection)
    const maintenance = await maintainStorageTable(state.tableName, config, connection, {
      additionalMutations: storageMutations,
      ...(manifest.vectorDimension === undefined
        ? {}
        : { vectorDimension: manifest.vectorDimension }),
    })
    if (manifest.chunkCount > 0 && !maintenance.adaptiveIndices) {
      throw new Error("Cannot activate an index without adaptive vector index diagnostics.")
    }
    if (maintenance.adaptiveIndices) {
      manifest = { ...manifest, vectorIndex: maintenance.adaptiveIndices.vectorIndex }
    }
    const securityReport = await securityAudit(config.projectRoot, {
      deep: false,
      ...(signal ? { signal } : {}),
    })
    const checkedAt = new Date().toISOString()
    manifest = {
      ...manifest,
      health: indexHealthSnapshot({
        checkedAt,
        inventory,
        files,
        state,
        manifest,
        securityWarnings: securityReport.warnings,
      }),
      maintenance: indexMaintenanceSnapshot(maintenance, checkedAt),
    }
    storageWarning = combineWarnings(storageWarning, maintenance.warning)
    await validateIngestionTable(state, manifest, config, connection)
    await writeEmptyTextFiles(emptyTextRecords(state), config)
    await writeIndexManifest(manifest, config, indexedFilesFromState(state))
    try {
      const garbageCollection = await collectGenerationGarbageUnlocked(config, connection, {
        state,
      })
      storageWarning = combineWarnings(storageWarning, garbageCollection.warning)
    } catch (error) {
      storageWarning = combineWarnings(
        storageWarning,
        `Generation cleanup failed (${error instanceof Error ? error.message : String(error)}). The active index remains available.`,
      )
    }
    await removeStagedIndexManifest(state.runId, config)
    const errors = ingestionErrors(state)
    state = finishIngestionState(state, errors.length > 0 ? "completed_with_errors" : "completed")
    await persistIngestionProgress(state, config, options, true)

    const emptyTextFiles = emptyTextRecords(state).map((file) => file.relativePath)
    const redactions = state.files.reduce((sum, file) => sum + file.redactions, 0)
    await recordAccess(config, {
      action: "ingest",
      resultCount: manifest.chunkCount,
      redactions,
    })

    return {
      runId: state.runId,
      resumed: state.resumed,
      batchSize: state.batchSize,
      indexedFiles: manifest.fileCount,
      rebuiltFiles: state.files.filter(
        (file) => file.state === "indexed" && file.chunkCount > 0 && !file.reused,
      ).length,
      reusedFiles: state.files.filter((file) => file.reused).length,
      staleLastKnownGood: manifest.staleFiles?.map((file) => file.relativePath) ?? [],
      policyRebuild,
      chunks: manifest.chunkCount,
      discoveredFiles: inventory.discoveredFiles,
      supportedFiles: files.length,
      supportedBytes: inventoryMetrics.supportedBytes,
      largestFileBytes: inventoryMetrics.largestFileBytes,
      skippedFiles: inventory.skippedFiles.length + emptyTextFiles.length,
      unsupportedFiles: countSkippedByReason(inventory.skippedFiles, "unsupported-extension"),
      oversizedFiles: countSkippedByReason(inventory.skippedFiles, "oversized"),
      sensitiveFiles: countSkippedByReason(inventory.skippedFiles, "sensitive-name"),
      emptyTextFiles,
      unsupportedExtensions: summarizeUnsupportedExtensions(inventory.skippedFiles),
      redactions,
      ocr,
      vectorIndexWarning: maintenance.adaptiveIndices?.warning ?? null,
      lexicalIndexWarning,
      storageWarning,
      errors,
    }
  } catch (error) {
    if (state?.status === "running") {
      state = finishIngestionState(state, signal?.aborted ? "interrupted" : "failed")
      try {
        await writeIngestionState(state, config)
      } catch {
        // Preserve the original ingestion failure.
      }
    }
    throw error
  }
}

function combineWarnings(...warnings: Array<string | null>): string | null {
  const present = warnings.filter((warning): warning is string => warning !== null)
  return present.length > 0 ? present.join(" ") : null
}

function emptyPdfOcrMetrics(): PdfOcrMetrics {
  return {
    pages: 0,
    cacheHits: 0,
    cacheMisses: 0,
    batches: 0,
    subprocesses: 0,
    durationMs: 0,
  }
}

function mergePdfOcrMetrics(target: PdfOcrMetrics, source: PdfOcrMetrics | null): void {
  if (!source) {
    return
  }
  target.pages += source.pages
  target.cacheHits += source.cacheHits
  target.cacheMisses += source.cacheMisses
  target.batches += source.batches
  target.subprocesses += source.subprocesses
  target.durationMs = Math.round((target.durationMs + source.durationMs) * 1_000) / 1_000
}

async function reconcileCommittedFiles(
  state: IngestionRunState,
  config: Config,
  connection: Connection | undefined,
): Promise<IngestionRunState> {
  const filesToReconcile = state.files.filter(
    (file) => file.state !== "indexed" && file.state !== "error",
  )
  if (filesToReconcile.length === 0) {
    return state
  }

  const table = await openRowsTableByName(state.tableName, config, connection)
  const committedEmptyFiles =
    state.mode === "incremental"
      ? new Set(
          (await readEmptyTextFiles(config)).map(
            (file) => `${file.relativePath}\0${file.checksum}`,
          ),
        )
      : new Set<string>()

  for (const file of filesToReconcile) {
    const key = `${file.relativePath}\0${file.checksum}`
    const committedRows =
      file.chunkCount > 0 && table
        ? await table.countRows(
            `relativePath = ${sqlString(file.relativePath)} AND checksum = ${sqlString(file.checksum)}`,
          )
        : 0
    const committed =
      file.chunkCount > 0 ? committedRows === file.chunkCount : committedEmptyFiles.has(key)
    if (committed) {
      reconcileIngestionFile(state, file.relativePath, {
        state: "indexed",
        lastGoodChecksum: file.checksum,
        lastGoodChunkCount: file.chunkCount,
        lastGoodBytes: file.bytes,
        lastGoodMtimeMs: file.mtimeMs,
        staleLastKnownGood: false,
        error: null,
      })
    }
  }
  return state
}

interface ParsedSourceFile {
  file: SourceFile
  chunks: TextChunk[]
  redactions: number
  ocr: PdfOcrMetrics | null
  error: string | null
}

async function parseSourceFile(
  file: SourceFile,
  config: Config,
  signal: AbortSignal | undefined,
): Promise<ParsedSourceFile> {
  try {
    const parsed = await parseFile(file, { ...config, ...(signal ? { signal } : {}) })
    throwIfAborted(signal)
    const redacted = redactDocument(parsed, config)
    return {
      file,
      chunks: chunkDocument(redacted.document, config.chunkSize, config.chunkOverlap, {
        maxChunks: MAX_INGEST_CHUNKS_PER_FILE,
      }),
      redactions: totalRedactions(redacted.counts),
      ocr: parsed.ocr ?? null,
      error: null,
    }
  } catch (error) {
    throwIfAborted(signal)
    return {
      file,
      chunks: [],
      redactions: 0,
      ocr: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function vectorRowsForChunks(
  chunks: TextChunk[],
  config: Config,
  signal: AbortSignal | undefined,
): Promise<VectorRow[]> {
  const rows: VectorRow[] = []
  let vectorBytes = 0
  for (const batch of valueBatches(chunks, config.embeddingBatchSize)) {
    throwIfAborted(signal)
    const embeddings = await embedTexts(batch.map(chunkSearchText), config, "document", signal)
    throwIfAborted(signal)
    for (const [index, chunk] of batch.entries()) {
      const vector = embeddings[index]
      if (!vector) {
        throw new Error(`Missing embedding for chunk ${chunk.relativePath}#${chunk.chunkIndex}.`)
      }
      vectorBytes += vector.length * Float64Array.BYTES_PER_ELEMENT
      if (vectorBytes > MAX_INGEST_VECTOR_BYTES_PER_FILE) {
        throw new Error(
          `Vector memory limit of ${MAX_INGEST_VECTOR_BYTES_PER_FILE} bytes exceeded for ${chunk.relativePath}. Increase chunkSize, split the source file, or use a smaller embedding model.`,
        )
      }
      rows.push({
        ...chunk,
        searchText: chunkSearchText(chunk),
        vector,
        embeddingProvider: config.embeddingProvider,
        embeddingModel: config.embeddingModel,
      })
    }
  }
  return rows
}

async function persistIngestionProgress(
  state: IngestionRunState,
  config: Config,
  options: IngestOptions,
  compact = false,
): Promise<void> {
  if (compact) {
    await compactIngestionState(state, config)
  } else {
    await writeIngestionState(state, config)
  }
  await options.onProgress?.(ingestionProgress(state))
}

async function manifestForState(
  state: IngestionRunState,
  config: Config,
  connection: Connection | undefined,
): Promise<IndexManifest> {
  let fileCount = 0
  let chunkCount = 0
  for (const file of indexedFilesFromState(state)) {
    fileCount += 1
    chunkCount += file.chunkCount
  }
  const staleFiles = state.files
    .flatMap((file) =>
      file.staleLastKnownGood && file.lastGoodChecksum !== null && file.error !== null
        ? [
            {
              relativePath: file.relativePath,
              currentChecksum: file.checksum,
              lastGoodChecksum: file.lastGoodChecksum,
              chunkCount: file.lastGoodChunkCount,
              error: file.error,
            },
          ]
        : [],
    )
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  const table = await openRowsTableByName(state.tableName, config, connection)
  const [firstRow] = table ? ((await table.query().limit(1).toArray()) as VectorRow[]) : []
  if (chunkCount > 0 && !firstRow) {
    throw new Error("Cannot write an index manifest without indexed rows.")
  }
  return {
    schemaVersion: INDEX_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    ragmirVersion: VERSION,
    embeddingProvider: config.embeddingProvider,
    embeddingModel: config.embeddingModel,
    embeddingModelRevision: config.embeddingModelRevision,
    embeddingModelDigest: config.embeddingModelDigest,
    indexPolicyFingerprint: state.policyFingerprint,
    ...(firstRow ? { vectorDimension: firstRow.vector.length } : {}),
    vectorDistanceMetric: VECTOR_DISTANCE_METRIC,
    chunkSize: config.chunkSize,
    chunkOverlap: config.chunkOverlap,
    fileCount,
    chunkCount,
    tableName: state.tableName,
    ...(staleFiles.length > 0 ? { staleFiles } : {}),
  }
}

interface IndexHealthSnapshotInput {
  checkedAt: string
  inventory: SourceInventory
  files: SourceFile[]
  state: IngestionRunState
  manifest: IndexManifest
  securityWarnings: string[]
}

function indexHealthSnapshot(input: IndexHealthSnapshotInput): IndexHealthSnapshot {
  const inventoryMetrics = sourceInventoryMetrics(input.files)
  const emptyTextFiles = emptyTextRecords(input.state).map((file) => file.relativePath)
  const staleInIndex = (input.manifest.staleFiles ?? []).map((file) => file.relativePath)
  const missingFromIndex = input.state.files
    .filter((file) => file.state === "error" && !file.staleLastKnownGood)
    .map((file) => file.relativePath)
    .sort()
  const previews = {
    missingFromIndex: missingFromIndex.slice(0, MAX_HEALTH_PREVIEW_ITEMS),
    staleInIndex: staleInIndex.slice(0, MAX_HEALTH_PREVIEW_ITEMS),
    emptyTextFiles: emptyTextFiles.slice(0, MAX_HEALTH_PREVIEW_ITEMS),
  }
  return {
    schemaVersion: 1,
    checkedAt: input.checkedAt,
    discoveredFiles: input.inventory.discoveredFiles,
    supportedFiles: input.files.length,
    supportedBytes: inventoryMetrics.supportedBytes,
    largestFileBytes: inventoryMetrics.largestFileBytes,
    skippedFiles: input.inventory.skippedFiles.length,
    unsupportedFiles: countSkippedByReason(input.inventory.skippedFiles, "unsupported-extension"),
    oversizedFiles: countSkippedByReason(input.inventory.skippedFiles, "oversized"),
    sensitiveFiles: countSkippedByReason(input.inventory.skippedFiles, "sensitive-name"),
    emptyTextFiles: emptyTextFiles.length,
    missingFromIndex: missingFromIndex.length,
    staleInIndex: staleInIndex.length,
    previews,
    previewOmitted: {
      missingFromIndex: missingFromIndex.length - previews.missingFromIndex.length,
      staleInIndex: staleInIndex.length - previews.staleInIndex.length,
      emptyTextFiles: emptyTextFiles.length - previews.emptyTextFiles.length,
    },
    skippedByReason: skippedFileCounts(input.inventory.skippedFiles),
    sourceDiagnostics: sourceDiagnostics(input.files, input.inventory.skippedFiles),
    securityCheckedAt: input.checkedAt,
    securityWarnings: [...input.securityWarnings].sort().slice(0, MAX_HEALTH_PREVIEW_ITEMS),
  }
}

function indexMaintenanceSnapshot(
  report: StorageMaintenanceReport,
  checkedAt: string,
): IndexMaintenanceSnapshot {
  return {
    schemaVersion: 1,
    checkedAt,
    status: report.status,
    tableVersion: report.tableVersion,
    mutationsSinceOptimization: report.mutationsSinceOptimization,
    fragments: report.fragments,
    fullTextIndex: report.fullTextIndex,
    warning: report.warning,
  }
}

function skippedFileCounts(skippedFiles: SourceInventory["skippedFiles"]): Record<string, number> {
  const counts = new Map<string, number>()
  for (const file of skippedFiles) {
    counts.set(file.reason, (counts.get(file.reason) ?? 0) + 1)
  }
  return Object.fromEntries(
    [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)),
  )
}

function* indexedFilesFromState(state: IngestionRunState): Generator<IndexManifestFile> {
  for (const file of state.files) {
    if (file.state === "indexed" && file.chunkCount > 0) {
      yield {
        relativePath: file.relativePath,
        checksum: file.checksum,
        chunkCount: file.chunkCount,
        bytes: file.bytes,
        mtimeMs: file.mtimeMs,
      }
    } else if (
      file.staleLastKnownGood &&
      file.lastGoodChecksum !== null &&
      file.lastGoodChunkCount > 0
    ) {
      yield {
        relativePath: file.relativePath,
        checksum: file.lastGoodChecksum,
        chunkCount: file.lastGoodChunkCount,
        ...(file.lastGoodBytes === null ? {} : { bytes: file.lastGoodBytes }),
        ...(file.lastGoodMtimeMs === null ? {} : { mtimeMs: file.lastGoodMtimeMs }),
      }
    }
  }
}

function sortIngestionFilesForStorage(state: IngestionRunState): void {
  state.files.sort((left, right) =>
    compareUnicodeScalarValues(left.relativePath, right.relativePath),
  )
}

function compareUnicodeScalarValues(left: string, right: string): number {
  let leftIndex = 0
  let rightIndex = 0
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftCodePoint = left.codePointAt(leftIndex)
    const rightCodePoint = right.codePointAt(rightIndex)
    if (leftCodePoint === undefined || rightCodePoint === undefined) {
      break
    }
    if (leftCodePoint !== rightCodePoint) {
      return leftCodePoint - rightCodePoint
    }
    leftIndex += leftCodePoint > 0xffff ? 2 : 1
    rightIndex += rightCodePoint > 0xffff ? 2 : 1
  }
  return left.length - right.length
}

function emptyTextRecords(state: IngestionRunState): Array<{
  relativePath: string
  checksum: string
  bytes: number
  mtimeMs: number
}> {
  return state.files
    .flatMap((file) => {
      if (file.state === "indexed" && file.chunkCount === 0) {
        return [
          {
            relativePath: file.relativePath,
            checksum: file.checksum,
            bytes: file.bytes,
            mtimeMs: file.mtimeMs,
          },
        ]
      }
      if (
        file.staleLastKnownGood &&
        file.lastGoodChecksum !== null &&
        file.lastGoodChunkCount === 0 &&
        file.lastGoodBytes !== null &&
        file.lastGoodMtimeMs !== null
      ) {
        return [
          {
            relativePath: file.relativePath,
            checksum: file.lastGoodChecksum,
            bytes: file.lastGoodBytes,
            mtimeMs: file.lastGoodMtimeMs,
          },
        ]
      }
      return []
    })
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

function ingestionErrors(state: IngestionRunState): IngestResult["errors"] {
  return state.files.flatMap((file) =>
    file.state === "error" && file.error ? [{ path: file.relativePath, message: file.error }] : [],
  )
}

async function validateIngestionTable(
  state: IngestionRunState,
  manifest: IndexManifest,
  config: Config,
  connection: Connection | undefined,
): Promise<void> {
  const table = await openRowsTableByName(state.tableName, config, connection)
  if (!table) {
    if (manifest.chunkCount === 0) {
      return
    }
    throw new Error("Ingestion validation failed because the generated table is missing.")
  }
  const rowCount = await table.countRows()
  await validateIngestionMetadata({
    expectedChunkCount: manifest.chunkCount,
    actualChunkCount: rowCount,
    expectedFiles: indexedFilesFromState(state),
    idRows: streamQueryRows(
      table.query().select(["id"]).orderBy({ columnName: "id", ascending: true }),
    ),
    fileRows: streamQueryRows(
      table
        .query()
        .select(["relativePath", "checksum"])
        .orderBy([
          { columnName: "relativePath", ascending: true },
          { columnName: "checksum", ascending: true },
        ]),
    ),
  })
}

export interface IngestionMetadataValidationOptions {
  expectedChunkCount: number
  actualChunkCount: number
  expectedFiles: Iterable<IndexManifestFile>
  idRows: AsyncIterable<unknown>
  fileRows: AsyncIterable<unknown>
}

export async function validateIngestionMetadata(
  options: IngestionMetadataValidationOptions,
): Promise<void> {
  if (options.actualChunkCount !== options.expectedChunkCount) {
    throw new Error(
      `Ingestion validation expected ${options.expectedChunkCount} rows but found ${options.actualChunkCount}.`,
    )
  }

  let previousId: string | null = null
  for await (const row of options.idRows) {
    const id = requiredStringField(row, "id", "Ingestion validation found an invalid chunk id.")
    if (id === previousId) {
      throw new Error("Ingestion validation found duplicate chunk identifiers.")
    }
    previousId = id
  }

  const expectedFiles = options.expectedFiles[Symbol.iterator]()
  let expectedFile = expectedFiles.next()
  let actualKey: string | null = null
  let actualCount = 0
  const validateActualFile = (): void => {
    if (actualKey === null) {
      return
    }
    if (
      expectedFile.done ||
      `${expectedFile.value.relativePath}\0${expectedFile.value.checksum}` !== actualKey ||
      expectedFile.value.chunkCount !== actualCount
    ) {
      throw new Error("Ingestion validation found rows that do not match the generated manifest.")
    }
    expectedFile = expectedFiles.next()
  }

  for await (const row of options.fileRows) {
    const relativePath = requiredStringField(
      row,
      "relativePath",
      "Ingestion validation found an invalid source path.",
    )
    const checksum = requiredStringField(
      row,
      "checksum",
      "Ingestion validation found an invalid source checksum.",
    )
    const key = `${relativePath}\0${checksum}`
    if (actualKey !== key) {
      validateActualFile()
      actualKey = key
      actualCount = 0
    }
    actualCount += 1
  }
  validateActualFile()
  if (!expectedFile.done) {
    throw new Error("Ingestion validation found rows that do not match the generated manifest.")
  }
}

interface StreamedRowBatch {
  numRows: number
  get(index: number): unknown
}

async function* streamQueryRows(query: AsyncIterable<StreamedRowBatch>): AsyncGenerator<unknown> {
  for await (const batch of query) {
    for (let index = 0; index < batch.numRows; index += 1) {
      yield batch.get(index)
    }
  }
}

function requiredStringField(
  row: unknown,
  key: string,
  message: string,
  allowEmpty = false,
): string {
  const value = tableRowField(row, key)
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
    throw new Error(message)
  }
  return value
}

function tableRowField(row: unknown, key: string): unknown {
  return typeof row === "object" && row !== null ? Reflect.get(row, key) : undefined
}

function ingestFileBatchSize(value: number | undefined): number {
  const batchSize = value ?? DEFAULT_INGEST_FILE_BATCH_SIZE
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error("batchSize must be a positive integer.")
  }
  if (batchSize > MAX_INGEST_FILE_BATCH_SIZE) {
    throw new Error(`batchSize must be at most ${MAX_INGEST_FILE_BATCH_SIZE}.`)
  }
  return batchSize
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function incrementalFailurePolicy(
  options: IngestOptions,
  config: Config,
): IncrementalFailurePolicy {
  const policy = options.incrementalFailurePolicy ?? config.incrementalFailurePolicy
  if (policy !== "preserve-last-good" && policy !== "remove-stale") {
    throw new Error(
      'incrementalFailurePolicy must be either "preserve-last-good" or "remove-stale".',
    )
  }
  return policy
}

function valueBatches<T>(values: T[], batchSize: number): T[][] {
  const batches: T[][] = []
  for (let index = 0; index < values.length; index += batchSize) {
    batches.push(values.slice(index, index + batchSize))
  }
  return batches
}

function ingestionWindows(files: SourceFile[], maxFiles: number, config: Config): SourceFile[][] {
  const windows: SourceFile[][] = []
  let current: SourceFile[] = []
  let currentBytes = 0
  let currentChunks = 0
  for (const file of files) {
    const estimatedChunks = estimatedChunkCount(file, config)
    const exceedsWindow =
      current.length > 0 &&
      (current.length >= maxFiles ||
        currentBytes + file.bytes > MAX_INGEST_SOURCE_WINDOW_BYTES ||
        currentChunks + estimatedChunks > MAX_INGEST_CHUNK_WINDOW)
    if (exceedsWindow) {
      windows.push(current)
      current = []
      currentBytes = 0
      currentChunks = 0
    }
    current.push(file)
    currentBytes += file.bytes
    currentChunks += estimatedChunks
  }
  if (current.length > 0) {
    windows.push(current)
  }
  return windows
}

function estimatedChunkCount(file: SourceFile, config: Config): number {
  const step = Math.max(1, config.chunkSize - config.chunkOverlap)
  return Math.max(1, Math.ceil(file.bytes / step))
}

export async function audit(
  cwd = process.cwd(),
  options: OperationOptions = {},
): Promise<AuditReport> {
  const signal = operationSignal(options)
  throwIfAborted(signal)
  const config = await loadConfig(cwd)
  throwIfAborted(signal)
  const inventory = await inventorySourceFiles(config, {
    ...(signal ? { signal } : {}),
    writeFingerprintCache: false,
  })
  throwIfAborted(signal)
  const files = inventory.supportedFiles
  const inventoryMetrics = sourceInventoryMetrics(files)
  const supportedFiles = files.map((file) => file.relativePath)
  const table = await openRowsTable(config)
  throwIfAborted(signal)
  const emptyTextFiles = await currentEmptyTextFiles(config, files, signal)
  throwIfAborted(signal)

  if (!table) {
    return {
      mode: "deep",
      inventoryVerified: true,
      cost: "O(corpus)",
      discoveredFiles: inventory.discoveredFiles,
      supportedBytes: inventoryMetrics.supportedBytes,
      largestFileBytes: inventoryMetrics.largestFileBytes,
      indexedFiles: [],
      supportedFiles,
      skippedFiles: inventory.skippedFiles,
      emptyTextFiles: [...emptyTextFiles],
      unsupportedExtensions: summarizeUnsupportedExtensions(inventory.skippedFiles),
      sourceDiagnostics: sourceDiagnostics(files, inventory.skippedFiles),
      missingFromIndex: supportedFiles.filter((file) => !emptyTextFiles.has(file)),
      staleInIndex: [],
      totalChunks: 0,
      chunkStats: summarizeChunkStats([]),
    }
  }

  const counts = new Map<string, number>()
  const checksums = new Map<string, Set<string>>()
  const chunkStats = createAuditChunkStatsAccumulator()
  for await (const row of streamQueryRows(
    table.query().select(["relativePath", "checksum", "contextPath", "text"]),
  )) {
    throwIfAborted(signal)
    const relativePath = requiredStringField(
      row,
      "relativePath",
      "Audit found an invalid source path.",
    )
    const checksum = tableRowField(row, "checksum")
    const contextPath = requiredStringField(
      row,
      "contextPath",
      "Audit found an invalid chunk context.",
      true,
    )
    const text = requiredStringField(row, "text", "Audit found invalid chunk text.")
    counts.set(relativePath, (counts.get(relativePath) ?? 0) + 1)
    if (typeof checksum === "string" && checksum.length > 0) {
      const fileChecksums = checksums.get(relativePath) ?? new Set<string>()
      fileChecksums.add(checksum)
      checksums.set(relativePath, fileChecksums)
    }
    recordAuditChunkStats(chunkStats, text.length, contextPath.trim().length > 0)
  }

  const supportedSet = new Set(supportedFiles)
  const indexedSet = new Set(counts.keys())
  const currentChecksums = new Map(files.map((file) => [file.relativePath, file.checksum]))

  throwIfAborted(signal)
  return {
    mode: "deep",
    inventoryVerified: true,
    cost: "O(corpus)",
    discoveredFiles: inventory.discoveredFiles,
    supportedBytes: inventoryMetrics.supportedBytes,
    largestFileBytes: inventoryMetrics.largestFileBytes,
    indexedFiles: [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([source, chunks]) => ({ source, chunks })),
    supportedFiles,
    skippedFiles: inventory.skippedFiles,
    emptyTextFiles: [...emptyTextFiles].sort(),
    unsupportedExtensions: summarizeUnsupportedExtensions(inventory.skippedFiles),
    sourceDiagnostics: sourceDiagnostics(files, inventory.skippedFiles),
    missingFromIndex: supportedFiles.filter(
      (file) => !indexedSet.has(file) && !emptyTextFiles.has(file),
    ),
    staleInIndex: [...indexedSet]
      .filter((file) => {
        if (!supportedSet.has(file)) {
          return true
        }
        const currentChecksum = currentChecksums.get(file)
        const indexedChecksums = checksums.get(file)
        return !currentChecksum || !indexedChecksums?.has(currentChecksum)
      })
      .sort(),
    totalChunks: chunkStats.count,
    chunkStats: finishAuditChunkStats(chunkStats),
  }
}

interface AuditChunkStatsAccumulator {
  count: number
  totalChars: number
  minChars: number
  maxChars: number
  contextualChunks: number
  lengthHistogram: Map<number, number>
}

function createAuditChunkStatsAccumulator(): AuditChunkStatsAccumulator {
  return {
    count: 0,
    totalChars: 0,
    minChars: Number.POSITIVE_INFINITY,
    maxChars: 0,
    contextualChunks: 0,
    lengthHistogram: new Map(),
  }
}

function recordAuditChunkStats(
  stats: AuditChunkStatsAccumulator,
  characters: number,
  contextual: boolean,
): void {
  stats.count += 1
  stats.totalChars += characters
  stats.minChars = Math.min(stats.minChars, characters)
  stats.maxChars = Math.max(stats.maxChars, characters)
  stats.contextualChunks += contextual ? 1 : 0
  stats.lengthHistogram.set(characters, (stats.lengthHistogram.get(characters) ?? 0) + 1)
}

function finishAuditChunkStats(stats: AuditChunkStatsAccumulator): AuditReport["chunkStats"] {
  if (stats.count === 0) {
    return summarizeChunkStats([])
  }
  const sortedHistogram = [...stats.lengthHistogram].sort(([left], [right]) => left - right)
  return {
    count: stats.count,
    minChars: stats.minChars,
    averageChars: stats.totalChars / stats.count,
    p50Chars: histogramPercentile(sortedHistogram, stats.count, 0.5),
    p95Chars: histogramPercentile(sortedHistogram, stats.count, 0.95),
    maxChars: stats.maxChars,
    contextualChunks: stats.contextualChunks,
    contextualRatio: stats.contextualChunks / stats.count,
  }
}

function histogramPercentile(
  histogram: Array<[number, number]>,
  count: number,
  quantile: number,
): number {
  const target = Math.max(1, Math.ceil(count * quantile))
  let cumulative = 0
  for (const [value, occurrences] of histogram) {
    cumulative += occurrences
    if (cumulative >= target) {
      return value
    }
  }
  return histogram.at(-1)?.[0] ?? 0
}

function sourceInventoryMetrics(files: SourceFile[]): {
  supportedBytes: number
  largestFileBytes: number
} {
  let supportedBytes = 0
  let largestFileBytes = 0
  for (const file of files) {
    supportedBytes += file.bytes
    largestFileBytes = Math.max(largestFileBytes, file.bytes)
  }
  return { supportedBytes, largestFileBytes }
}

function sourceDiagnostics(
  supportedFiles: SourceFile[],
  skippedFiles: Array<{ relativePath: string }>,
): SourceDiagnostics {
  const relativePaths = [
    ...supportedFiles.map((file) => file.relativePath),
    ...skippedFiles.map((file) => file.relativePath),
  ]
  return {
    duplicateCandidates: duplicateCandidates(supportedFiles),
    archiveCandidates: pathCandidates(relativePaths, ARCHIVE_PATH_PATTERNS, "archive-like path"),
    mirrorCandidates: pathCandidates(relativePaths, MIRROR_PATH_PATTERNS, "mirror-like path"),
  }
}

function duplicateCandidates(files: SourceFile[]): SourceDiagnostics["duplicateCandidates"] {
  const byChecksum = new Map<string, string[]>()

  for (const file of files) {
    appendGrouped(byChecksum, `sha256:${file.checksum.slice(0, 12)}`, file.relativePath)
  }

  return groupedDuplicates(byChecksum)
    .sort((a, b) => b.files.length - a.files.length || a.key.localeCompare(b.key))
    .slice(0, MAX_SOURCE_DIAGNOSTIC_ITEMS)
}

function pathCandidates(
  relativePaths: string[],
  patterns: RegExp[],
  reason: string,
): SourceDiagnostics["archiveCandidates"] {
  return relativePaths
    .filter((relativePath) => patterns.some((pattern) => pattern.test(relativePath)))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, MAX_SOURCE_DIAGNOSTIC_ITEMS)
    .map((relativePath) => ({ relativePath, reason }))
}

function appendGrouped(groups: Map<string, string[]>, key: string, relativePath: string): void {
  const paths = groups.get(key) ?? []
  paths.push(relativePath)
  groups.set(key, paths)
}

function groupedDuplicates(
  groups: Map<string, string[]>,
): SourceDiagnostics["duplicateCandidates"] {
  return [...groups.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([key, files]) => ({ key, files: [...new Set(files)].sort() }))
}

async function currentEmptyTextFiles(
  config: Awaited<ReturnType<typeof loadConfig>>,
  files: Array<{ relativePath: string; checksum: string }>,
  signal: AbortSignal | undefined,
): Promise<Set<string>> {
  throwIfAborted(signal)
  const currentChecksums = new Map(files.map((file) => [file.relativePath, file.checksum]))
  const emptyTextFiles = new Set<string>()
  const records = await readEmptyTextFiles(config)
  throwIfAborted(signal)
  for (const record of records) {
    throwIfAborted(signal)
    if (currentChecksums.get(record.relativePath) === record.checksum) {
      emptyTextFiles.add(record.relativePath)
    }
  }
  return emptyTextFiles
}

async function mapLimit<T, R>(
  items: T[],
  concurrency: number,
  signal: AbortSignal | undefined,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0

  async function run(): Promise<void> {
    while (nextIndex < items.length) {
      throwIfAborted(signal)
      const index = nextIndex
      nextIndex += 1
      const item = items[index]
      if (item !== undefined) {
        results[index] = await worker(item)
        throwIfAborted(signal)
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()))
  return results
}
