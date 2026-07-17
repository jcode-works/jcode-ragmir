import { randomUUID } from "node:crypto"
import { createReadStream } from "node:fs"
import { open as openFile, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import * as lancedb from "@lancedb/lancedb"
import { INDEX_MANIFEST_FILENAME } from "./defaults.js"
import { isRecord } from "./guards.js"
import { ensurePrivateDirectory, hardenPrivateFile } from "./permissions.js"
import { isIndexQualityReport } from "./quality-report.js"
import type {
  Config,
  IndexManifest,
  IndexManifestFile,
  SourceLocationKind,
  VectorRow,
} from "./types.js"

const EMPTY_TEXT_FILES_MANIFEST = "empty-text-files.json"
const INDEX_FILES_PREFIX = "index-manifest.files."
const INDEX_FILES_SUFFIX = ".jsonl"
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const STREAM_WRITE_BYTES = 64 * 1_024

type PersistedIndexManifest = Omit<IndexManifest, "indexedFiles" | "qualityReport"> & {
  indexedFilesSnapshot?: string
  qualityReport?: unknown
}

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

export async function writeIndexManifest(
  manifest: IndexManifest,
  config: Config,
  indexedFiles: Iterable<IndexManifestFile> | undefined = manifest.indexedFiles,
): Promise<void> {
  const manifestPath = path.join(config.storageDir, INDEX_MANIFEST_FILENAME)
  const { indexedFiles: _indexedFiles, ...manifestHeader } = manifest
  let persistedManifest: PersistedIndexManifest = manifestHeader
  let currentSnapshot: string | null = null
  if (indexedFiles) {
    currentSnapshot = indexFilesSnapshotFilename(randomUUID())
    const writtenFiles = await writePrivateJsonLinesAtomic(
      path.join(config.storageDir, currentSnapshot),
      indexedFiles,
      config.storageDir,
    )
    if (writtenFiles !== manifest.fileCount) {
      await rm(path.join(config.storageDir, currentSnapshot), { force: true })
      throw new Error(
        `Index manifest expected ${manifest.fileCount} files but received ${writtenFiles}.`,
      )
    }
    persistedManifest = { ...manifestHeader, indexedFilesSnapshot: currentSnapshot }
  }
  await writePrivateJsonAtomic(manifestPath, persistedManifest, config.storageDir)
  await removeStaleIndexFileSnapshots(currentSnapshot, config)
}

export async function readIndexManifest(config: Config): Promise<IndexManifest | null> {
  try {
    const raw = await readRawIndexManifest(config)
    if (!isIndexManifest(raw)) {
      return null
    }
    const { indexedFilesSnapshot, qualityReport, ...manifest } = raw
    const indexedFiles = indexedFilesSnapshot
      ? await readIndexFileSnapshot(indexedFilesSnapshot, config)
      : raw.indexedFiles
    if (indexedFilesSnapshot && (!indexedFiles || indexedFiles.length !== raw.fileCount)) {
      return null
    }
    const hydrated = indexedFiles ? { ...manifest, indexedFiles } : manifest
    return isIndexQualityReport(qualityReport) ? { ...hydrated, qualityReport } : hydrated
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

async function readIndexManifestHeader(config: Config): Promise<IndexManifest | null> {
  try {
    const raw = await readRawIndexManifest(config)
    if (!isIndexManifest(raw)) {
      return null
    }
    const {
      indexedFiles: _files,
      indexedFilesSnapshot: _snapshot,
      qualityReport,
      ...manifest
    } = raw
    return isIndexQualityReport(qualityReport) ? { ...manifest, qualityReport } : manifest
  } catch (error) {
    if (error instanceof SyntaxError || (isNodeError(error) && error.code === "ENOENT")) {
      return null
    }
    throw error
  }
}

async function readRawIndexManifest(config: Config): Promise<unknown> {
  return JSON.parse(
    await readFile(path.join(config.storageDir, INDEX_MANIFEST_FILENAME), "utf8"),
  ) as unknown
}

function isIndexManifest(
  value: unknown,
): value is Omit<IndexManifest, "qualityReport"> & PersistedIndexManifest {
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
    (!("vectorIndex" in value) || isVectorIndexManifest(value.vectorIndex)) &&
    typeof value.chunkSize === "number" &&
    typeof value.chunkOverlap === "number" &&
    typeof value.fileCount === "number" &&
    typeof value.chunkCount === "number" &&
    (!("tableName" in value) || typeof value.tableName === "string") &&
    (!("indexedFiles" in value) ||
      (Array.isArray(value.indexedFiles) && value.indexedFiles.every(isIndexManifestFile))) &&
    (!("indexedFilesSnapshot" in value) ||
      isIndexFilesSnapshotFilename(value.indexedFilesSnapshot)) &&
    !("indexedFiles" in value && "indexedFilesSnapshot" in value) &&
    (!("staleFiles" in value) ||
      (Array.isArray(value.staleFiles) && value.staleFiles.every(isIndexManifestStaleFile)))
  )
}

function isVectorIndexManifest(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.parameters)) {
    return false
  }
  const parameters = value.parameters
  return (
    value.policyVersion === 1 &&
    (value.strategy === "exact" || value.strategy === "ivf-pq" || value.strategy === "hnsw-sq") &&
    (value.indexName === null || typeof value.indexName === "string") &&
    (value.indexType === null || typeof value.indexType === "string") &&
    value.column === "vector" &&
    typeof value.distanceMetric === "string" &&
    typeof value.dimension === "number" &&
    Number.isInteger(value.dimension) &&
    value.dimension >= 0 &&
    typeof value.modelFingerprint === "string" &&
    typeof value.indexedRows === "number" &&
    Number.isInteger(value.indexedRows) &&
    value.indexedRows >= 0 &&
    typeof value.unindexedRows === "number" &&
    Number.isInteger(value.unindexedRows) &&
    value.unindexedRows >= 0 &&
    typeof value.coverage === "number" &&
    value.coverage >= 0 &&
    value.coverage <= 1 &&
    ["numPartitions", "numSubVectors", "nprobes", "refineFactor", "ef"].every(
      (key) => !(key in parameters) || isPositiveInteger(parameters[key]),
    )
  )
}

function isPositiveInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value > 0
}

function isIndexManifestFile(value: unknown): value is IndexManifestFile {
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
  return (await readIndexManifestHeader(config))?.tableName ?? config.tableName
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

interface StoredVectorRow
  extends Omit<
    VectorRow,
    | "vector"
    | "lineStart"
    | "lineEnd"
    | "pageStart"
    | "pageEnd"
    | "locationKind"
    | "locationStart"
    | "locationEnd"
    | "locationLabel"
    | "cellStart"
    | "cellEnd"
  > {
  vector: unknown
  lineStart?: unknown
  lineEnd?: unknown
  pageStart?: unknown
  pageEnd?: unknown
  locationKind?: unknown
  locationStart?: unknown
  locationEnd?: unknown
  locationLabel?: unknown
  cellStart?: unknown
  cellEnd?: unknown
}

function storedRows(rows: VectorRow[]): Array<Record<string, unknown>> {
  return rows.map((row) => ({
    ...row,
    lineStart: row.lineStart ?? 0,
    lineEnd: row.lineEnd ?? 0,
    pageStart: row.pageStart ?? 0,
    pageEnd: row.pageEnd ?? 0,
    locationKind: row.locationKind ?? "",
    locationStart: row.locationStart ?? 0,
    locationEnd: row.locationEnd ?? 0,
    locationLabel: row.locationLabel ?? "",
    cellStart: row.cellStart ?? "",
    cellEnd: row.cellEnd ?? "",
  }))
}

function vectorRowFromStored(row: StoredVectorRow): VectorRow {
  const {
    lineStart,
    lineEnd,
    pageStart,
    pageEnd,
    locationKind,
    locationStart,
    locationEnd,
    locationLabel,
    cellStart,
    cellEnd,
    ...rest
  } = row
  return {
    ...rest,
    vector: normalizeVector(row.vector),
    ...(positiveStoredInteger(lineStart) ? { lineStart } : {}),
    ...(positiveStoredInteger(lineEnd) ? { lineEnd } : {}),
    ...(typeof pageStart === "number" && pageStart > 0 ? { pageStart } : {}),
    ...(typeof pageEnd === "number" && pageEnd > 0 ? { pageEnd } : {}),
    ...(isSourceLocationKind(locationKind) ? { locationKind } : {}),
    ...(positiveStoredInteger(locationStart) ? { locationStart } : {}),
    ...(positiveStoredInteger(locationEnd) ? { locationEnd } : {}),
    ...(nonEmptyStoredString(locationLabel) ? { locationLabel } : {}),
    ...(nonEmptyStoredString(cellStart) ? { cellStart } : {}),
    ...(nonEmptyStoredString(cellEnd) ? { cellEnd } : {}),
  }
}

function positiveStoredInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
}

