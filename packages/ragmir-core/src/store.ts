import { randomUUID } from "node:crypto"
import { channel } from "node:diagnostics_channel"
import { createReadStream, existsSync } from "node:fs"
import { readdir, readFile, rm, stat } from "node:fs/promises"
import path from "node:path"
import * as lancedb from "@lancedb/lancedb"
import { INDEX_MANIFEST_FILENAME } from "./defaults.js"
import { writePrivateFileAtomic } from "./durable-file.js"
import { isRecord } from "./guards.js"
import { ensurePrivateDirectory } from "./permissions.js"
import { isIndexQualityReport } from "./quality-report.js"
import type {
  Config,
  IndexHealthSnapshot,
  IndexMaintenanceSnapshot,
  IndexManifest,
  IndexManifestFile,
  SourceLocationKind,
  VectorRow,
} from "./types.js"

const EMPTY_TEXT_FILES_MANIFEST = "empty-text-files.json"
const INDEX_MANIFEST_PREVIOUS_FILENAME = "index-manifest.previous.json"
const INDEX_FILES_PREFIX = "index-manifest.files."
const INDEX_FILES_SUFFIX = ".jsonl"
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const STREAM_WRITE_BYTES = 64 * 1_024
export const INDEX_READ_DIAGNOSTICS_CHANNEL = "ragmir:index-read"

export interface IndexReadDiagnosticsEvent {
  kind:
    | "connection-open"
    | "connection-close"
    | "manifest-read"
    | "manifest-recovery"
    | "table-open"
    | "table-close"
  projectRoot: string
  recoveryReason?: "canonical-invalid" | "canonical-missing"
  tableName?: string
}

const indexReadDiagnostics = channel(INDEX_READ_DIAGNOSTICS_CHANNEL)

type PersistedIndexManifest = Omit<IndexManifest, "indexedFiles" | "qualityReport"> & {
  indexedFiles?: IndexManifestFile[]
  indexedFilesSnapshot?: string
  qualityReport?: unknown
}

type ManifestCandidateStatus = "valid" | "missing" | "invalid"

export interface IndexManifestRecoveryDiagnostic {
  canonicalStatus: ManifestCandidateStatus
  previousStatus: ManifestCandidateStatus | "not-checked"
  selected: "canonical" | "previous" | null
  warning: string | null
}

interface ManifestCandidate {
  status: ManifestCandidateStatus
  manifest: PersistedIndexManifest | null
}

interface ResolvedIndexManifest {
  manifest: PersistedIndexManifest | null
  recovery: IndexManifestRecoveryDiagnostic
}

const manifestRecoveryDiagnostics = new WeakMap<Config, IndexManifestRecoveryDiagnostic>()

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

export interface IndexReadSnapshot {
  manifest: IndexManifest | null
  manifestFingerprint: string | null
  tableName: string
  table: lancedb.Table | null
}

export interface IndexManifestFilePage {
  files: IndexManifestFile[]
  total: number
  offset: number
  limit: number
  nextOffset: number | null
}

export async function connectStore(config: Config): Promise<lancedb.Connection> {
  await ensurePrivateDirectory(config.storageDir)
  const connection = await lancedb.connect(config.storageDir, {
    readConsistencyInterval: 0,
  })
  publishIndexReadDiagnostics({ kind: "connection-open", projectRoot: config.projectRoot })
  return connection
}

export function closeStoreConnection(connection: lancedb.Connection, config: Config): void {
  if (!connection.isOpen()) {
    return
  }
  connection.close()
  publishIndexReadDiagnostics({ kind: "connection-close", projectRoot: config.projectRoot })
}

export function closeIndexReadSnapshot(snapshot: IndexReadSnapshot, config: Config): void {
  if (!snapshot.table) {
    return
  }
  closeRowsTable(snapshot.table, config)
}

