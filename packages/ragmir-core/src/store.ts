import { readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import * as lancedb from "@lancedb/lancedb"
import { INDEX_MANIFEST_FILENAME } from "./defaults.js"
import { isRecord } from "./guards.js"
import { ensurePrivateDirectory, hardenPrivateFile } from "./permissions.js"
import type { Config, IndexManifest, VectorRow } from "./types.js"

const EMPTY_TEXT_FILES_MANIFEST = "empty-text-files.json"

export interface EmptyTextFileRecord {
  relativePath: string
  checksum: string
  bytes?: number
  mtimeMs?: number
}

export interface IndexWriteResult {
  vectorIndexWarning: string | null
  lexicalIndexWarning: string | null
}

export async function writeRows(rows: VectorRow[], config: Config): Promise<IndexWriteResult> {
  await ensurePrivateDirectory(config.storageDir)
  const db = await lancedb.connect(config.storageDir)

  if (rows.length === 0) {
    const tableNames = await db.tableNames()
    if (tableNames.includes(config.tableName)) {
      await db.dropTable(config.tableName)
    }
    await rm(path.join(config.storageDir, INDEX_MANIFEST_FILENAME), { force: true })
    return { vectorIndexWarning: null, lexicalIndexWarning: null }
  }

  const records = storedRows(rows)
  const table = await db.createTable(config.tableName, records, {
    mode: "overwrite",
  })

  const lexicalResult = await ensureLexicalIndex(table)
  return {
    vectorIndexWarning: null,
    lexicalIndexWarning: lexicalResult.warning,
  }
}

export async function updateRows(
  rows: VectorRow[],
  replacePaths: string[],
  config: Config,
): Promise<IndexWriteResult> {
  const table = await openRowsTable(config)
  if (!table) {
    return writeRows(rows, config)
  }

  for (const paths of batches([...new Set(replacePaths)], 200)) {
    if (paths.length > 0) {
      await table.delete(`relativePath IN (${paths.map(sqlString).join(", ")})`)
    }
  }
  if (rows.length > 0) {
    await table.add(storedRows(rows))
  }

  const lexicalResult = await ensureLexicalIndex(table)
  return { vectorIndexWarning: null, lexicalIndexWarning: lexicalResult.warning }
}

interface EnsureVectorIndexResult {
  created: boolean
  warning: string | null
}

async function ensureLexicalIndex(table: lancedb.Table): Promise<EnsureVectorIndexResult> {
  const existing = await table.listIndices()
  const hasTextIndex = existing.some((index) => index.name === "searchText_idx")
  if (hasTextIndex) {
    return { created: false, warning: null }
  }

  try {
    await table.createIndex("searchText", {
      config: lancedb.Index.fts({ asciiFolding: true, lowercase: true }),
    })
    return { created: true, warning: null }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return {
      created: false,
      warning: `Full-text index training failed (${detail}). Falling back to bounded lexical scans; keyword recall may be lower on large corpora.`,
    }
  }
}

export async function writeIndexManifest(manifest: IndexManifest, config: Config): Promise<void> {
  await ensurePrivateDirectory(config.storageDir)
  const manifestPath = path.join(config.storageDir, INDEX_MANIFEST_FILENAME)
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8")
  await hardenPrivateFile(manifestPath)
}

export async function readIndexManifest(config: Config): Promise<IndexManifest | null> {
  try {
    const raw = JSON.parse(
      await readFile(path.join(config.storageDir, INDEX_MANIFEST_FILENAME), "utf8"),
    ) as unknown
    if (!isRecord(raw)) {
      return null
    }
    return isIndexManifest(raw) ? raw : null
  } catch (error) {
    // The manifest is purely diagnostic. A missing file (pre-manifest index) or
    // a corrupt/unreadable file should surface as "no freshness info" rather
    // than fail the caller.
    if (error instanceof SyntaxError) {
      return null
    }
    if (isNodeError(error) && error.code === "ENOENT") {
      return null
    }
    throw error
  }
}

function isIndexManifest(value: unknown): value is IndexManifest {
  if (!isRecord(value)) {
    return false
  }
  return (
    typeof value.schemaVersion === "number" &&
    typeof value.createdAt === "string" &&
    typeof value.ragmirVersion === "string" &&
    (value.embeddingProvider === "local-hash" || value.embeddingProvider === "transformers") &&
    typeof value.embeddingModel === "string" &&
    (!("indexPolicyFingerprint" in value) || typeof value.indexPolicyFingerprint === "string") &&
    (!("vectorDimension" in value) || typeof value.vectorDimension === "number") &&
    (!("vectorDistanceMetric" in value) || typeof value.vectorDistanceMetric === "string") &&
    typeof value.chunkSize === "number" &&
    typeof value.chunkOverlap === "number" &&
    typeof value.fileCount === "number" &&
    typeof value.chunkCount === "number" &&
    (!("indexedFiles" in value) ||
      (Array.isArray(value.indexedFiles) && value.indexedFiles.every(isIndexManifestFile)))
  )
}

function isIndexManifestFile(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.relativePath === "string" &&
    typeof value.checksum === "string" &&
    typeof value.chunkCount === "number" &&
    (!("bytes" in value) || typeof value.bytes === "number") &&
    (!("mtimeMs" in value) || typeof value.mtimeMs === "number")
  )
}