function nonEmptyStoredString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function isSourceLocationKind(value: unknown): value is SourceLocationKind {
  return value === "page" || value === "slide" || value === "sheet" || value === "epub"
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

async function writePrivateJsonLinesAtomic(
  targetPath: string,
  values: Iterable<IndexManifestFile>,
  directory: string,
): Promise<number> {
  await ensurePrivateDirectory(directory)
  const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`
  try {
    const handle = await openFile(temporaryPath, "wx", 0o600)
    let count = 0
    let previousKey: string | null = null
    let buffered = ""
    try {
      for (const value of values) {
        if (!isIndexManifestFile(value)) {
          throw new Error("Index manifest contains invalid file metadata.")
        }
        const key = `${value.relativePath}\0${value.checksum}`
        if (previousKey !== null && key <= previousKey) {
          throw new Error("Index manifest file metadata must be unique and sorted.")
        }
        previousKey = key
        count += 1
        buffered += `${JSON.stringify(value)}\n`
        if (Buffer.byteLength(buffered) >= STREAM_WRITE_BYTES) {
          await handle.writeFile(buffered, "utf8")
          buffered = ""
        }
      }
      if (buffered) {
        await handle.writeFile(buffered, "utf8")
      }
      await handle.sync()
    } finally {
      await handle.close()
    }
    await hardenPrivateFile(temporaryPath)
    await rename(temporaryPath, targetPath)
    return count
  } finally {
    await rm(temporaryPath, { force: true })
  }
}

async function readIndexFileSnapshot(
  filename: string,
  config: Config,
): Promise<IndexManifestFile[] | null> {
  if (!isIndexFilesSnapshotFilename(filename)) {
    return null
  }
  const values: IndexManifestFile[] = []
  const stream = createReadStream(path.join(config.storageDir, filename))
  stream.setEncoding("utf8")
  let buffered = ""
  let previousKey: string | null = null
  const applyLine = (line: string): boolean => {
    let value: unknown
    try {
      value = JSON.parse(line) as unknown
    } catch {
      return false
    }
    if (!isIndexManifestFile(value)) {
      return false
    }
    const key = `${value.relativePath}\0${value.checksum}`
    if (previousKey !== null && key <= previousKey) {
      return false
    }
    previousKey = key
    values.push(value)
    return true
  }
  try {
    for await (const chunk of stream) {
      buffered += typeof chunk === "string" ? chunk : chunk.toString("utf8")
      let lineEnd = buffered.indexOf("\n")
      while (lineEnd >= 0) {
        const line = buffered.slice(0, lineEnd)
        buffered = buffered.slice(lineEnd + 1)
        if (!line || !applyLine(line)) {
          return null
        }
        lineEnd = buffered.indexOf("\n")
      }
    }
    if (buffered && !applyLine(buffered)) {
      return null
    }
    return values
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null
    }
    throw error
  }
}

function indexFilesSnapshotFilename(id: string): string {
  if (!UUID_V4_PATTERN.test(id)) {
    throw new Error("Index file snapshot id must be a valid UUID v4.")
  }
  return `${INDEX_FILES_PREFIX}${id}${INDEX_FILES_SUFFIX}`
}

function isIndexFilesSnapshotFilename(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith(INDEX_FILES_PREFIX) &&
    value.endsWith(INDEX_FILES_SUFFIX) &&
    UUID_V4_PATTERN.test(value.slice(INDEX_FILES_PREFIX.length, -INDEX_FILES_SUFFIX.length))
  )
}

async function removeStaleIndexFileSnapshots(
  currentFilename: string | null,
  config: Config,
): Promise<void> {
  const entries = await readdir(config.storageDir)
  await Promise.all(
    entries
      .filter((entry) => entry !== currentFilename && isIndexFilesSnapshotFilename(entry))
      .map((entry) => rm(path.join(config.storageDir, entry), { force: true })),
  )
}