export function closeRowsTable(table: lancedb.Table, config: Config): void {
  if (!table.isOpen()) {
    return
  }
  table.close()
  publishIndexReadDiagnostics({
    kind: "table-close",
    projectRoot: config.projectRoot,
    tableName: table.name,
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
      config: lancedb.Index.fts({ asciiFolding: true, lowercase: true, withPosition: true }),
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
  const previousSelection = await resolveIndexManifest(config)
  const previousManifest = previousSelection.manifest ?? persistedManifest
  await writePrivateJsonAtomic(
    path.join(config.storageDir, INDEX_MANIFEST_PREVIOUS_FILENAME),
    previousManifest,
    config.storageDir,
  )
  await writePrivateJsonAtomic(manifestPath, persistedManifest, config.storageDir)
  manifestRecoveryDiagnostics.set(config, {
    canonicalStatus: "valid",
    previousStatus: "valid",
    selected: "canonical",
    warning: null,
  })
  await removeStaleIndexFileSnapshots(
    new Set(
      [currentSnapshot, previousManifest.indexedFilesSnapshot].filter(
        (filename): filename is string => filename !== null && filename !== undefined,
      ),
    ),
    config,
  )
}

export async function readIndexManifest(config: Config): Promise<IndexManifest | null> {
  const raw = (await resolveIndexManifest(config)).manifest
  if (!raw) {
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
}

export async function readIndexManifestHeader(config: Config): Promise<IndexManifest | null> {
  publishIndexReadDiagnostics({ kind: "manifest-read", projectRoot: config.projectRoot })
  const raw = (await resolveIndexManifest(config)).manifest
  if (!raw) {
    return null
  }
  const { indexedFiles: _files, indexedFilesSnapshot: _snapshot, qualityReport, ...manifest } = raw
  return isIndexQualityReport(qualityReport) ? { ...manifest, qualityReport } : manifest
}

export async function readIndexManifestFilePage(
  config: Config,
  offset: number,
  limit: number,
): Promise<IndexManifestFilePage | null> {
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new Error("Index manifest file page offset must be a non-negative integer.")
  }
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error("Index manifest file page limit must be a positive integer.")
  }

  publishIndexReadDiagnostics({ kind: "manifest-read", projectRoot: config.projectRoot })
  const raw = (await resolveIndexManifest(config)).manifest
  if (!raw) {
    return null
  }
  const files = raw.indexedFilesSnapshot
    ? await readIndexFileSnapshotPage(raw.indexedFilesSnapshot, config, offset, limit)
    : (raw.indexedFiles?.slice(offset, offset + limit) ?? null)
  if (!files || offset > raw.fileCount || offset + files.length > raw.fileCount) {
    return null
  }
  const nextOffset = offset + files.length < raw.fileCount ? offset + files.length : null
  return { files, total: raw.fileCount, offset, limit, nextOffset }
}

export async function loadIndexReadSnapshot(
  config: Config,
  connection?: lancedb.Connection,
): Promise<IndexReadSnapshot> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const fingerprintBefore = await indexManifestFingerprint(config)
    const manifest = await readIndexManifestHeader(config)
    const fingerprintAfter = await indexManifestFingerprint(config)
    if (fingerprintBefore !== fingerprintAfter) {
      continue
    }
    const immutableManifest = manifest ? Object.freeze({ ...manifest }) : null
    const tableName = immutableManifest?.tableName ?? config.tableName
    const recoveryFailed =
      immutableManifest === null && indexManifestRecoveryWarning(config) !== null
    return {
      manifest: immutableManifest,
      manifestFingerprint: fingerprintAfter,
      tableName,
      table: recoveryFailed ? null : await openRowsTableByName(tableName, config, connection),
    }
  }
  throw new Error(
    "Index generation changed repeatedly while opening a read snapshot. Retry the operation.",
  )
}

export async function indexReadSnapshotCurrent(
  snapshot: IndexReadSnapshot,
  config: Config,
): Promise<boolean> {
  return snapshot.manifestFingerprint === (await indexManifestFingerprint(config))
}

async function indexManifestFingerprint(config: Config): Promise<string | null> {
  const [canonical, previous] = await Promise.all([
    fileFingerprint(path.join(config.storageDir, INDEX_MANIFEST_FILENAME)),
    fileFingerprint(path.join(config.storageDir, INDEX_MANIFEST_PREVIOUS_FILENAME)),
  ])
  return canonical === null && previous === null
    ? null
    : `${canonical ?? "missing"}|${previous ?? "missing"}`
}

async function readRawIndexManifest(
  config: Config,
  filename = INDEX_MANIFEST_FILENAME,
): Promise<unknown> {
  return JSON.parse(await readFile(path.join(config.storageDir, filename), "utf8")) as unknown
}

