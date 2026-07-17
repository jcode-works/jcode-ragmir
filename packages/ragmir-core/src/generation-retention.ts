import { randomUUID } from "node:crypto"
import { readdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import type { Connection } from "@lancedb/lancedb"
import { loadConfig } from "./config.js"
import { isRecord } from "./guards.js"
import { withIndexWriteLock } from "./index-write-lock.js"
import type { IngestionRunState } from "./ingestion-state.js"
import { readIngestionState } from "./ingestion-state.js"
import { operationSignal } from "./operation.js"
import { ensurePrivateDirectory } from "./permissions.js"
import { activeIndexTableName, connectStore } from "./store.js"
import type { Config, OperationOptions } from "./types.js"

const GENERATION_LEASE_DIRECTORY = "generation-leases"
const GENERATION_LEASE_SCHEMA_VERSION = 1
const GENERATION_LEASE_DURATION_MS = 24 * 60 * 60 * 1_000
const GENERATION_ID_PATTERN = /^[0-9a-f]{32}$/iu
const MAX_RETAINED_GENERATIONS = 3
const MAX_GENERATION_AGE_MS = 7 * 24 * 60 * 60 * 1_000
const READER_GRACE_PERIOD_MS = 5 * 60 * 1_000
const activeInProcessLeases = new Map<string, number>()

export type GenerationRole =
  | "active"
  | "resumable"
  | "rollback"
  | "leased"
  | "retained"
  | "orphaned"

export interface CollectGenerationGarbageOptions extends OperationOptions {
  cwd?: string
  dryRun?: boolean
}

export interface GenerationInventoryItem {
  tableName: string
  role: GenerationRole
  reason:
    | "active-manifest"
    | "resumable-ingestion"
    | "rollback-generation"
    | "active-reader-lease"
    | "reader-grace-period"
    | "retention-count"
    | "retention-age"
    | "retention-limit"
  bytes: number
  tableVersion: number
  lastModifiedAt: string
  ageMs: number
  leased: boolean
  reclaimable: boolean
  deleted: boolean
}

export interface GenerationGarbageCollectionReport {
  schemaVersion: 1
  dryRun: boolean
  policy: {
    maxRetainedGenerations: number
    maxGenerationAgeMs: number
    readerGracePeriodMs: number
  }
  activeTableName: string
  resumableTableName: string | null
  rollbackTableName: string | null
  generations: GenerationInventoryItem[]
  reclaimableBytes: number
  reclaimedBytes: number
  deletedTables: string[]
  warning: string | null
}

export interface GenerationReadLease {
  tableName: string
  release: () => Promise<void>
}

interface GenerationLeaseRecord {
  schemaVersion: 1
  token: string
  pid: number
  tableName: string
  createdAt: string
  expiresAt: string
}

interface GenerationCandidate {
  tableName: string
  bytes: number
  tableVersion: number
  lastModifiedAt: string
  ageMs: number
}

interface CollectUnlockedOptions {
  dryRun?: boolean
  now?: Date
  state?: IngestionRunState | null
}

export async function collectGenerationGarbage(
  options: CollectGenerationGarbageOptions = {},
): Promise<GenerationGarbageCollectionReport> {
  const config = await loadConfig(options.cwd ?? process.cwd())
  const signal = operationSignal(options)
  return withIndexWriteLock(config.storageDir, signal, () =>
    collectGenerationGarbageUnlocked(config, undefined, {
      ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
    }),
  )
}

export async function collectGenerationGarbageUnlocked(
  config: Config,
  connection?: Connection,
  options: CollectUnlockedOptions = {},
): Promise<GenerationGarbageCollectionReport> {
  const activeConnection = connection ?? (await connectStore(config))
  try {
    return await collectWithConnection(config, activeConnection, options)
  } finally {
    if (!connection) {
      activeConnection.close()
    }
  }
}

export async function acquireGenerationReadLease(
  tableName: string,
  config: Config,
): Promise<GenerationReadLease> {
  const directory = path.join(config.storageDir, GENERATION_LEASE_DIRECTORY)
  const token = randomUUID()
  const leasePath = path.join(directory, `${token}.json`)
  const now = Date.now()
  const lease: GenerationLeaseRecord = {
    schemaVersion: GENERATION_LEASE_SCHEMA_VERSION,
    token,
    pid: process.pid,
    tableName,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + GENERATION_LEASE_DURATION_MS).toISOString(),
  }
  incrementInProcessLease(tableName)
  let persisted = false
  try {
    await ensurePrivateDirectory(directory)
    await writeFile(leasePath, JSON.stringify(lease), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    })
    persisted = true
  } catch {
    // Same-process collection still observes the in-memory lease. A read-only index remains usable.
  }
  let released = false
  return {
    tableName,
    release: async () => {
      if (released) {
        return
      }
      released = true
      decrementInProcessLease(tableName)
      if (persisted) {
        await rm(leasePath, { force: true })
      }
    },
  }
}

