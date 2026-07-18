import { randomUUID } from "node:crypto"
import { createReadStream } from "node:fs"
import { open as openFile, readdir, readFile, rm } from "node:fs/promises"
import path from "node:path"
import { syncDirectory, writePrivateFileAtomic } from "./durable-file.js"
import { isRecord } from "./guards.js"
import { ensurePrivateDirectory, hardenPrivateFile } from "./permissions.js"
import type {
  Config,
  IndexManifest,
  IndexManifestFile,
  IngestionFileStage,
  IngestionProgress,
  IngestionRunMode,
  IngestionRunStatus,
  SourceFile,
} from "./types.js"

const INGESTION_STATE_VERSION = 3
const LEGACY_INGESTION_STATE_VERSION = 2
const INGESTION_STATE_FILENAME = "ingestion-state.json"
const INGESTION_FILES_PREFIX = "ingestion-state.files."
const INGESTION_FILES_SUFFIX = ".jsonl"
const INGESTION_JOURNAL_VERSION = 1
const INGESTION_JOURNAL_FILENAME = "ingestion-state.journal.jsonl"
const STREAM_WRITE_BYTES = 64 * 1_024
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const GENERATION_ID_PATTERN = /^[0-9a-f]{32}$/iu

export interface IngestionFileState {
  relativePath: string
  checksum: string
  bytes: number
  mtimeMs: number
  policyFingerprint: string
  state: IngestionFileStage
  chunkCount: number
  lastGoodChecksum: string | null
  lastGoodChunkCount: number
  lastGoodBytes: number | null
  lastGoodMtimeMs: number | null
  staleLastKnownGood: boolean
  redactions: number
  error: string | null
  reused: boolean
  updatedAt: string
}

type IngestionFileUpdate = Partial<
  Pick<
    IngestionFileState,
    | "state"
    | "chunkCount"
    | "lastGoodChecksum"
    | "lastGoodChunkCount"
    | "lastGoodBytes"
    | "lastGoodMtimeMs"
    | "staleLastKnownGood"
    | "redactions"
    | "error"
    | "reused"
  >
>

export interface IngestionRunState {
  version: number
  runId: string
  mode: IngestionRunMode
  status: IngestionRunStatus
  tableName: string
  previousTableName: string | null
  policyFingerprint: string
  batchSize: number
  createdAt: string
  updatedAt: string
  lastActivityAt: string
  resumed: boolean
  files: IngestionFileState[]
}

interface PersistedIngestionRunHeader extends Omit<IngestionRunState, "files"> {
  version: typeof INGESTION_STATE_VERSION
  fileSnapshot: string
  fileCount: number
}

interface IngestionRuntime {
  filesByPath: Map<string, IngestionFileState>
  stageCounts: Record<IngestionFileStage, number>
  staleFiles: number
  chunksIndexed: number
  dirtyFiles: Set<string>
  headerDirty: boolean
  snapshotPersisted: boolean
}

const ingestionRuntimes = new WeakMap<IngestionRunState, IngestionRuntime>()

interface CreateIngestionRunStateOptions {
  mode: IngestionRunMode
  tableName: string
  previousTableName: string | null
  policyFingerprint: string
  batchSize: number
  files: SourceFile[]
  reusablePaths: Set<string>
  reusableChunkCounts: Map<string, number>
  previousFiles?: Map<string, IndexManifestFile>
}