export function indexManifestRecoveryDiagnostic(
  config: Config,
): IndexManifestRecoveryDiagnostic | null {
  return manifestRecoveryDiagnostics.get(config) ?? null
}

export function indexManifestRecoveryWarning(config: Config): string | null {
  return indexManifestRecoveryDiagnostic(config)?.warning ?? null
}

async function resolveIndexManifest(config: Config): Promise<ResolvedIndexManifest> {
  const canonical = await readManifestCandidate(INDEX_MANIFEST_FILENAME, config)
  if (canonical.status === "valid") {
    const recovery: IndexManifestRecoveryDiagnostic = {
      canonicalStatus: "valid",
      previousStatus: "not-checked",
      selected: "canonical",
      warning: null,
    }
    manifestRecoveryDiagnostics.set(config, recovery)
    return { manifest: canonical.manifest, recovery }
  }

  const previous = await readManifestCandidate(INDEX_MANIFEST_PREVIOUS_FILENAME, config)
  if (previous.status === "valid") {
    const recovery: IndexManifestRecoveryDiagnostic = {
      canonicalStatus: canonical.status,
      previousStatus: "valid",
      selected: "previous",
      warning:
        canonical.status === "missing"
          ? "Canonical index manifest is missing. Ragmir recovered the last validated generation; run `rgr ingest --rebuild` to repair the canonical sidecar."
          : "Canonical index manifest is invalid. Ragmir recovered the last validated generation; run `rgr ingest --rebuild` to repair the canonical sidecar.",
    }
    manifestRecoveryDiagnostics.set(config, recovery)
    publishIndexReadDiagnostics({
      kind: "manifest-recovery",
      projectRoot: config.projectRoot,
      recoveryReason: canonical.status === "missing" ? "canonical-missing" : "canonical-invalid",
      ...(previous.manifest?.tableName ? { tableName: previous.manifest.tableName } : {}),
    })
    return { manifest: previous.manifest, recovery }
  }

  const noSidecar = canonical.status === "missing" && previous.status === "missing"
  const recovery: IndexManifestRecoveryDiagnostic = {
    canonicalStatus: canonical.status,
    previousStatus: previous.status,
    selected: null,
    warning: noSidecar
      ? null
      : "Index manifest recovery failed because no valid canonical or previous sidecar is available. Run `rgr ingest --rebuild`; Ragmir will not select an unverified default table.",
  }
  manifestRecoveryDiagnostics.set(config, recovery)
  return { manifest: null, recovery }
}

async function readManifestCandidate(filename: string, config: Config): Promise<ManifestCandidate> {
  try {
    const value = await readRawIndexManifest(config, filename)
    if (!isIndexManifest(value) || !manifestReferencesManagedTable(value, config)) {
      return { status: "invalid", manifest: null }
    }
    if (value.indexedFiles && value.indexedFiles.length !== value.fileCount) {
      return { status: "invalid", manifest: null }
    }
    if (value.indexedFilesSnapshot) {
      const snapshot = await stat(path.join(config.storageDir, value.indexedFilesSnapshot))
      if (!snapshot.isFile()) {
        return { status: "invalid", manifest: null }
      }
    }
    return { status: "valid", manifest: value }
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { status: "invalid", manifest: null }
    }
    if (isNodeError(error) && error.code === "ENOENT") {
      return { status: "missing", manifest: null }
    }
    throw error
  }
}

function manifestReferencesManagedTable(manifest: PersistedIndexManifest, config: Config): boolean {
  const tableName = manifest.tableName ?? config.tableName
  if (tableName === config.tableName) {
    return true
  }
  const prefix = `${config.tableName}__generation_`
  const generationId = tableName.startsWith(prefix) ? tableName.slice(prefix.length) : ""
  return /^[0-9a-f]{32}$/iu.test(generationId)
}

