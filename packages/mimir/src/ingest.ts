import { recordAccess } from "./access-log.js"
import { chunkDocument } from "./chunking.js"
import { loadConfig } from "./config.js"
import { embedTexts } from "./embeddings.js"
import { listSourceFiles } from "./files.js"
import { parseFile } from "./parsing.js"
import { redactText, totalRedactions } from "./redaction.js"
import { openRowsTable, writeRows } from "./store.js"
import type {
  AuditReport,
  IngestOptions,
  IngestResult,
  RedactionCount,
  TextChunk,
  VectorRow,
} from "./types.js"

const EMBED_BATCH_SIZE = 32
const MAX_AUDIT_ROWS = 100_000

export async function ingest(options: IngestOptions = {}): Promise<IngestResult> {
  const config = await loadConfig(String(options.cwd ?? process.cwd()))
  const files = await listSourceFiles(config)
  const allChunks: TextChunk[] = []
  const errors: IngestResult["errors"] = []
  const redactionCounts: RedactionCount[] = []
  let skippedFiles = 0

  for (const file of files) {
    try {
      const parsed = await parseFile(file)
      const redacted = redactText(parsed.text, config)
      redactionCounts.push(...redacted.counts)
      const chunks = chunkDocument(
        { ...parsed, text: redacted.text },
        config.chunkSize,
        config.chunkOverlap,
      )
      if (chunks.length === 0) {
        skippedFiles += 1
      }
      allChunks.push(...chunks)
    } catch (error) {
      errors.push({
        path: file.relativePath,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const rows: VectorRow[] = []
  for (let i = 0; i < allChunks.length; i += EMBED_BATCH_SIZE) {
    const batch = allChunks.slice(i, i + EMBED_BATCH_SIZE)
    const embeddings = await embedTexts(
      batch.map((chunk) => chunk.text),
      config,
    )
    for (const [index, chunk] of batch.entries()) {
      const vector = embeddings[index]
      if (!vector) {
        throw new Error(`Missing embedding for chunk ${chunk.relativePath}#${chunk.chunkIndex}.`)
      }
      rows.push({ ...chunk, vector })
    }
  }

  await writeRows(rows, config)
  await recordAccess(config, {
    action: "ingest",
    resultCount: rows.length,
    redactions: totalRedactions(redactionCounts),
  })

  return {
    indexedFiles: new Set(rows.map((row) => row.relativePath)).size,
    chunks: rows.length,
    skippedFiles,
    redactions: totalRedactions(redactionCounts),
    errors,
  }
}

export async function audit(cwd = process.cwd()): Promise<AuditReport> {
  const config = await loadConfig(cwd)
  const files = await listSourceFiles(config)
  const supportedFiles = files.map((file) => file.relativePath)
  const table = await openRowsTable(config)

  if (!table) {
    return {
      indexedFiles: [],
      supportedFiles,
      missingFromIndex: supportedFiles,
      staleInIndex: [],
      totalChunks: 0,
    }
  }

  const rows = (await table.query().limit(MAX_AUDIT_ROWS).toArray()) as Array<{
    relativePath: string
  }>
  const counts = new Map<string, number>()
  for (const row of rows) {
    counts.set(row.relativePath, (counts.get(row.relativePath) ?? 0) + 1)
  }

  const supportedSet = new Set(supportedFiles)
  const indexedSet = new Set(counts.keys())

  return {
    indexedFiles: [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([source, chunks]) => ({ source, chunks })),
    supportedFiles,
    missingFromIndex: supportedFiles.filter((file) => !indexedSet.has(file)),
    staleInIndex: [...indexedSet].filter((file) => !supportedSet.has(file)).sort(),
    totalChunks: rows.length,
  }
}