export function createIngestionRunState(
  options: CreateIngestionRunStateOptions,
): IngestionRunState {
  const now = new Date().toISOString()
  const state: IngestionRunState = {
    version: INGESTION_STATE_VERSION,
    runId: randomUUID(),
    mode: options.mode,
    status: "running",
    tableName: options.tableName,
    previousTableName: options.previousTableName,
    policyFingerprint: options.policyFingerprint,
    batchSize: options.batchSize,
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
    resumed: false,
    files: options.files.map((file) => {
      const reused = options.reusablePaths.has(file.relativePath)
      const previous = options.previousFiles?.get(file.relativePath)
      const lastGoodChecksum = previous?.checksum ?? (reused ? file.checksum : null)
      const lastGoodChunkCount =
        previous?.chunkCount ?? options.reusableChunkCounts.get(file.relativePath) ?? 0
      return {
        relativePath: file.relativePath,
        checksum: file.checksum,
        bytes: file.bytes,
        mtimeMs: file.mtimeMs,
        policyFingerprint: options.policyFingerprint,
        state: reused ? "indexed" : "pending",
        chunkCount: lastGoodChunkCount,
        lastGoodChecksum,
        lastGoodChunkCount,
        lastGoodBytes: previous?.bytes ?? (reused ? file.bytes : null),
        lastGoodMtimeMs: previous?.mtimeMs ?? (reused ? file.mtimeMs : null),
        staleLastKnownGood: lastGoodChecksum !== null && lastGoodChecksum !== file.checksum,
        redactions: 0,
        error: null,
        reused,
        updatedAt: now,
      }
    }),
  }
  ingestionRuntimes.set(state, createRuntime(state, false))
  return state
}

export function canResumeIngestion(
  state: IngestionRunState,
  files: SourceFile[],
  policyFingerprint: string,
  rebuildRequested: boolean,
): boolean {
  if (
    !["running", "interrupted", "failed"].includes(state.status) ||
    state.policyFingerprint !== policyFingerprint ||
    (rebuildRequested && state.mode !== "rebuild") ||
    state.files.length !== files.length
  ) {
    return false
  }

  const currentFiles = new Map(files.map((file) => [file.relativePath, file]))
  return state.files.every((file) => {
    const current = currentFiles.get(file.relativePath)
    return current?.checksum === file.checksum && current.bytes === file.bytes
  })
}

export function resumeIngestionState(state: IngestionRunState): IngestionRunState {
  const now = nextIsoTimestamp(state.updatedAt)
  const runtime = runtimeFor(state)
  for (const file of state.files) {
    if (file.state === "indexed") {
      continue
    }
    const staleLastKnownGood =
      file.lastGoodChecksum !== null && file.lastGoodChecksum !== file.checksum
    if (
      file.state === "pending" &&
      file.chunkCount === file.lastGoodChunkCount &&
      file.error === null &&
      file.staleLastKnownGood === staleLastKnownGood
    ) {
      continue
    }
    applyIngestionFileUpdate(
      runtime,
      file,
      {
        state: "pending",
        chunkCount: file.lastGoodChunkCount,
        error: null,
        staleLastKnownGood,
      },
      now,
    )
  }
  state.status = "running"
  state.resumed = true
  state.updatedAt = now
  state.lastActivityAt = now
  runtime.headerDirty = true
  return state
}

export function updateIngestionFile(
  state: IngestionRunState,
  relativePath: string,
  update: IngestionFileUpdate,
): IngestionRunState {
  const now = nextIsoTimestamp(state.updatedAt)
  const runtime = runtimeFor(state)
  const file = runtime.filesByPath.get(relativePath)
  if (!file) {
    return state
  }
  applyIngestionFileUpdate(runtime, file, update, now)
  state.updatedAt = now
  state.lastActivityAt = now
  runtime.headerDirty = true
  return state
}

export function reconcileIngestionFile(
  state: IngestionRunState,
  relativePath: string,
  update: IngestionFileUpdate,
): IngestionRunState {
  const now = nextIsoTimestamp(state.updatedAt)
  const runtime = runtimeFor(state)
  const file = runtime.filesByPath.get(relativePath)
  if (!file) {
    return state
  }
  applyIngestionFileUpdate(runtime, file, update, file.updatedAt)
  state.updatedAt = now
  state.lastActivityAt = now
  runtime.headerDirty = true
  return state
}

export function finishIngestionState(
  state: IngestionRunState,
  status: Exclude<IngestionRunStatus, "running">,
): IngestionRunState {
  const now = nextIsoTimestamp(state.updatedAt)
  state.status = status
  state.updatedAt = now
  state.lastActivityAt = now
  runtimeFor(state).headerDirty = true
  return state
}