async function fileFingerprint(filePath: string): Promise<string | null> {
  try {
    const details = await stat(filePath)
    return `${details.dev}:${details.ino}:${details.size}:${details.mtimeMs}`
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null
    }
    throw error
  }
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
    (!("embeddingModelRevision" in value) || typeof value.embeddingModelRevision === "string") &&
    (!("embeddingModelDigest" in value) ||
      value.embeddingModelDigest === null ||
      typeof value.embeddingModelDigest === "string") &&
    (!("indexPolicyFingerprint" in value) || typeof value.indexPolicyFingerprint === "string") &&
    (!("vectorDimension" in value) || typeof value.vectorDimension === "number") &&
    (!("vectorDistanceMetric" in value) || typeof value.vectorDistanceMetric === "string") &&
    (!("vectorIndex" in value) || isVectorIndexManifest(value.vectorIndex)) &&
    typeof value.chunkSize === "number" &&
    typeof value.chunkOverlap === "number" &&
    typeof value.fileCount === "number" &&
    typeof value.chunkCount === "number" &&
    (!("corpusFingerprint" in value) ||
      (typeof value.corpusFingerprint === "string" &&
        /^[0-9a-f]{64}$/u.test(value.corpusFingerprint))) &&
    (!("tableName" in value) || typeof value.tableName === "string") &&
    (!("indexedFiles" in value) ||
      (Array.isArray(value.indexedFiles) && value.indexedFiles.every(isIndexManifestFile))) &&
    (!("indexedFilesSnapshot" in value) ||
      isIndexFilesSnapshotFilename(value.indexedFilesSnapshot)) &&
    !("indexedFiles" in value && "indexedFilesSnapshot" in value) &&
    (!("staleFiles" in value) ||
      (Array.isArray(value.staleFiles) && value.staleFiles.every(isIndexManifestStaleFile))) &&
    (!("health" in value) || isIndexHealthSnapshot(value.health)) &&
    (!("maintenance" in value) || isIndexMaintenanceSnapshot(value.maintenance))
  )
}

function isIndexHealthSnapshot(value: unknown): value is IndexHealthSnapshot {
  if (!isRecord(value) || !isRecord(value.previews) || !isRecord(value.previewOmitted)) {
    return false
  }
  return (
    value.schemaVersion === 1 &&
    typeof value.checkedAt === "string" &&
    isNonNegativeInteger(value.discoveredFiles) &&
    isNonNegativeInteger(value.supportedFiles) &&
    isNonNegativeNumber(value.supportedBytes) &&
    isNonNegativeNumber(value.largestFileBytes) &&
    isNonNegativeInteger(value.skippedFiles) &&
    isNonNegativeInteger(value.unsupportedFiles) &&
    isNonNegativeInteger(value.oversizedFiles) &&
    isNonNegativeInteger(value.sensitiveFiles) &&
    isNonNegativeInteger(value.emptyTextFiles) &&
    isNonNegativeInteger(value.missingFromIndex) &&
    isNonNegativeInteger(value.staleInIndex) &&
    isStringArray(value.previews.missingFromIndex) &&
    isStringArray(value.previews.staleInIndex) &&
    isStringArray(value.previews.emptyTextFiles) &&
    isNonNegativeInteger(value.previewOmitted.missingFromIndex) &&
    isNonNegativeInteger(value.previewOmitted.staleInIndex) &&
    isNonNegativeInteger(value.previewOmitted.emptyTextFiles) &&
    isStringCountRecord(value.skippedByReason) &&
    isSourceDiagnostics(value.sourceDiagnostics) &&
    typeof value.securityCheckedAt === "string" &&
    isStringArray(value.securityWarnings)
  )
}

function isIndexMaintenanceSnapshot(value: unknown): value is IndexMaintenanceSnapshot {
  if (!isRecord(value) || !isRecord(value.fragments) || !isRecord(value.fullTextIndex)) {
    return false
  }
  return (
    value.schemaVersion === 1 &&
    typeof value.checkedAt === "string" &&
    ["missing", "healthy", "needed", "completed", "warning"].includes(String(value.status)) &&
    (value.tableVersion === null || isNonNegativeInteger(value.tableVersion)) &&
    isNonNegativeInteger(value.mutationsSinceOptimization) &&
    isNonNegativeInteger(value.fragments.total) &&
    isNonNegativeInteger(value.fragments.small) &&
    isNonNegativeNumber(value.fragments.smallRatio) &&
    typeof value.fullTextIndex.present === "boolean" &&
    isNonNegativeInteger(value.fullTextIndex.indexedRows) &&
    isNonNegativeInteger(value.fullTextIndex.unindexedRows) &&
    typeof value.fullTextIndex.complete === "boolean" &&
    (value.warning === null || typeof value.warning === "string")
  )
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
}

