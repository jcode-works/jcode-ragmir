import { randomUUID } from "node:crypto"
import { readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import type { Connection, OptimizeStats, Table } from "@lancedb/lancedb"
import * as lancedb from "@lancedb/lancedb"
import { loadConfig } from "./config.js"
import { isRecord } from "./guards.js"
import { withIndexWriteLock } from "./index-write-lock.js"
import { operationSignal } from "./operation.js"
import { ensurePrivateDirectory, hardenPrivateFile } from "./permissions.js"
import { activeIndexTableName, openRowsTableByName } from "./store.js"
import type { Config, OperationOptions } from "./types.js"
import { type AdaptiveIndexMaintenanceReport, maintainAdaptiveIndices } from "./vector-index.js"

const FULL_TEXT_INDEX_NAME = "searchText_idx"
const MAINTENANCE_STATE_FILENAME = "storage-maintenance.json"
const MAINTENANCE_STATE_SCHEMA_VERSION = 1
const MUTATION_COMPACTION_THRESHOLD = 20
const MINIMUM_AUTOMATIC_COMPACTION_ROWS = 100_000
const MINIMUM_FRAGMENT_COUNT = 8
const SMALL_FRAGMENT_RATIO_THRESHOLD = 0.25
const OLD_VERSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000

export type StorageMaintenanceAction =
  | "compact-fragments"
  | "prune-old-versions"
  | "refresh-full-text-index"

export type StorageMaintenanceReason =
  | "forced"
  | "fragmentation-threshold"
  | "missing-full-text-index"
  | "mutation-threshold"
  | "unindexed-full-text-rows"

export interface StorageMaintenanceOptions {
  additionalMutations?: number
  dryRun?: boolean
  force?: boolean
  vectorDimension?: number
}

export interface OptimizeStorageOptions extends OperationOptions {
  cwd?: string
  dryRun?: boolean
}

export interface StorageMaintenanceReport {
  schemaVersion: 1
  tableName: string
  status: "missing" | "healthy" | "needed" | "completed" | "warning"
  dryRun: boolean
  forced: boolean
  totalRows: number
  tableVersion: number | null
  mutationsSinceOptimization: number
  fragments: {
    total: number
    small: number
    smallRatio: number
  }
  fullTextIndex: {
    present: boolean
    indexedRows: number
    unindexedRows: number
    complete: boolean
  }
  adaptiveIndices: AdaptiveIndexMaintenanceReport | null
  reasons: StorageMaintenanceReason[]
  plannedActions: StorageMaintenanceAction[]
  completedActions: StorageMaintenanceAction[]
  optimizeStats: OptimizeStats | null
  warning: string | null
}

interface StorageMaintenanceState {
  schemaVersion: 1
  tableName: string
  mutationsSinceOptimization: number
  tableVersion: number
  updatedAt: string
  lastOptimizedAt?: string
  vectorIndexPolicySignature?: string
}

interface TableHealth {
  totalRows: number
  tableVersion: number
  fragments: StorageMaintenanceReport["fragments"]
  fullTextIndex: StorageMaintenanceReport["fullTextIndex"]
}

export async function optimizeStorage(
  options: OptimizeStorageOptions = {},
): Promise<StorageMaintenanceReport> {
  const config = await loadConfig(options.cwd ?? process.cwd())
  const signal = operationSignal(options)
  return withIndexWriteLock(config.storageDir, signal, async () => {
    const tableName = await activeIndexTableName(config)
    return maintainStorageTable(tableName, config, undefined, {
      ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
      force: true,
    })
  })
}

export async function maintainStorageTable(
  tableName: string,
  config: Config,
  connection?: Connection,
  options: StorageMaintenanceOptions = {},
): Promise<StorageMaintenanceReport> {
  try {
    const table = await openRowsTableByName(tableName, config, connection)
    if (!table) {
      return missingTableReport(tableName, options)
    }
    return maintainOpenStorageTable(table, tableName, config, options)
  } catch (error) {
    return warningReport(tableName, options, error)
  }
}

export async function maintainOpenStorageTable(
  table: Table,
  tableName: string,
  config: Config,
  options: StorageMaintenanceOptions = {},
): Promise<StorageMaintenanceReport> {
  const dryRun = options.dryRun === true
  const forced = options.force === true
  const previousState = await readMaintenanceState(config)
  const previousMutations =
    previousState?.tableName === tableName ? previousState.mutationsSinceOptimization : 0
  const mutationsSinceOptimization =
    previousMutations + Math.max(0, Math.floor(options.additionalMutations ?? 0))
  const before = await inspectTableHealth(table)
  const reasons = maintenanceReasons(before, mutationsSinceOptimization, forced)
  const plannedActions = maintenanceActions(before, mutationsSinceOptimization, forced)

  if (dryRun) {
    const adaptiveIndices = await maintainAdaptiveIndices(table, config, {
      dryRun: true,
      ...(previousState?.tableName === tableName && previousState.vectorIndexPolicySignature
        ? { previousPolicySignature: previousState.vectorIndexPolicySignature }
        : {}),
      ...(options.vectorDimension === undefined
        ? {}
        : { vectorDimension: options.vectorDimension }),
    })
    return reportForHealth({
      tableName,
      status:
        plannedActions.length > 0 || adaptiveIndices.plannedActions.length > 0
          ? "needed"
          : "healthy",
      dryRun,
      forced,
      health: before,
      mutationsSinceOptimization,
      reasons,
      plannedActions,
      completedActions: [],
      optimizeStats: null,
      adaptiveIndices,
      warning: null,
    })
  }

  const warnings: string[] = []
  const completedActions: StorageMaintenanceAction[] = []
  let optimizeStats: OptimizeStats | null = null
  let optimized = false

  if (plannedActions.includes("compact-fragments")) {
    try {
      optimizeStats = await table.optimize({
        cleanupOlderThan: new Date(Date.now() - OLD_VERSION_RETENTION_MS),
        deleteUnverified: false,
      })
      optimized = true
      completedActions.push("compact-fragments", "prune-old-versions")
    } catch (error) {
      warnings.push(
        `LanceDB compaction failed (${errorDetail(error)}). The validated index remains readable; retry \`rgr storage optimize\` later.`,
      )
    }
  }

  if (plannedActions.includes("refresh-full-text-index")) {
    try {
      await table.createIndex("searchText", {
        config: lancedb.Index.fts({ asciiFolding: true, lowercase: true, withPosition: true }),
        replace: true,
      })
      const coverage = await fullTextIndexCoverage(table, before.totalRows)
      if (!coverage.complete) {
        warnings.push(`Full-text index refresh left ${coverage.unindexedRows} unindexed row(s).`)
      } else {
        completedActions.push("refresh-full-text-index")
      }
    } catch (error) {
      warnings.push(
        `Full-text index refresh failed (${errorDetail(error)}). Bounded lexical scans remain available.`,
      )
    }
  }

  const adaptiveIndices = await maintainAdaptiveIndices(table, config, {
    ...(previousState?.tableName === tableName && previousState.vectorIndexPolicySignature
      ? { previousPolicySignature: previousState.vectorIndexPolicySignature }
      : {}),
    ...(options.vectorDimension === undefined ? {} : { vectorDimension: options.vectorDimension }),
  })

  const after = await inspectTableHealth(table)
  const remainingMutations = optimized ? 0 : mutationsSinceOptimization
  const vectorIndexPolicySignature =
    adaptiveIndices.vectorIndex.strategy === adaptiveIndices.desiredVectorStrategy
      ? adaptiveIndices.policySignature
      : previousState?.tableName === tableName
        ? previousState.vectorIndexPolicySignature
        : undefined
  try {
    await writeMaintenanceState(
      {
        schemaVersion: MAINTENANCE_STATE_SCHEMA_VERSION,
        tableName,
        mutationsSinceOptimization: remainingMutations,
        tableVersion: after.tableVersion,
        updatedAt: new Date().toISOString(),
        ...(vectorIndexPolicySignature ? { vectorIndexPolicySignature } : {}),
        ...(optimized ? { lastOptimizedAt: new Date().toISOString() } : {}),
      },
      config,
    )
  } catch (error) {
    warnings.push(`Storage maintenance state could not be saved (${errorDetail(error)}).`)
  }

  return reportForHealth({
    tableName,
    status:
      warnings.length > 0 || adaptiveIndices.warning
        ? "warning"
        : plannedActions.length > 0 || adaptiveIndices.completedActions.length > 0
          ? "completed"
          : "healthy",
    dryRun,
    forced,
    health: after,
    mutationsSinceOptimization: remainingMutations,
    reasons,
    plannedActions,
    completedActions,
    optimizeStats,
    adaptiveIndices,
    warning: warnings.length > 0 ? warnings.join(" ") : null,
  })
}

async function inspectTableHealth(table: Table): Promise<TableHealth> {
  const [stats, tableVersion] = await Promise.all([table.stats(), table.version()])
  return {
    totalRows: stats.numRows,
    tableVersion,
    fragments: {
      total: stats.fragmentStats.numFragments,
      small: stats.fragmentStats.numSmallFragments,
      smallRatio:
        stats.fragmentStats.numFragments === 0
          ? 0
          : stats.fragmentStats.numSmallFragments / stats.fragmentStats.numFragments,
    },
    fullTextIndex: await fullTextIndexCoverage(table, stats.numRows),
  }
}

async function fullTextIndexCoverage(
  table: Table,
  totalRows: number,
): Promise<StorageMaintenanceReport["fullTextIndex"]> {
  const index = (await table.listIndices()).find(
    (candidate) => candidate.name === FULL_TEXT_INDEX_NAME,
  )
  if (!index) {
    return {
      present: false,
      indexedRows: 0,
      unindexedRows: totalRows,
      complete: totalRows === 0,
    }
  }
  const stats = await table.indexStats(FULL_TEXT_INDEX_NAME)
  if (!stats) {
    return {
      present: false,
      indexedRows: 0,
      unindexedRows: totalRows,
      complete: totalRows === 0,
    }
  }
  return {
    present: true,
    indexedRows: stats.numIndexedRows,
    unindexedRows: stats.numUnindexedRows,
    complete: stats.numUnindexedRows === 0 && stats.numIndexedRows === totalRows,
  }
}

function maintenanceReasons(
  health: TableHealth,
  mutationsSinceOptimization: number,
  forced: boolean,
): StorageMaintenanceReason[] {
  const reasons: StorageMaintenanceReason[] = []
  const automaticCompactionEligible = health.totalRows >= MINIMUM_AUTOMATIC_COMPACTION_ROWS
  if (forced) {
    reasons.push("forced")
  }
  if (!health.fullTextIndex.present && health.totalRows > 0) {
    reasons.push("missing-full-text-index")
  } else if (health.fullTextIndex.unindexedRows > 0) {
    reasons.push("unindexed-full-text-rows")
  }
  if (automaticCompactionEligible && mutationsSinceOptimization >= MUTATION_COMPACTION_THRESHOLD) {
    reasons.push("mutation-threshold")
  }
  if (
    automaticCompactionEligible &&
    health.fragments.total >= MINIMUM_FRAGMENT_COUNT &&
    health.fragments.smallRatio >= SMALL_FRAGMENT_RATIO_THRESHOLD
  ) {
    reasons.push("fragmentation-threshold")
  }
  return reasons
}

function maintenanceActions(
  health: TableHealth,
  mutationsSinceOptimization: number,
  forced: boolean,
): StorageMaintenanceAction[] {
  const actions: StorageMaintenanceAction[] = []
  const automaticCompactionEligible = health.totalRows >= MINIMUM_AUTOMATIC_COMPACTION_ROWS
  const compact =
    forced ||
    (automaticCompactionEligible &&
      (mutationsSinceOptimization >= MUTATION_COMPACTION_THRESHOLD ||
        (health.fragments.total >= MINIMUM_FRAGMENT_COUNT &&
          health.fragments.smallRatio >= SMALL_FRAGMENT_RATIO_THRESHOLD)))
  if (compact) {
    actions.push("compact-fragments", "prune-old-versions")
  }
  if (!health.fullTextIndex.complete) {
    actions.push("refresh-full-text-index")
  }
  return actions
}

function reportForHealth(input: {
  tableName: string
  status: StorageMaintenanceReport["status"]
  dryRun: boolean
  forced: boolean
  health: TableHealth
  mutationsSinceOptimization: number
  reasons: StorageMaintenanceReason[]
  plannedActions: StorageMaintenanceAction[]
  completedActions: StorageMaintenanceAction[]
  optimizeStats: OptimizeStats | null
  adaptiveIndices: AdaptiveIndexMaintenanceReport | null
  warning: string | null
}): StorageMaintenanceReport {
  return {
    schemaVersion: MAINTENANCE_STATE_SCHEMA_VERSION,
    tableName: input.tableName,
    status: input.status,
    dryRun: input.dryRun,
    forced: input.forced,
    totalRows: input.health.totalRows,
    tableVersion: input.health.tableVersion,
    mutationsSinceOptimization: input.mutationsSinceOptimization,
    fragments: input.health.fragments,
    fullTextIndex: input.health.fullTextIndex,
    reasons: input.reasons,
    plannedActions: input.plannedActions,
    completedActions: input.completedActions,
    optimizeStats: input.optimizeStats,
    adaptiveIndices: input.adaptiveIndices,
    warning: input.warning,
  }
}

function missingTableReport(
  tableName: string,
  options: StorageMaintenanceOptions,
): StorageMaintenanceReport {
  return {
    schemaVersion: MAINTENANCE_STATE_SCHEMA_VERSION,
    tableName,
    status: "missing",
    dryRun: options.dryRun === true,
    forced: options.force === true,
    totalRows: 0,
    tableVersion: null,
    mutationsSinceOptimization: 0,
    fragments: { total: 0, small: 0, smallRatio: 0 },
    fullTextIndex: { present: false, indexedRows: 0, unindexedRows: 0, complete: false },
    adaptiveIndices: null,
    reasons: [],
    plannedActions: [],
    completedActions: [],
    optimizeStats: null,
    warning: null,
  }
}

function warningReport(
  tableName: string,
  options: StorageMaintenanceOptions,
  error: unknown,
): StorageMaintenanceReport {
  return {
    ...missingTableReport(tableName, options),
    status: "warning",
    warning: `Storage maintenance inspection failed (${errorDetail(error)}). The active index remains available.`,
  }
}

async function readMaintenanceState(config: Config): Promise<StorageMaintenanceState | null> {
  try {
    const value: unknown = JSON.parse(
      await readFile(path.join(config.storageDir, MAINTENANCE_STATE_FILENAME), "utf8"),
    )
    return isMaintenanceState(value) ? value : null
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null
    }
    if (error instanceof SyntaxError) {
      return null
    }
    throw error
  }
}

function isMaintenanceState(value: unknown): value is StorageMaintenanceState {
  return (
    isRecord(value) &&
    value.schemaVersion === MAINTENANCE_STATE_SCHEMA_VERSION &&
    typeof value.tableName === "string" &&
    typeof value.mutationsSinceOptimization === "number" &&
    Number.isInteger(value.mutationsSinceOptimization) &&
    value.mutationsSinceOptimization >= 0 &&
    typeof value.tableVersion === "number" &&
    Number.isInteger(value.tableVersion) &&
    typeof value.updatedAt === "string" &&
    (!("lastOptimizedAt" in value) || typeof value.lastOptimizedAt === "string") &&
    (!("vectorIndexPolicySignature" in value) ||
      typeof value.vectorIndexPolicySignature === "string")
  )
}

async function writeMaintenanceState(
  state: StorageMaintenanceState,
  config: Config,
): Promise<void> {
  await ensurePrivateDirectory(config.storageDir)
  const target = path.join(config.storageDir, MAINTENANCE_STATE_FILENAME)
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(state, null, 2), "utf8")
    await hardenPrivateFile(temporary)
    await rename(temporary, target)
  } finally {
    await rm(temporary, { force: true })
  }
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}