export async function writeIngestionState(state: IngestionRunState, config: Config): Promise<void> {
  const runtime = runtimeFor(state)
  if (!runtime.snapshotPersisted) {
    await compactIngestionState(state, config)
    return
  }

  if (!runtime.headerDirty && runtime.dirtyFiles.size === 0) {
    return
  }

  await appendPrivateJournal(
    path.join(config.storageDir, INGESTION_JOURNAL_FILENAME),
    ingestionJournalRecords(state, runtime),
    config.storageDir,
  )
  runtime.headerDirty = false
  runtime.dirtyFiles.clear()
}

export async function compactIngestionState(
  state: IngestionRunState,
  config: Config,
): Promise<void> {
  state.version = INGESTION_STATE_VERSION
  const fileSnapshot = ingestionFileSnapshotFilename(state.runId)
  await writePrivateJsonLinesAtomic(
    path.join(config.storageDir, fileSnapshot),
    state.files,
    config.storageDir,
  )
  await writePrivateJsonAtomic(
    path.join(config.storageDir, INGESTION_STATE_FILENAME),
    ingestionRunHeader(state, fileSnapshot),
    config.storageDir,
  )
  await rm(path.join(config.storageDir, INGESTION_JOURNAL_FILENAME), { force: true })
  await removeStaleIngestionFileSnapshots(fileSnapshot, config)
  const runtime = runtimeFor(state)
  runtime.snapshotPersisted = true
  runtime.headerDirty = false
  runtime.dirtyFiles.clear()
}

export async function writeStagedIndexManifest(
  manifest: IndexManifest,
  runId: string,
  config: Config,
): Promise<void> {
  await writePrivateJsonAtomic(stagedManifestPath(runId, config), manifest, config.storageDir)
}

export async function removeStagedIndexManifest(runId: string, config: Config): Promise<void> {
  await rm(stagedManifestPath(runId, config), { force: true })
}

export async function readIngestionState(config: Config): Promise<IngestionRunState | null> {
  try {
    const value = JSON.parse(
      await readFile(path.join(config.storageDir, INGESTION_STATE_FILENAME), "utf8"),
    ) as unknown
    const hydrated = await hydrateIngestionRunState(value, config)
    if (!hydrated) {
      return null
    }
    const { state, filesByPath } = hydrated
    const runtime = createRuntime(state, true, filesByPath)
    ingestionRuntimes.set(state, runtime)
    if (!(await applyIngestionJournal(state, config, runtime, state.updatedAt))) {
      return null
    }
    runtime.headerDirty = false
    runtime.dirtyFiles.clear()
    return state
  } catch (error) {
    if (error instanceof SyntaxError || (isNodeError(error) && error.code === "ENOENT")) {
      return null
    }
    throw error
  }
}

export async function getIngestionProgress(config: Config): Promise<IngestionProgress | null> {
  const state = await readIngestionState(config)
  return state ? ingestionProgress(state) : null
}

export function ingestionProgress(state: IngestionRunState): IngestionProgress {
  const runtime = runtimeFor(state)
  return {
    runId: state.runId,
    mode: state.mode,
    status: state.status,
    resumed: state.resumed,
    batchSize: state.batchSize,
    totalFiles: runtime.filesByPath.size,
    pendingFiles: runtime.stageCounts.pending,
    parsedFiles: runtime.stageCounts.parsed,
    embeddedFiles: runtime.stageCounts.embedded,
    indexedFiles: runtime.stageCounts.indexed,
    errorFiles: runtime.stageCounts.error,
    staleFiles: runtime.staleFiles,
    chunksIndexed: runtime.chunksIndexed,
    lastActivityAt: state.lastActivityAt,
  }
}

function runtimeFor(state: IngestionRunState): IngestionRuntime {
  const existing = ingestionRuntimes.get(state)
  if (existing) {
    return existing
  }
  const runtime = createRuntime(state, false)
  ingestionRuntimes.set(state, runtime)
  return runtime
}

