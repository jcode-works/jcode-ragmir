import type { Connection } from "@lancedb/lancedb"
import { recordAccess } from "./access-log.js"
import { summarizeChunkStats } from "./chunk-stats.js"
import { chunkDocument, chunkSearchText } from "./chunking.js"
import { loadConfig } from "./config.js"
import { VECTOR_DISTANCE_METRIC } from "./defaults.js"
import { embedTexts } from "./embeddings.js"
import {
  countSkippedByReason,
  inventorySourceFiles,
  summarizeUnsupportedExtensions,
} from "./files.js"
import { INDEX_SCHEMA_VERSION } from "./index-diagnostics.js"
import { indexPolicyFingerprint } from "./index-policy.js"
import { withIndexWriteLock } from "./index-write-lock.js"
import type { IngestionRunState } from "./ingestion-state.js"
import {
  canResumeIngestion,
  createIngestionRunState,
  finishIngestionState,
  ingestionProgress,
  readIngestionState,
  removeStagedIndexManifest,
  resumeIngestionState,
  updateIngestionFile,
  writeIngestionState,
  writeStagedIndexManifest,
} from "./ingestion-state.js"
import { operationSignal, throwIfAborted } from "./operation.js"
import { parseFile } from "./parsing.js"
import { redactText, totalRedactions } from "./redaction.js"
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
  IndexManifest,
  IndexManifestFile,
  IngestOptions,
  IngestResult,
  SourceDiagnostics,
  SourceFile,
  TextChunk,
  VectorRow,
} from "./types.js"
import { VERSION } from "./version.js"

