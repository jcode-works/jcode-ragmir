import { randomUUID } from "node:crypto"
import { readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import * as lancedb from "@lancedb/lancedb"
import { INDEX_MANIFEST_FILENAME } from "./defaults.js"
import { isRecord } from "./guards.js"
import { ensurePrivateDirectory, hardenPrivateFile } from "./permissions.js"
import { isIndexQualityReport } from "./quality-report.js"
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

export async function connectStore(config: Config): Promise<lancedb.Connection> {
  await ensurePrivateDirectory(config.storageDir)
  return lancedb.connect(config.storageDir, {
    readConsistencyInterval: 0,
  })
}

export async function writeRows(
  rows: VectorRow[],
  config: Config,
  connection?: lancedb.Connection,
): Promise<IndexWriteResult> {
  const tableName = await activeIndexTableName(config)
  const result = await writeRowsToTable(rows, tableName, config, connection)
  if (rows.length === 0) {
    await rm(path.join(config.storageDir, INDEX_MANIFEST_FILENAME), { force: true })
  }
  return result
}

export async function writeRowsToTable(
  rows: VectorRow[],
  tableName: string,
  config: Config,
  connection?: lancedb.Connection,
): Promise<IndexWriteResult> {
  return withConnection(config, connection, async (db) => {
    if (rows.length === 0) {
      const tableNames = await db.tableNames()
      if (tableNames.includes(tableName)) {
        await db.dropTable(tableName)
      }
      return { vectorIndexWarning: null, lexicalIndexWarning: null }
    }

    const records = storedRows(rows)
    const table = await db.createTable(tableName, records, {
      mode: "overwrite",
    })

    const lexicalResult = await ensureLexicalIndex(table)
    return {
      vectorIndexWarning: null,
      lexicalIndexWarning: lexicalResult.warning,
    }
  })
}

export async function updateRows(
  rows: VectorRow[],
  replacePaths: string[],
  config: Config,
  connection?: lancedb.Connection,
): Promise<IndexWriteResult> {
  const tableName = await activeIndexTableName(config)
  return updateRowsInTable(rows, replacePaths, tableName, config, connection)
}

export async function updateRowsInTable(
  rows: VectorRow[],
  replacePaths: string[],
  tableName: string,
  config: Config,
  connection?: lancedb.Connection,
): Promise<IndexWriteResult> {
  const table = await openRowsTableByName(tableName, config, connection)
  if (!table) {
    return writeRowsToTable(rows, tableName, config, connection)
  }

  const uniquePaths = [...new Set(replacePaths)]
  if (rows.length > 0) {
    let merge = table.mergeInsert("id").whenMatchedUpdateAll().whenNotMatchedInsertAll()
    if (uniquePaths.length > 0) {
      merge = merge.whenNotMatchedBySourceDelete({
        where: `relativePath IN (${uniquePaths.map(sqlString).join(", ")})`,
      })
    }
    await merge.execute(storedRows(rows))
  } else {
    for (const paths of batches(uniquePaths, 200)) {
      await table.delete(`relativePath IN (${paths.map(sqlString).join(", ")})`)
    }
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
  const manifestPath = path.join(config.storageDir, INDEX_MANIFEST_FILENAME)
  await writePrivateJsonAtomic(manifestPath, manifest, config.storageDir)
}

export async function readIndexManifest(config: Config): Promise<IndexManifest | null> {
  try {
    const raw = JSON.parse(
      await readFile(path.join(config.storageDir, INDEX_MANIFEST_FILENAME), "utf8"),
    ) as unknown
    if (!isRecord(raw)) {
      return null
    }
    if (!isIndexManifest(raw)) {
      return null
    }
    const { qualityReport, ...manifest } = raw
    return isIndexQualityReport(qualityReport) ? { ...manifest, qualityReport } : manifest
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

function isIndexManifest(
  value: unknown,
): value is Omit<IndexManifest, "qualityReport"> & { qualityReport?: unknown } {
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
    (!("tableName" in value) || typeof value.tableName === "string") &&
    (!("indexedFiles" in value) ||
      (Array.isArray(value.indexedFiles) && value.indexedFiles.every(isIndexManifestFile))) &&
    (!("staleFiles" in value) ||
      (Array.isArray(value.staleFiles) && value.staleFiles.every(isIndexManifestStaleFile)))
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

function isIndexManifestStaleFile(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.relativePath === "string" &&
    typeof value.currentChecksum === "string" &&
    typeof value.lastGoodChecksum === "string" &&
    typeof value.chunkCount === "number" &&
    typeof value.error === "string"
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

  const sortedRecords = [...records].sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  await writePrivateJsonAtomic(
    manifestPath,
    { version: 1, files: sortedRecords },
    config.storageDir,
  )
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

export async function openRowsTable(
  config: Config,
  connection?: lancedb.Connection,
): Promise<lancedb.Table | null> {
  return openRowsTableByName(await activeIndexTableName(config), config, connection)
}

export async function openRowsTableByName(
  tableName: string,
  config: Config,
  connection?: lancedb.Connection,
): Promise<lancedb.Table | null> {
  return withConnection(config, connection, async (db) => {
    const tableNames = await db.tableNames()
    if (!tableNames.includes(tableName)) {
      return null
    }
    return db.openTable(tableName)
  })
}

export async function activeIndexTableName(config: Config): Promise<string> {
  return (await readIndexManifest(config))?.tableName ?? config.tableName
}

export async function dropRowsTable(
  tableName: string,
  config: Config,
  connection?: lancedb.Connection,
): Promise<void> {
  await withConnection(config, connection, async (db) => {
    if ((await db.tableNames()).includes(tableName)) {
      await db.dropTable(tableName)
    }
  })
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

async function withConnection<T>(
  config: Config,
  connection: lancedb.Connection | undefined,
  operation: (connection: lancedb.Connection) => Promise<T>,
): Promise<T> {
  const activeConnection = connection ?? (await connectStore(config))
  try {
    return await operation(activeConnection)
  } finally {
    if (!connection) {
      activeConnection.close()
    }
  }
}

async function writePrivateJsonAtomic(
  targetPath: string,
  value: unknown,
  directory: string,
): Promise<void> {
  await ensurePrivateDirectory(directory)
  const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, JSON.stringify(value, null, 2), "utf8")
    await hardenPrivateFile(temporaryPath)
    await rename(temporaryPath, targetPath)
  } finally {
    await rm(temporaryPath, { force: true })
  }
}