function createRuntime(
  state: IngestionRunState,
  snapshotPersisted: boolean,
  existingFilesByPath?: Map<string, IngestionFileState>,
): IngestionRuntime {
  const stageCounts: Record<IngestionFileStage, number> = {
    pending: 0,
    parsed: 0,
    embedded: 0,
    indexed: 0,
    error: 0,
  }
  const filesByPath = existingFilesByPath ?? new Map<string, IngestionFileState>()
  let staleFiles = 0
  let chunksIndexed = 0
  for (const file of state.files) {
    if (!existingFilesByPath) {
      filesByPath.set(file.relativePath, file)
    }
    stageCounts[file.state] += 1
    staleFiles += file.staleLastKnownGood ? 1 : 0
    chunksIndexed += indexedChunkContribution(file)
  }
  return {
    filesByPath,
    stageCounts,
    staleFiles,
    chunksIndexed,
    dirtyFiles: new Set(),
    headerDirty: false,
    snapshotPersisted,
  }
}

function applyIngestionFileUpdate(
  runtime: IngestionRuntime,
  file: IngestionFileState,
  update: IngestionFileUpdate,
  now: string,
): void {
  const previousStage = file.state
  const previousStale = file.staleLastKnownGood
  const previousChunks = indexedChunkContribution(file)
  Object.assign(file, update, { updatedAt: now })
  if (file.state !== previousStage) {
    runtime.stageCounts[previousStage] -= 1
    runtime.stageCounts[file.state] += 1
  }
  runtime.staleFiles += Number(file.staleLastKnownGood) - Number(previousStale)
  runtime.chunksIndexed += indexedChunkContribution(file) - previousChunks
  runtime.dirtyFiles.add(file.relativePath)
  runtime.filesByPath.set(file.relativePath, file)
}

function indexedChunkContribution(file: IngestionFileState): number {
  if (file.staleLastKnownGood) {
    return file.lastGoodChunkCount
  }
  return file.state === "indexed" ? file.chunkCount : 0
}

async function applyIngestionJournal(
  state: IngestionRunState,
  config: Config,
  runtime: IngestionRuntime,
  snapshotUpdatedAt: string,
): Promise<boolean> {
  const stream = createReadStream(path.join(config.storageDir, INGESTION_JOURNAL_FILENAME))
  stream.setEncoding("utf8")
  let buffered = ""
  try {
    for await (const chunk of stream) {
      buffered += typeof chunk === "string" ? chunk : chunk.toString("utf8")
      let lineEnd = buffered.indexOf("\n")
      while (lineEnd >= 0) {
        const line = buffered.slice(0, lineEnd)
        buffered = buffered.slice(lineEnd + 1)
        if (line && !applyIngestionJournalLine(state, runtime, snapshotUpdatedAt, line)) {
          return false
        }
        lineEnd = buffered.indexOf("\n")
      }
    }
    return true
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return true
    }
    throw error
  }
}

function applyIngestionJournalLine(
  state: IngestionRunState,
  runtime: IngestionRuntime,
  snapshotUpdatedAt: string,
  line: string,
): boolean {
  let value: unknown
  try {
    value = JSON.parse(line) as unknown
  } catch {
    return false
  }
  if (
    !isRecord(value) ||
    value.version !== INGESTION_JOURNAL_VERSION ||
    typeof value.runId !== "string"
  ) {
    return false
  }
  if (value.runId !== state.runId) {
    return true
  }
  if (value.type === "run") {
    if (
      !isIngestionRunStatus(value.status) ||
      typeof value.resumed !== "boolean" ||
      !isIsoTimestamp(value.updatedAt) ||
      !isIsoTimestamp(value.lastActivityAt)
    ) {
      return false
    }
    if (value.updatedAt > snapshotUpdatedAt && value.updatedAt > state.updatedAt) {
      state.status = value.status
      state.resumed = value.resumed
      state.updatedAt = value.updatedAt
      state.lastActivityAt = value.lastActivityAt
    }
    return true
  }
  if (
    value.type !== "file" ||
    !isIsoTimestamp(value.writtenAt) ||
    !isIngestionFileState(value.file, state.policyFingerprint)
  ) {
    return false
  }
  const current = runtime.filesByPath.get(value.file.relativePath)
  if (
    !current ||
    current.checksum !== value.file.checksum ||
    current.bytes !== value.file.bytes ||
    current.mtimeMs !== value.file.mtimeMs
  ) {
    return false
  }
  if (value.writtenAt > snapshotUpdatedAt) {
    applyIngestionFileUpdate(runtime, current, value.file, value.file.updatedAt)
  }
  return true
}