export async function withActiveGenerationReadLease<T>(
  config: Config,
  operation: (tableName: string) => Promise<T>,
): Promise<T> {
  while (true) {
    const tableName = await activeIndexTableName(config)
    const lease = await acquireGenerationReadLease(tableName, config)
    const confirmedTableName = await activeIndexTableName(config)
    if (confirmedTableName !== tableName) {
      await lease.release().catch(() => undefined)
      continue
    }
    try {
      return await operation(tableName)
    } finally {
      await lease.release().catch(() => undefined)
    }
  }
}

async function collectWithConnection(
  config: Config,
  connection: Connection,
  options: CollectUnlockedOptions,
): Promise<GenerationGarbageCollectionReport> {
  const now = options.now ?? new Date()
  const nowMs = now.getTime()
  const activeTableName = await activeIndexTableName(config)
  const state = options.state === undefined ? await readIngestionState(config) : options.state
  const resumableTableName = resumableGeneration(state, activeTableName)
  const rollbackTableName = rollbackGeneration(state, activeTableName)
  const leaseNames = await activeLeaseTableNames(config, nowMs)
  const warnings: string[] = []
  const candidates: GenerationCandidate[] = []
  const tableNames = (await connection.tableNames()).filter((tableName) =>
    isManagedTableName(tableName, config),
  )

  for (const tableName of tableNames) {
    try {
      const table = await connection.openTable(tableName)
      const [stats, tableVersion, versions] = await Promise.all([
        table.stats(),
        table.version(),
        table.listVersions(),
      ])
      const latestTimestamp = versions.reduce(
        (latest, version) => Math.max(latest, version.timestamp.getTime()),
        0,
      )
      const lastModifiedMs = latestTimestamp > 0 ? latestTimestamp : nowMs
      candidates.push({
        tableName,
        bytes: stats.totalBytes,
        tableVersion,
        lastModifiedAt: new Date(lastModifiedMs).toISOString(),
        ageMs: Math.max(0, nowMs - lastModifiedMs),
      })
    } catch (error) {
      warnings.push(`Could not inspect generation "${tableName}" (${errorDetail(error)}).`)
    }
  }

  const cleanupSafe =
    candidates.length === 0 ||
    candidates.some((candidate) => candidate.tableName === activeTableName)
  if (!cleanupSafe) {
    warnings.push(
      `Active generation "${activeTableName}" is missing. Generation cleanup was skipped.`,
    )
  }

  const protectedNames = new Set(
    [activeTableName, resumableTableName, rollbackTableName, ...leaseNames].filter(isString),
  )
  const retainedSlots = Math.max(0, MAX_RETAINED_GENERATIONS - protectedNames.size)
  let retainedCount = 0
  const generations = candidates
    .sort((left, right) => right.lastModifiedAt.localeCompare(left.lastModifiedAt))
    .map<GenerationInventoryItem>((candidate) => {
      const leased = leaseNames.has(candidate.tableName)
      if (candidate.tableName === activeTableName) {
        return inventoryItem(candidate, "active", "active-manifest", leased)
      }
      if (candidate.tableName === resumableTableName) {
        return inventoryItem(candidate, "resumable", "resumable-ingestion", leased)
      }
      if (candidate.tableName === rollbackTableName) {
        return inventoryItem(candidate, "rollback", "rollback-generation", leased)
      }
      if (leased) {
        return inventoryItem(candidate, "leased", "active-reader-lease", true)
      }
      if (!cleanupSafe) {
        return inventoryItem(candidate, "retained", "retention-count", false)
      }
      if (candidate.ageMs < READER_GRACE_PERIOD_MS) {
        return inventoryItem(candidate, "retained", "reader-grace-period", false)
      }
      if (candidate.ageMs <= MAX_GENERATION_AGE_MS && retainedCount < retainedSlots) {
        retainedCount += 1
        return inventoryItem(candidate, "retained", "retention-count", false)
      }
      return inventoryItem(
        candidate,
        "orphaned",
        candidate.ageMs > MAX_GENERATION_AGE_MS ? "retention-age" : "retention-limit",
        false,
      )
    })

  const reclaimableBytes = generations
    .filter((generation) => generation.reclaimable)
    .reduce((sum, generation) => sum + generation.bytes, 0)
  const deletedTables: string[] = []
  let reclaimedBytes = 0
  if (options.dryRun !== true) {
    const currentLeases = await activeLeaseTableNames(config, nowMs)
    for (const generation of generations) {
      if (!generation.reclaimable || currentLeases.has(generation.tableName)) {
        continue
      }
      try {
        await connection.dropTable(generation.tableName)
        generation.deleted = true
        deletedTables.push(generation.tableName)
        reclaimedBytes += generation.bytes
      } catch (error) {
        warnings.push(
          `Could not delete generation "${generation.tableName}" (${errorDetail(error)}).`,
        )
      }
    }
  }

  return {
    schemaVersion: 1,
    dryRun: options.dryRun === true,
    policy: {
      maxRetainedGenerations: MAX_RETAINED_GENERATIONS,
      maxGenerationAgeMs: MAX_GENERATION_AGE_MS,
      readerGracePeriodMs: READER_GRACE_PERIOD_MS,
    },
    activeTableName,
    resumableTableName,
    rollbackTableName,
    generations,
    reclaimableBytes,
    reclaimedBytes,
    deletedTables,
    warning: warnings.length > 0 ? warnings.join(" ") : null,
  }
}