const MAX_SOURCE_DIAGNOSTIC_ITEMS = 20
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
  return withIndexWriteLock(config.storageDir, signal, () =>
    ingestUnlocked(config, options, connection, signal),
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
    const knownFiles = new Map(
      [
        ...(existingManifest?.indexedFiles ?? []),
        ...storedEmptyFiles,
        ...(storedState?.files ?? []),
      ].map((file) => [file.relativePath, file]),
    )
    const inventory = await inventorySourceFiles(config, { knownFiles })
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
      })
      if (mode === "rebuild") {
        state = {
          ...state,
          tableName: generationTableName(config.tableName, state.runId),
          files: state.files.map((file) => ({
            ...file,
            state: "pending",
            chunkCount: 0,
            reused: false,
          })),
        }
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

    for (const fileBatch of valueBatches(pendingFiles, state.batchSize)) {
      throwIfAborted(signal)
      const parsedBatch = await mapLimit(
        fileBatch,
        config.ingestConcurrency,
        signal,
        async (file) => parseSourceFile(file, config, signal),
      )
      for (const parsed of parsedBatch) {
        state = updateIngestionFile(
          state,
          parsed.file.relativePath,
          parsed.error
            ? { state: "error", chunkCount: 0, redactions: 0, error: parsed.error }
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

      const successfulFiles = parsedBatch.filter((parsed) => parsed.error === null)
      const allChunks = successfulFiles.flatMap((parsed) => parsed.chunks)
      const rows = await vectorRowsForChunks(allChunks, config, signal)
      for (const parsed of successfulFiles) {
        state = updateIngestionFile(state, parsed.file.relativePath, { state: "embedded" })
      }
      await persistIngestionProgress(state, config, options)
      throwIfAborted(signal)

      const replacePaths = [
        ...fileBatch.map((file) => file.relativePath),
        ...(!removalApplied ? removedPaths : []),
      ]
      const writeResult = await updateRowsInTable(
        rows,
        replacePaths,
        state.tableName,
        config,
        connection,
      )
      removalApplied = true
      lexicalIndexWarning ??= writeResult.lexicalIndexWarning
      for (const parsed of successfulFiles) {
        state = updateIngestionFile(state, parsed.file.relativePath, { state: "indexed" })
      }
      await writeProgressManifest(state, config, connection)
      await persistIngestionProgress(state, config, options)
      throwIfAborted(signal)
    }

    if (!removalApplied && removedPaths.length > 0) {
      const writeResult = await updateRowsInTable(
        [],
        removedPaths,
        state.tableName,
        config,
        connection,
      )
      lexicalIndexWarning ??= writeResult.lexicalIndexWarning
    }

    const manifest = await manifestForState(state, config, connection)
    await validateIngestionTable(state, manifest, config, connection)
    await writeEmptyTextFiles(emptyTextRecords(state), config)
    await writeIndexManifest(manifest, config)
    await removeStagedIndexManifest(state.runId, config)
    const errors = ingestionErrors(state)
    state = finishIngestionState(state, errors.length > 0 ? "completed_with_errors" : "completed")
    await persistIngestionProgress(state, config, options)

    const indexedFiles = manifest.indexedFiles ?? []
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
      indexedFiles: indexedFiles.length,
      rebuiltFiles: state.files.filter(
        (file) => file.state === "indexed" && file.chunkCount > 0 && !file.reused,
      ).length,
      reusedFiles: state.files.filter((file) => file.reused).length,
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
      vectorIndexWarning: null,
      lexicalIndexWarning,
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
  const rows = table
    ? ((await table.query().select(["relativePath", "checksum"]).toArray()) as Array<{
        relativePath: string
        checksum: string
      }>)
    : []
  const rowCounts = new Map<string, number>()
  for (const row of rows) {
    const key = `${row.relativePath}\0${row.checksum}`
    rowCounts.set(key, (rowCounts.get(key) ?? 0) + 1)
  }
  const committedEmptyFiles =
    state.mode === "incremental"
      ? new Set(
          (await readEmptyTextFiles(config)).map(
            (file) => `${file.relativePath}\0${file.checksum}`,
          ),
        )
      : new Set<string>()

  return {
    ...state,
    files: state.files.map((file) => {
      if (file.state === "indexed" || file.state === "error") {
        return file
      }
      const key = `${file.relativePath}\0${file.checksum}`
      const committed =
        file.chunkCount > 0 ? rowCounts.get(key) === file.chunkCount : committedEmptyFiles.has(key)
      return committed ? { ...file, state: "indexed", error: null } : file
    }),
  }
}

interface ParsedSourceFile {
  file: SourceFile
  chunks: TextChunk[]
  redactions: number
  error: string | null
}

async function parseSourceFile(
  file: SourceFile,
  config: Config,
  signal: AbortSignal | undefined,
): Promise<ParsedSourceFile> {
  try {
    const parsed = await parseFile(file, config)
    throwIfAborted(signal)
    const redacted = redactText(parsed.text, config)
    return {
      file,
      chunks: chunkDocument(
        { ...parsed, text: redacted.text },
        config.chunkSize,
        config.chunkOverlap,
      ),
      redactions: totalRedactions(redacted.counts),
      error: null,
    }
  } catch (error) {
    throwIfAborted(signal)
    return {
      file,
      chunks: [],
      redactions: 0,
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
  for (const batch of valueBatches(chunks, config.embeddingBatchSize)) {
    throwIfAborted(signal)
    const embeddings = await embedTexts(batch.map(chunkSearchText), config)
    throwIfAborted(signal)
    for (const [index, chunk] of batch.entries()) {
      const vector = embeddings[index]
      if (!vector) {
        throw new Error(`Missing embedding for chunk ${chunk.relativePath}#${chunk.chunkIndex}.`)
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
): Promise<void> {
  await writeIngestionState(state, config)
  await options.onProgress?.(ingestionProgress(state))
}

async function writeProgressManifest(
  state: IngestionRunState,
  config: Config,
  connection: Connection | undefined,
): Promise<void> {
  const manifest = await manifestForState(state, config, connection)
  if (state.mode === "rebuild") {
    await writeStagedIndexManifest(manifest, state.runId, config)
    return
  }
  await writeEmptyTextFiles(emptyTextRecords(state), config)
  await writeIndexManifest(manifest, config)
}

async function manifestForState(
  state: IngestionRunState,
  config: Config,
  connection: Connection | undefined,
): Promise<IndexManifest> {
  const indexedFiles = indexedFilesFromState(state)
  const chunkCount = indexedFiles.reduce((sum, file) => sum + file.chunkCount, 0)
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
    indexPolicyFingerprint: state.policyFingerprint,
    ...(firstRow ? { vectorDimension: firstRow.vector.length } : {}),
    vectorDistanceMetric: VECTOR_DISTANCE_METRIC,
    chunkSize: config.chunkSize,
    chunkOverlap: config.chunkOverlap,
    fileCount: indexedFiles.length,
    chunkCount,
    tableName: state.tableName,
    indexedFiles,
  }
}

function indexedFilesFromState(state: IngestionRunState): IndexManifestFile[] {
  return state.files
    .filter((file) => file.state === "indexed" && file.chunkCount > 0)
    .map((file) => ({
      relativePath: file.relativePath,
      checksum: file.checksum,
      chunkCount: file.chunkCount,
      bytes: file.bytes,
      mtimeMs: file.mtimeMs,
    }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

function emptyTextRecords(state: IngestionRunState): Array<{
  relativePath: string
  checksum: string
  bytes: number
  mtimeMs: number
}> {
  return state.files
    .filter((file) => file.state === "indexed" && file.chunkCount === 0)
    .map((file) => ({
      relativePath: file.relativePath,
      checksum: file.checksum,
      bytes: file.bytes,
      mtimeMs: file.mtimeMs,
    }))
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
  const rows = (await table.query().select(["id", "relativePath", "checksum"]).toArray()) as Array<{
    id: string
    relativePath: string
    checksum: string
  }>
  if (rows.length !== manifest.chunkCount) {
    throw new Error(
      `Ingestion validation expected ${manifest.chunkCount} rows but found ${rows.length}.`,
    )
  }
  if (new Set(rows.map((row) => row.id)).size !== rows.length) {
    throw new Error("Ingestion validation found duplicate chunk identifiers.")
  }
  const expectedFiles = new Map(
    (manifest.indexedFiles ?? []).map((file) => [
      `${file.relativePath}\0${file.checksum}`,
      file.chunkCount,
    ]),
  )
  const actualFiles = new Map<string, number>()
  for (const row of rows) {
    const key = `${row.relativePath}\0${row.checksum}`
    actualFiles.set(key, (actualFiles.get(key) ?? 0) + 1)
  }
  if (
    expectedFiles.size !== actualFiles.size ||
    [...expectedFiles].some(([key, count]) => actualFiles.get(key) !== count)
  ) {
    throw new Error("Ingestion validation found rows that do not match the generated manifest.")
  }
}

function generationTableName(baseName: string, runId: string): string {
  return `${baseName}__generation_${runId.replaceAll("-", "")}`
}

function ingestFileBatchSize(value: number | undefined): number {
  const batchSize = value ?? DEFAULT_INGEST_FILE_BATCH_SIZE
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error("batchSize must be a positive integer.")
  }
  return batchSize
}

function valueBatches<T>(values: T[], batchSize: number): T[][] {
  const batches: T[][] = []
  for (let index = 0; index < values.length; index += batchSize) {
    batches.push(values.slice(index, index + batchSize))
  }
  return batches
}

export async function audit(cwd = process.cwd()): Promise<AuditReport> {
  const config = await loadConfig(cwd)
  const inventory = await inventorySourceFiles(config)
  const files = inventory.supportedFiles
  const inventoryMetrics = sourceInventoryMetrics(files)
  const supportedFiles = files.map((file) => file.relativePath)
  const table = await openRowsTable(config)
  const emptyTextFiles = await currentEmptyTextFiles(config, files)

  if (!table) {
    return {
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

  const rows = (await table
    .query()
    .select(["relativePath", "checksum", "contextPath", "text"])
    .toArray()) as Array<{
    relativePath: string
    checksum?: string
    contextPath: string
    text: string
  }>
  const counts = new Map<string, number>()
  const checksums = new Map<string, Set<string>>()
  for (const row of rows) {
    counts.set(row.relativePath, (counts.get(row.relativePath) ?? 0) + 1)
    if (row.checksum) {
      const fileChecksums = checksums.get(row.relativePath) ?? new Set<string>()
      fileChecksums.add(row.checksum)
      checksums.set(row.relativePath, fileChecksums)
    }
  }

  const supportedSet = new Set(supportedFiles)
  const indexedSet = new Set(counts.keys())
  const currentChecksums = new Map(files.map((file) => [file.relativePath, file.checksum]))

  return {
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
    totalChunks: rows.length,
    chunkStats: summarizeChunkStats(rows),
  }
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
): Promise<Set<string>> {
  const currentChecksums = new Map(files.map((file) => [file.relativePath, file.checksum]))
  const emptyTextFiles = new Set<string>()
  for (const record of await readEmptyTextFiles(config)) {
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