function nextIsoTimestamp(previous: string): string {
  const now = Date.now()
  const previousTime = Date.parse(previous)
  return new Date(Math.max(now, previousTime + 1)).toISOString()
}

async function hydrateIngestionRunState(
  value: unknown,
  config: Config,
): Promise<{ state: IngestionRunState; filesByPath?: Map<string, IngestionFileState> } | null> {
  if (isIngestionRunState(value, config)) {
    return { state: value }
  }
  if (!isPersistedIngestionRunHeader(value, config)) {
    return null
  }

  const files = await readIngestionFileSnapshot(value, config)
  if (!files) {
    return null
  }
  return {
    state: {
      version: value.version,
      runId: value.runId,
      mode: value.mode,
      status: value.status,
      tableName: value.tableName,
      previousTableName: value.previousTableName,
      policyFingerprint: value.policyFingerprint,
      batchSize: value.batchSize,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
      lastActivityAt: value.lastActivityAt,
      resumed: value.resumed,
      files: files.values,
    },
    filesByPath: files.byPath,
  }
}

async function readIngestionFileSnapshot(
  header: PersistedIngestionRunHeader,
  config: Config,
): Promise<{ values: IngestionFileState[]; byPath: Map<string, IngestionFileState> } | null> {
  const values: IngestionFileState[] = []
  const byPath = new Map<string, IngestionFileState>()
  const stream = createReadStream(path.join(config.storageDir, header.fileSnapshot))
  stream.setEncoding("utf8")
  let buffered = ""

  const applyLine = (line: string): boolean => {
    let value: unknown
    try {
      value = JSON.parse(line) as unknown
    } catch {
      return false
    }
    if (!isIngestionFileState(value, header.policyFingerprint) || byPath.has(value.relativePath)) {
      return false
    }
    values.push(value)
    byPath.set(value.relativePath, value)
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
    return values.length === header.fileCount ? { values, byPath } : null
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null
    }
    throw error
  }
}

function isIngestionRunState(value: unknown, config: Config): value is IngestionRunState {
  if (
    !isRecord(value) ||
    (value.version !== LEGACY_INGESTION_STATE_VERSION &&
      value.version !== INGESTION_STATE_VERSION) ||
    !isUuidV4(value.runId) ||
    (value.mode !== "incremental" && value.mode !== "rebuild") ||
    !isIngestionRunStatus(value.status) ||
    typeof value.tableName !== "string" ||
    (value.previousTableName !== null && typeof value.previousTableName !== "string") ||
    typeof value.policyFingerprint !== "string" ||
    value.policyFingerprint.length === 0 ||
    !isPositiveSafeInteger(value.batchSize) ||
    !isIsoTimestamp(value.createdAt) ||
    !isIsoTimestamp(value.updatedAt) ||
    !isIsoTimestamp(value.lastActivityAt) ||
    typeof value.resumed !== "boolean" ||
    !Array.isArray(value.files)
  ) {
    return false
  }

  const policyFingerprint = value.policyFingerprint
  if (!value.files.every((file) => isIngestionFileState(file, policyFingerprint))) {
    return false
  }

  const uniquePaths = new Set(value.files.map((file) => file.relativePath))
  if (uniquePaths.size !== value.files.length || !isManagedTableName(value.tableName, config)) {
    return false
  }

  if (value.mode === "incremental") {
    return value.previousTableName === null
  }

  return (
    value.tableName === generationTableName(config.tableName, value.runId) &&
    value.previousTableName !== null &&
    value.previousTableName !== value.tableName &&
    isManagedTableName(value.previousTableName, config)
  )
}

function isPersistedIngestionRunHeader(
  value: unknown,
  config: Config,
): value is PersistedIngestionRunHeader {
  return (
    isRecord(value) &&
    value.version === INGESTION_STATE_VERSION &&
    isIngestionRunMetadata(value, config) &&
    value.fileSnapshot === ingestionFileSnapshotFilename(value.runId) &&
    isNonNegativeSafeInteger(value.fileCount)
  )
}