function inventoryItem(
  candidate: GenerationCandidate,
  role: GenerationRole,
  reason: GenerationInventoryItem["reason"],
  leased: boolean,
): GenerationInventoryItem {
  return {
    ...candidate,
    role,
    reason,
    leased,
    reclaimable: role === "orphaned",
    deleted: false,
  }
}

async function activeLeaseTableNames(config: Config, nowMs: number): Promise<Set<string>> {
  const directory = path.join(config.storageDir, GENERATION_LEASE_DIRECTORY)
  const tableNames = new Set(activeInProcessLeases.keys())
  let entries: string[]
  try {
    entries = await readdir(directory)
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return tableNames
    }
    throw error
  }

  for (const entry of entries) {
    if (!entry.endsWith(".json")) {
      continue
    }
    const leasePath = path.join(directory, entry)
    try {
      const value: unknown = JSON.parse(await readFile(leasePath, "utf8"))
      if (!isGenerationLease(value) || !activeLease(value, nowMs)) {
        await rm(leasePath, { force: true })
        continue
      }
      tableNames.add(value.tableName)
    } catch {
      await rm(leasePath, { force: true })
    }
  }
  return tableNames
}

function incrementInProcessLease(tableName: string): void {
  activeInProcessLeases.set(tableName, (activeInProcessLeases.get(tableName) ?? 0) + 1)
}

function decrementInProcessLease(tableName: string): void {
  const remaining = (activeInProcessLeases.get(tableName) ?? 1) - 1
  if (remaining > 0) {
    activeInProcessLeases.set(tableName, remaining)
  } else {
    activeInProcessLeases.delete(tableName)
  }
}

function activeLease(lease: GenerationLeaseRecord, nowMs: number): boolean {
  return Date.parse(lease.expiresAt) > nowMs && processIsAlive(lease.pid)
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return isNodeError(error) && error.code === "EPERM"
  }
}

function isGenerationLease(value: unknown): value is GenerationLeaseRecord {
  return (
    isRecord(value) &&
    value.schemaVersion === GENERATION_LEASE_SCHEMA_VERSION &&
    typeof value.token === "string" &&
    typeof value.pid === "number" &&
    Number.isInteger(value.pid) &&
    value.pid > 0 &&
    typeof value.tableName === "string" &&
    typeof value.createdAt === "string" &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    typeof value.expiresAt === "string" &&
    Number.isFinite(Date.parse(value.expiresAt))
  )
}

function resumableGeneration(
  state: IngestionRunState | null,
  activeTableName: string,
): string | null {
  if (
    state?.mode !== "rebuild" ||
    state.tableName === activeTableName ||
    state.status === "completed" ||
    state.status === "completed_with_errors"
  ) {
    return null
  }
  return state.tableName
}

function rollbackGeneration(
  state: IngestionRunState | null,
  activeTableName: string,
): string | null {
  if (
    state?.mode !== "rebuild" ||
    state.tableName !== activeTableName ||
    state.previousTableName === null ||
    state.previousTableName === activeTableName
  ) {
    return null
  }
  return state.previousTableName
}

function isManagedTableName(tableName: string, config: Config): boolean {
  if (tableName === config.tableName) {
    return true
  }
  const prefix = `${config.tableName}__generation_`
  return tableName.startsWith(prefix) && GENERATION_ID_PATTERN.test(tableName.slice(prefix.length))
}

function isString(value: string | null): value is string {
  return typeof value === "string"
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}
