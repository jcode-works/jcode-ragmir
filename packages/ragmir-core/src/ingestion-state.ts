import { randomUUID } from "node:crypto"
import { readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
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

const INGESTION_STATE_VERSION = 2
const INGESTION_STATE_FILENAME = "ingestion-state.json"
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
  return {
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
  const now = new Date().toISOString()
  return {
    ...state,
    status: "running",
    resumed: true,
    updatedAt: now,
    lastActivityAt: now,
    files: state.files.map((file) =>
      file.state === "indexed"
        ? file
        : {
            ...file,
            state: "pending",
            chunkCount: file.lastGoodChunkCount,
            error: null,
            staleLastKnownGood:
              file.lastGoodChecksum !== null && file.lastGoodChecksum !== file.checksum,
            updatedAt: now,
          },
    ),
  }
}

export function updateIngestionFile(
  state: IngestionRunState,
  relativePath: string,
  update: Partial<
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
  >,
): IngestionRunState {
  const now = new Date().toISOString()
  return {
    ...state,
    updatedAt: now,
    lastActivityAt: now,
    files: state.files.map((file) =>
      file.relativePath === relativePath ? { ...file, ...update, updatedAt: now } : file,
    ),
  }
}

export function finishIngestionState(
  state: IngestionRunState,
  status: Exclude<IngestionRunStatus, "running">,
): IngestionRunState {
  const now = new Date().toISOString()
  return {
    ...state,
    status,
    updatedAt: now,
    lastActivityAt: now,
  }
}

export async function writeIngestionState(state: IngestionRunState, config: Config): Promise<void> {
  await writePrivateJsonAtomic(
    path.join(config.storageDir, INGESTION_STATE_FILENAME),
    state,
    config.storageDir,
  )
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
    return isIngestionRunState(value, config) ? value : null
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
  const count = (fileState: IngestionFileStage): number =>
    state.files.filter((file) => file.state === fileState).length
  return {
    runId: state.runId,
    mode: state.mode,
    status: state.status,
    resumed: state.resumed,
    batchSize: state.batchSize,
    totalFiles: state.files.length,
    pendingFiles: count("pending"),
    parsedFiles: count("parsed"),
    embeddedFiles: count("embedded"),
    indexedFiles: count("indexed"),
    errorFiles: count("error"),
    staleFiles: state.files.filter((file) => file.staleLastKnownGood).length,
    chunksIndexed: state.files.reduce(
      (sum, file) =>
        sum +
        (file.staleLastKnownGood
          ? file.lastGoodChunkCount
          : file.state === "indexed"
            ? file.chunkCount
            : 0),
      0,
    ),
    lastActivityAt: state.lastActivityAt,
  }
}

function isIngestionRunState(value: unknown, config: Config): value is IngestionRunState {
  if (
    !isRecord(value) ||
    value.version !== INGESTION_STATE_VERSION ||
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