function isIngestionRunMetadata(
  value: Record<string, unknown>,
  config: Config,
): value is Record<string, unknown> & Omit<IngestionRunState, "files" | "version"> {
  if (
    !isUuidV4(value.runId) ||
    (value.mode !== "incremental" && value.mode !== "rebuild") ||
    !isIngestionRunStatus(value.status) ||
    typeof value.tableName !== "string" ||
    (value.previousTableName !== null && typeof value.previousTableName !== "string") ||
    typeof value.policyFingerprint !== "string" ||
    value.policyFingerprint.length === 0 ||
    !isPositiveSafeInteger(value.batchSize) ||
    !isIsoTimestamp(value.createdAt) ||
    !isIsoTimestamp(value.updatedAt) ||
    !isIsoTimestamp(value.lastActivityAt) ||
    typeof value.resumed !== "boolean" ||
    !isManagedTableName(value.tableName, config)
  ) {
    return false
  }
  if (value.mode === "incremental") {
    return value.previousTableName === null
  }
  return (
    value.tableName === generationTableName(config.tableName, value.runId) &&
    value.previousTableName !== null &&
    value.previousTableName !== value.tableName &&
    isManagedTableName(value.previousTableName, config)
  )
}

function isIngestionRunStatus(value: unknown): value is IngestionRunStatus {
  return (
    value === "running" ||
    value === "interrupted" ||
    value === "failed" ||
    value === "completed" ||
    value === "completed_with_errors"
  )
}

function stagedManifestPath(runId: string, config: Config): string {
  if (!isUuidV4(runId)) {
    throw new Error("Ingestion runId must be a valid UUID v4.")
  }
  const storageDir = path.resolve(config.storageDir)
  const targetPath = path.resolve(storageDir, `index-manifest.${runId}.staging.json`)
  const relativePath = path.relative(storageDir, targetPath)
  if (relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    throw new Error("Staged index manifest must remain inside storageDir.")
  }
  return targetPath
}

function isIngestionFileState(
  value: unknown,
  policyFingerprint: string,
): value is IngestionFileState {
  if (
    !(
      isRecord(value) &&
      typeof value.relativePath === "string" &&
      value.relativePath.length > 0 &&
      !value.relativePath.includes("\0") &&
      typeof value.checksum === "string" &&
      value.checksum.length > 0 &&
      isNonNegativeSafeInteger(value.bytes) &&
      isNonNegativeFiniteNumber(value.mtimeMs) &&
      value.policyFingerprint === policyFingerprint &&
      isIngestionFileStage(value.state) &&
      isNonNegativeSafeInteger(value.chunkCount) &&
      (value.lastGoodChecksum === null ||
        (typeof value.lastGoodChecksum === "string" && value.lastGoodChecksum.length > 0)) &&
      isNonNegativeSafeInteger(value.lastGoodChunkCount) &&
      (value.lastGoodBytes === null || isNonNegativeSafeInteger(value.lastGoodBytes)) &&
      (value.lastGoodMtimeMs === null || isNonNegativeFiniteNumber(value.lastGoodMtimeMs)) &&
      typeof value.staleLastKnownGood === "boolean" &&
      isNonNegativeSafeInteger(value.redactions) &&
      (value.error === null || typeof value.error === "string") &&
      typeof value.reused === "boolean" &&
      isIsoTimestamp(value.updatedAt) &&
      (!value.reused || value.state === "indexed")
    )
  ) {
    return false
  }

  const hasLastGood = value.lastGoodChecksum !== null
  if (
    (!hasLastGood &&
      (value.lastGoodChunkCount !== 0 ||
        value.lastGoodBytes !== null ||
        value.lastGoodMtimeMs !== null)) ||
    (value.staleLastKnownGood &&
      (!hasLastGood || value.lastGoodChecksum === value.checksum || value.state === "indexed"))
  ) {
    return false
  }

  return (
    value.state !== "indexed" ||
    (value.lastGoodChecksum === value.checksum &&
      value.lastGoodChunkCount === value.chunkCount &&
      value.lastGoodBytes === value.bytes &&
      value.lastGoodMtimeMs === value.mtimeMs &&
      !value.staleLastKnownGood)
  )
}

export function generationTableName(baseName: string, runId: string): string {
  if (!isUuidV4(runId)) {
    throw new Error("Ingestion runId must be a valid UUID v4.")
  }
  return `${baseName}__generation_${runId.replaceAll("-", "")}`
}

