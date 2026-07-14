import { randomUUID } from "node:crypto"
import { readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { isRecord } from "./guards.js"
import { ensurePrivateDirectory, hardenPrivateFile } from "./permissions.js"
import type {
  Config,
  IndexManifest,
  IngestionFileStage,
  IngestionProgress,
  IngestionRunMode,
  IngestionRunStatus,
  SourceFile,
} from "./types.js"

const INGESTION_STATE_VERSION = 1
const INGESTION_STATE_FILENAME = "ingestion-state.json"

export interface IngestionFileState {
  relativePath: string
  checksum: string
  bytes: number
  mtimeMs: number
  policyFingerprint: string
  state: IngestionFileStage
  chunkCount: number
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
      return {
        relativePath: file.relativePath,
        checksum: file.checksum,
        bytes: file.bytes,
        mtimeMs: file.mtimeMs,
        policyFingerprint: options.policyFingerprint,
        state: reused ? "indexed" : "pending",
        chunkCount: options.reusableChunkCounts.get(file.relativePath) ?? 0,
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
        : { ...file, state: "pending", chunkCount: 0, error: null, updatedAt: now },
    ),
  }
}

export function updateIngestionFile(
  state: IngestionRunState,
  relativePath: string,
  update: Partial<
    Pick<IngestionFileState, "state" | "chunkCount" | "redactions" | "error" | "reused">
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
    return isIngestionRunState(value) ? value : null
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
    chunksIndexed: state.files
      .filter((file) => file.state === "indexed")
      .reduce((sum, file) => sum + file.chunkCount, 0),
    lastActivityAt: state.lastActivityAt,
  }
}

function isIngestionRunState(value: unknown): value is IngestionRunState {
  return (
    isRecord(value) &&
    value.version === INGESTION_STATE_VERSION &&
    typeof value.runId === "string" &&
    (value.mode === "incremental" || value.mode === "rebuild") &&
    isIngestionRunStatus(value.status) &&
    typeof value.tableName === "string" &&
    (value.previousTableName === null || typeof value.previousTableName === "string") &&
    typeof value.policyFingerprint === "string" &&
    typeof value.batchSize === "number" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    typeof value.lastActivityAt === "string" &&
    typeof value.resumed === "boolean" &&
    Array.isArray(value.files) &&
    value.files.every(isIngestionFileState)
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
  return path.join(config.storageDir, `index-manifest.${runId}.staging.json`)
}

function isIngestionFileState(value: unknown): value is IngestionFileState {
  return (
    isRecord(value) &&
    typeof value.relativePath === "string" &&
    typeof value.checksum === "string" &&
    typeof value.bytes === "number" &&
    typeof value.mtimeMs === "number" &&
    typeof value.policyFingerprint === "string" &&
    isIngestionFileStage(value.state) &&
    typeof value.chunkCount === "number" &&
    typeof value.redactions === "number" &&
    (value.error === null || typeof value.error === "string") &&
    typeof value.reused === "boolean" &&
    typeof value.updatedAt === "string"
  )
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
