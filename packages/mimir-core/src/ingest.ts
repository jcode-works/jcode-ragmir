import { recordAccess } from "./access-log.js"
import { chunkDocument } from "./chunking.js"
import { loadConfig } from "./config.js"
import { embedTexts } from "./embeddings.js"
import { inventorySourceFiles, summarizeUnsupportedExtensions } from "./files.js"
import { parseFile } from "./parsing.js"
import { redactText, totalRedactions } from "./redaction.js"
import {
  openRowsTable,
  readEmptyTextFiles,
  readRows,
  writeEmptyTextFiles,
  writeRows,
} from "./store.js"
import type {
  AuditReport,
  IngestOptions,
  IngestResult,
  RedactionCount,
  SkippedSourceReason,
  TextChunk,
  VectorRow,
} from "./types.js"

const MAX_AUDIT_ROWS = 100_000

export async function ingest(options: IngestOptions = {}): Promise<IngestResult> {
  const config = await loadConfig(String(options.cwd ?? process.cwd()))
  const inventory = await inventorySourceFiles(config)
  const files = inventory.supportedFiles
  const currentFiles = new Map(files.map((file) => [file.relativePath, file]))
  const existingRows = options.rebuild ? [] : await readRows(config)
  const reusableRows = options.rebuild ? [] : reusableIndexRows(existingRows, currentFiles, config)
  const reusableFiles = new Set(reusableRows.map((row) => row.relativePath))
  const filesToIndex = options.rebuild
    ? files
    : files.filter((file) => !reusableFiles.has(file.relativePath))
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

  const indexRows = [...reusableRows, ...rows]
  await writeRows(indexRows, config)
  await writeEmptyTextFiles(
    emptyTextFiles.flatMap((relativePath) => {
      const file = currentFiles.get(relativePath)
      return file ? [{ relativePath, checksum: file.checksum }] : []
    }),
    config,
  )
  await recordAccess(config, {
    action: "ingest",
    resultCount: indexRows.length,
    redactions: totalRedactions(redactionCounts),
  })

  return {
    indexedFiles: new Set(indexRows.map((row) => row.relativePath)).size,
    rebuiltFiles: new Set(rows.map((row) => row.relativePath)).size,
    reusedFiles: reusableFiles.size,
    chunks: indexRows.length,
    discoveredFiles: inventory.discoveredFiles,
    supportedFiles: files.length,
    skippedFiles: inventory.skippedFiles.length + emptyTextFiles.length,
    unsupportedFiles: countSkipped(inventory.skippedFiles, "unsupported-extension"),
    oversizedFiles: countSkipped(inventory.skippedFiles, "oversized"),
    sensitiveFiles: countSkipped(inventory.skippedFiles, "sensitive-name"),
    emptyTextFiles,
    unsupportedExtensions: summarizeUnsupportedExtensions(inventory.skippedFiles),
    redactions: totalRedactions(redactionCounts),
    errors,
  }
}

function reusableIndexRows(
  rows: VectorRow[],
  currentFiles: Map<string, { checksum: string }>,
  config: { embeddingProvider: string; embeddingModel: string },
): VectorRow[] {
  const rowsByFile = new Map<string, VectorRow[]>()
  for (const row of rows) {
    const fileRows = rowsByFile.get(row.relativePath) ?? []
    fileRows.push(row)
    rowsByFile.set(row.relativePath, fileRows)
  }

  const reusableRows: VectorRow[] = []
  for (const [relativePath, fileRows] of rowsByFile) {
    const file = currentFiles.get(relativePath)
    if (!file) {
      continue
    }
    if (
      fileRows.every(
        (row) =>
          row.checksum === file.checksum &&
          row.embeddingProvider === config.embeddingProvider &&
          row.embeddingModel === config.embeddingModel,
      )
    ) {
      reusableRows.push(...fileRows)
    }
  }
  return reusableRows
}

export async function audit(cwd = process.cwd()): Promise<AuditReport> {
  const config = await loadConfig(cwd)
  const inventory = await inventorySourceFiles(config)
  const files = inventory.supportedFiles
  const supportedFiles = files.map((file) => file.relativePath)
  const table = await openRowsTable(config)
  const emptyTextFiles = await currentEmptyTextFiles(config, files)

  if (!table) {
    return {
      indexedFiles: [],
      supportedFiles,
      skippedFiles: inventory.skippedFiles,
      emptyTextFiles: [...emptyTextFiles],
      unsupportedExtensions: summarizeUnsupportedExtensions(inventory.skippedFiles),
      missingFromIndex: supportedFiles.filter((file) => !emptyTextFiles.has(file)),
      staleInIndex: [],
      totalChunks: 0,
    }
  }

  const rows = (await table.query().limit(MAX_AUDIT_ROWS).toArray()) as Array<{
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
    indexedFiles: [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([source, chunks]) => ({ source, chunks })),
    supportedFiles,
    skippedFiles: inventory.skippedFiles,
    emptyTextFiles: [...emptyTextFiles].sort(),
    unsupportedExtensions: summarizeUnsupportedExtensions(inventory.skippedFiles),
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

function countSkipped(
  files: Array<{ reason: SkippedSourceReason }>,
  reason: SkippedSourceReason,
): number {
  return files.filter((file) => file.reason === reason).length
}