function isManagedTableName(tableName: string, config: Config): boolean {
  if (tableName === config.tableName) {
    return true
  }
  const prefix = `${config.tableName}__generation_`
  return tableName.startsWith(prefix) && GENERATION_ID_PATTERN.test(tableName.slice(prefix.length))
}

function isUuidV4(value: unknown): value is string {
  return typeof value === "string" && UUID_V4_PATTERN.test(value)
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") {
    return false
  }
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

function isIngestionFileStage(value: unknown): value is IngestionFileStage {
  return (
    value === "pending" ||
    value === "parsed" ||
    value === "embedded" ||
    value === "indexed" ||
    value === "error"
  )
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}

function ingestionRunHeader(
  state: IngestionRunState,
  fileSnapshot: string,
): PersistedIngestionRunHeader {
  return {
    version: INGESTION_STATE_VERSION,
    runId: state.runId,
    mode: state.mode,
    status: state.status,
    tableName: state.tableName,
    previousTableName: state.previousTableName,
    policyFingerprint: state.policyFingerprint,
    batchSize: state.batchSize,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    lastActivityAt: state.lastActivityAt,
    resumed: state.resumed,
    fileSnapshot,
    fileCount: state.files.length,
  }
}

function ingestionFileSnapshotFilename(runId: string): string {
  if (!isUuidV4(runId)) {
    throw new Error("Ingestion runId must be a valid UUID v4.")
  }
  return `${INGESTION_FILES_PREFIX}${runId}${INGESTION_FILES_SUFFIX}`
}

function* ingestionJournalRecords(
  state: IngestionRunState,
  runtime: IngestionRuntime,
): Generator<unknown> {
  if (runtime.headerDirty) {
    yield {
      version: INGESTION_JOURNAL_VERSION,
      runId: state.runId,
      type: "run",
      status: state.status,
      resumed: state.resumed,
      updatedAt: state.updatedAt,
      lastActivityAt: state.lastActivityAt,
    }
  }
  for (const relativePath of runtime.dirtyFiles) {
    const file = runtime.filesByPath.get(relativePath)
    if (file) {
      yield {
        version: INGESTION_JOURNAL_VERSION,
        runId: state.runId,
        type: "file",
        writtenAt: state.updatedAt,
        file,
      }
    }
  }
}

async function removeStaleIngestionFileSnapshots(
  currentFilename: string,
  config: Config,
): Promise<void> {
  const entries = await readdir(config.storageDir)
  await Promise.all(
    entries
      .filter(
        (entry) =>
          entry !== currentFilename &&
          entry.startsWith(INGESTION_FILES_PREFIX) &&
          entry.endsWith(INGESTION_FILES_SUFFIX) &&
          isUuidV4(entry.slice(INGESTION_FILES_PREFIX.length, -INGESTION_FILES_SUFFIX.length)),
      )
      .map((entry) => rm(path.join(config.storageDir, entry), { force: true })),
  )
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
  values: Iterable<unknown>,
  directory: string,
): Promise<void> {
  await writePrivateFileAtomic(targetPath, directory, (handle) => writeJsonLines(handle, values))
}

async function appendPrivateJournal(
  targetPath: string,
  records: Iterable<unknown>,
  directory: string,
): Promise<void> {
  await ensurePrivateDirectory(directory)
  const handle = await openFile(targetPath, "a", 0o600)
  try {
    await hardenPrivateFile(targetPath)
    await writeJsonLines(handle, records)
    await handle.sync()
  } finally {
    await handle.close()
  }
  await syncDirectory(directory)
}

async function writeJsonLines(
  handle: Awaited<ReturnType<typeof openFile>>,
  values: Iterable<unknown>,
): Promise<void> {
  let buffered = ""
  for (const value of values) {
    buffered += `${JSON.stringify(value)}\n`
    if (Buffer.byteLength(buffered) >= STREAM_WRITE_BYTES) {
      await handle.writeFile(buffered, "utf8")
      buffered = ""
    }
  }
  if (buffered) {
    await handle.writeFile(buffered, "utf8")
  }
}