export async function writeEmptyTextFiles(
  records: EmptyTextFileRecord[],
  config: Config,
): Promise<void> {
  const manifestPath = path.join(config.storageDir, EMPTY_TEXT_FILES_MANIFEST)
  if (records.length === 0) {
    await rm(manifestPath, { force: true })
    return
  }

  await ensurePrivateDirectory(config.storageDir)
  const sortedRecords = [...records].sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  await writeFile(
    manifestPath,
    JSON.stringify({ version: 1, files: sortedRecords }, null, 2),
    "utf8",
  )
  await hardenPrivateFile(manifestPath)
}

export async function readEmptyTextFiles(config: Config): Promise<EmptyTextFileRecord[]> {
  try {
    const manifest = JSON.parse(
      await readFile(path.join(config.storageDir, EMPTY_TEXT_FILES_MANIFEST), "utf8"),
    ) as unknown
    if (!isRecord(manifest) || !Array.isArray(manifest.files)) {
      return []
    }
    return manifest.files.filter(isEmptyTextFileRecord)
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return []
    }
    throw error
  }
}

export async function openRowsTable(config: Config): Promise<lancedb.Table | null> {
  await ensurePrivateDirectory(config.storageDir)
  const db = await lancedb.connect(config.storageDir)
  const tableNames = await db.tableNames()
  if (!tableNames.includes(config.tableName)) {
    return null
  }
  return db.openTable(config.tableName)
}

export async function readRows(config: Config): Promise<VectorRow[]> {
  const table = await openRowsTable(config)
  if (!table) {
    return []
  }
  return ((await table.query().toArray()) as StoredVectorRow[]).map(vectorRowFromStored)
}

export async function countRows(config: Config): Promise<number> {
  const table = await openRowsTable(config)
  return table ? table.countRows() : 0
}

interface StoredVectorRow extends Omit<VectorRow, "vector" | "pageStart" | "pageEnd"> {
  vector: unknown
  pageStart?: unknown
  pageEnd?: unknown
}

function storedRows(rows: VectorRow[]): Array<Record<string, unknown>> {
  return rows.map((row) => ({
    ...row,
    pageStart: row.pageStart ?? 0,
    pageEnd: row.pageEnd ?? 0,
  }))
}

function vectorRowFromStored(row: StoredVectorRow): VectorRow {
  const { pageStart, pageEnd, ...rest } = row
  return {
    ...rest,
    vector: normalizeVector(row.vector),
    ...(typeof pageStart === "number" && pageStart > 0 ? { pageStart } : {}),
    ...(typeof pageEnd === "number" && pageEnd > 0 ? { pageEnd } : {}),
  }
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function batches<T>(values: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

function normalizeVector(vector: unknown): number[] {
  if (Array.isArray(vector) && vector.every((value) => typeof value === "number")) {
    return vector
  }
  if (ArrayBuffer.isView(vector) && "length" in vector) {
    return Array.from(vector as unknown as ArrayLike<number>)
  }
  if (hasIndexedNumberGetter(vector)) {
    return Array.from({ length: vector.length }, (_, index) => vector.get(index))
  }
  throw new Error("Stored vector row is not a numeric vector.")
}

function hasIndexedNumberGetter(value: unknown): value is {
  length: number
  get: (index: number) => number
} {
  return (
    typeof value === "object" &&
    value !== null &&
    "length" in value &&
    typeof value.length === "number" &&
    "get" in value &&
    typeof value.get === "function"
  )
}

function isEmptyTextFileRecord(value: unknown): value is EmptyTextFileRecord {
  return (
    isRecord(value) &&
    typeof value.relativePath === "string" &&
    typeof value.checksum === "string" &&
    (!("bytes" in value) || typeof value.bytes === "number") &&
    (!("mtimeMs" in value) || typeof value.mtimeMs === "number")
  )
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}