function isStringCountRecord(value: unknown): value is Record<string, number> {
  return isRecord(value) && Object.values(value).every(isNonNegativeInteger)
}

function isSourceDiagnostics(value: unknown): boolean {
  if (!isRecord(value)) {
    return false
  }
  return (
    Array.isArray(value.duplicateCandidates) &&
    value.duplicateCandidates.every(
      (entry) => isRecord(entry) && typeof entry.key === "string" && isStringArray(entry.files),
    ) &&
    isSourcePathCandidates(value.archiveCandidates) &&
    isSourcePathCandidates(value.mirrorCandidates)
  )
}

function isSourcePathCandidates(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.relativePath === "string" &&
        typeof entry.reason === "string",
    )
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
  if (!connection && !existsSync(config.storageDir)) {
    return null
  }
  return withConnection(config, connection, async (db) => {
    const tableNames = await db.tableNames()
    if (!tableNames.includes(tableName)) {
      return null
    }
    publishIndexReadDiagnostics({
      kind: "table-open",
      projectRoot: config.projectRoot,
      tableName,
    })
    return db.openTable(tableName)
  })
}

function publishIndexReadDiagnostics(event: IndexReadDiagnosticsEvent): void {
  if (indexReadDiagnostics.hasSubscribers) {
    indexReadDiagnostics.publish(event)
  }
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
      closeStoreConnection(activeConnection, config)
    }
  }
}

async function writePrivateJsonAtomic(
  targetPath: string,
  value: unknown,
  directory: string,
): Promise<void> {
  await writePrivateFileAtomic(targetPath, directory, async (handle) => {
    await handle.writeFile(JSON.stringify(value, null, 2), "utf8")
  })
}

async function writePrivateJsonLinesAtomic(
  targetPath: string,
  values: Iterable<IndexManifestFile>,
  directory: string,
): Promise<number> {
  let count = 0
  await writePrivateFileAtomic(targetPath, directory, async (handle) => {
    let previousKey: string | null = null
    let buffered = ""
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
  })
  return count
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

async function readIndexFileSnapshotPage(
  filename: string,
  config: Config,
  offset: number,
  limit: number,
): Promise<IndexManifestFile[] | null> {
  if (!isIndexFilesSnapshotFilename(filename)) {
    return null
  }
  const values: IndexManifestFile[] = []
  const stream = createReadStream(path.join(config.storageDir, filename))
  stream.setEncoding("utf8")
  let buffered = ""
  let lineNumber = 0
  let previousKey: string | null = null
  const applyLine = (line: string): "continue" | "done" | "invalid" => {
    let value: unknown
    try {
      value = JSON.parse(line) as unknown
    } catch {
      return "invalid"
    }
    if (!isIndexManifestFile(value)) {
      return "invalid"
    }
    const key = `${value.relativePath}\0${value.checksum}`
    if (previousKey !== null && key <= previousKey) {
      return "invalid"
    }
    previousKey = key
    if (lineNumber >= offset) {
      values.push(value)
    }
    lineNumber += 1
    return values.length >= limit ? "done" : "continue"
  }
  try {
    for await (const chunk of stream) {
      buffered += typeof chunk === "string" ? chunk : chunk.toString("utf8")
      let lineEnd = buffered.indexOf("\n")
      while (lineEnd >= 0) {
        const line = buffered.slice(0, lineEnd)
        buffered = buffered.slice(lineEnd + 1)
        if (!line) {
          return null
        }
        const outcome = applyLine(line)
        if (outcome === "invalid") {
          return null
        }
        if (outcome === "done") {
          stream.destroy()
          return values
        }
        lineEnd = buffered.indexOf("\n")
      }
    }
    if (buffered) {
      const outcome = applyLine(buffered)
      if (outcome === "invalid") {
        return null
      }
    }
    return lineNumber >= offset ? values : null
  } finally {
    stream.destroy()
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
  retainedFilenames: ReadonlySet<string>,
  config: Config,
): Promise<void> {
  const entries = await readdir(config.storageDir)
  await Promise.all(
    entries
      .filter((entry) => !retainedFilenames.has(entry) && isIndexFilesSnapshotFilename(entry))
      .map((entry) => rm(path.join(config.storageDir, entry), { force: true })),
  )
}
