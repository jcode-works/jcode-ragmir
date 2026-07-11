import { recordAccess } from "./access-log.js"
import { chunkDocument } from "./chunking.js"
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
import { parseFile } from "./parsing.js"
import { redactText, totalRedactions } from "./redaction.js"
import {
  openRowsTable,
  readEmptyTextFiles,
  readIndexManifest,
  updateRows,
  writeEmptyTextFiles,
  writeIndexManifest,
  writeRows,
} from "./store.js"
import type {
  AuditReport,
  Config,
  IndexManifestFile,
  IngestOptions,
  IngestResult,
  RedactionCount,
  SourceDiagnostics,
  SourceFile,
  TextChunk,
  VectorRow,
} from "./types.js"
import { VERSION } from "./version.js"

const MAX_SOURCE_DIAGNOSTIC_ITEMS = 20
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
  const policyFingerprint = indexPolicyFingerprint(config)
  const existingManifest = await readIndexManifest(config)
  const manifestCompatible =
    !options.rebuild &&
    existingManifest?.schemaVersion === INDEX_SCHEMA_VERSION &&
    existingManifest.indexPolicyFingerprint === policyFingerprint &&
    existingManifest.indexedFiles !== undefined
  const existingTable = manifestCompatible ? await openRowsTable(config) : null
  const storedEmptyFiles = manifestCompatible ? await readEmptyTextFiles(config) : []
  const knownFiles = new Map(
    [...(existingManifest?.indexedFiles ?? []), ...storedEmptyFiles].map((file) => [
      file.relativePath,
      file,
    ]),
  )
  const inventory = await inventorySourceFiles(config, { knownFiles })
  const files = inventory.supportedFiles
  const inventoryMetrics = sourceInventoryMetrics(files)
  const currentFiles = new Map(files.map((file) => [file.relativePath, file]))
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
  const reusableFiles = new Set([
    ...reusableIndexedFiles.map((file) => file.relativePath),
    ...reusableEmptyFiles.map((file) => file.relativePath),
  ])
  const filesToIndex = files.filter((file) => !reusableFiles.has(file.relativePath))
  const allChunks: TextChunk[] = []
  const errors: IngestResult["errors"] = []
  const redactionCounts: RedactionCount[] = []
  const emptyTextFiles: string[] = []

  const results = await mapLimit(filesToIndex, config.ingestConcurrency, async (file) => {
    try {
      const parsed = await parseFile(file, config)
      const redacted = redactText(parsed.text, config)
      const chunks = chunkDocument(
        { ...parsed, text: redacted.text },
        config.chunkSize,
        config.chunkOverlap,
      )
      return { path: file.relativePath, chunks, redactions: redacted.counts, error: null }
    } catch (error) {
      return {
        path: file.relativePath,
        chunks: [],
        redactions: [],
        error: {
          path: file.relativePath,
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
  })

  for (const result of results) {
    if (result.error) {
      errors.push(result.error)
      continue
    }
    redactionCounts.push(...result.redactions)
    if (result.chunks.length === 0) {
      emptyTextFiles.push(result.path)
    }
    allChunks.push(...result.chunks)
  }

  const rows: VectorRow[] = []
  for (let i = 0; i < allChunks.length; i += config.embeddingBatchSize) {
    const batch = allChunks.slice(i, i + config.embeddingBatchSize)
    const embeddings = await embedTexts(
      batch.map((chunk) => chunk.text),
      config,
    )
    for (const [index, chunk] of batch.entries()) {
      const vector = embeddings[index]
      if (!vector) {
        throw new Error(`Missing embedding for chunk ${chunk.relativePath}#${chunk.chunkIndex}.`)
      }
      rows.push({
        ...chunk,
        vector,
        embeddingProvider: config.embeddingProvider,
        embeddingModel: config.embeddingModel,
      })
    }
  }

  const rebuiltIndexedFiles = indexedFileRecords(rows)
  const indexedFiles = [...reusableIndexedFiles, ...rebuiltIndexedFiles].sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath),
  )
  const chunkCount = indexedFiles.reduce((sum, file) => sum + file.chunkCount, 0)
  const previousPaths = new Set(previousIndexedFiles.map((file) => file.relativePath))
  const currentPaths = new Set(files.map((file) => file.relativePath))
  const replacePaths = [
    ...filesToIndex.map((file) => file.relativePath),
    ...[...previousPaths].filter((relativePath) => !currentPaths.has(relativePath)),
  ]
  const writeResult =
    !canReuse || chunkCount === 0
      ? await writeRows(rows, config)
      : replacePaths.length > 0
        ? await updateRows(rows, replacePaths, config)
        : { vectorIndexWarning: null, lexicalIndexWarning: null }
  if (chunkCount > 0) {
    const firstRow = rows[0] ?? (await firstStoredRow(config))
    if (!firstRow) {
      throw new Error("Cannot write an index manifest without indexed rows.")
    }
    await writeIndexManifest(
      {
        schemaVersion: INDEX_SCHEMA_VERSION,
        createdAt: new Date().toISOString(),
        ragmirVersion: VERSION,
        embeddingProvider: config.embeddingProvider,
        embeddingModel: config.embeddingModel,
        indexPolicyFingerprint: policyFingerprint,
        vectorDimension: firstRow.vector.length,
        vectorDistanceMetric: VECTOR_DISTANCE_METRIC,
        chunkSize: config.chunkSize,
        chunkOverlap: config.chunkOverlap,
        fileCount: indexedFiles.length,
        chunkCount,
        indexedFiles,
      },
      config,
    )
  }
  await writeEmptyTextFiles(
    [
      ...reusableEmptyFiles,
      ...emptyTextFiles.flatMap((relativePath) => {
        const file = currentFiles.get(relativePath)
        return file
          ? [
              {
                relativePath,
                checksum: file.checksum,
                bytes: file.bytes,
                mtimeMs: file.mtimeMs,
              },
            ]
          : []
      }),
    ],
    config,
  )
  await recordAccess(config, {
    action: "ingest",
    resultCount: chunkCount,
    redactions: totalRedactions(redactionCounts),
  })

  return {
    indexedFiles: indexedFiles.length,
    rebuiltFiles: new Set(rows.map((row) => row.relativePath)).size,
    reusedFiles: reusableFiles.size,
    policyRebuild,
    chunks: chunkCount,
    discoveredFiles: inventory.discoveredFiles,
    supportedFiles: files.length,
    supportedBytes: inventoryMetrics.supportedBytes,
    largestFileBytes: inventoryMetrics.largestFileBytes,
    skippedFiles: inventory.skippedFiles.length + emptyTextFiles.length,
    unsupportedFiles: countSkippedByReason(inventory.skippedFiles, "unsupported-extension"),
    oversizedFiles: countSkippedByReason(inventory.skippedFiles, "oversized"),
    sensitiveFiles: countSkippedByReason(inventory.skippedFiles, "sensitive-name"),
    emptyTextFiles: [
      ...reusableEmptyFiles.map((file) => file.relativePath),
      ...emptyTextFiles,
    ].sort(),
    unsupportedExtensions: summarizeUnsupportedExtensions(inventory.skippedFiles),
    redactions: totalRedactions(redactionCounts),
    vectorIndexWarning: writeResult.vectorIndexWarning,
    lexicalIndexWarning: writeResult.lexicalIndexWarning,
    errors,
  }
}

function indexedFileRecords(rows: VectorRow[]): IndexManifestFile[] {
  const records = new Map<string, IndexManifestFile>()
  for (const row of rows) {
    const current = records.get(row.relativePath)
    records.set(row.relativePath, {
      relativePath: row.relativePath,
      checksum: row.checksum,
      chunkCount: (current?.chunkCount ?? 0) + 1,
      bytes: row.bytes,
      mtimeMs: row.mtimeMs,
    })
  }
  return [...records.values()]
}

async function firstStoredRow(config: Config): Promise<VectorRow | null> {
  const table = await openRowsTable(config)
  if (!table) {
    return null
  }
  const [row] = (await table.query().limit(1).toArray()) as VectorRow[]
  return row ?? null
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
    }
  }

  const rows = (await table.query().select(["relativePath", "checksum"]).toArray()) as Array<{
    relativePath: string
    checksum?: string
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
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0

  async function run(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      const item = items[index]
      if (item !== undefined) {
        results[index] = await worker(item)
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()))
  return results
}
