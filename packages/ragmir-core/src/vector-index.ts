import { createHash } from "node:crypto"
import type { Table, VectorQuery } from "@lancedb/lancedb"
import * as lancedb from "@lancedb/lancedb"
import { VECTOR_DISTANCE_METRIC } from "./defaults.js"
import type {
  Config,
  VectorIndexManifest,
  VectorIndexParameters,
  VectorIndexStrategy,
} from "./types.js"

export const VECTOR_INDEX_NAME = "vector_idx"
export const RELATIVE_PATH_INDEX_NAME = "relativePath_idx"
export const ANN_MINIMUM_ROWS = 100_000
export const SCALAR_INDEX_MINIMUM_ROWS = 10_000
const VECTOR_INDEX_POLICY_VERSION = 1
const L_CORPUS_ROWS = 1_000_000

export type AdaptiveIndexAction =
  | "create-vector-index"
  | "drop-vector-index"
  | "refresh-vector-index"
  | "create-relative-path-index"
  | "drop-relative-path-index"
  | "refresh-relative-path-index"

export interface ScalarIndexStatus {
  indexName: string | null
  indexType: string | null
  present: boolean
  indexedRows: number
  unindexedRows: number
  coverage: number
}

export interface AdaptiveIndexMaintenanceReport {
  desiredVectorStrategy: "exact" | "ivf-pq"
  policySignature: string
  vectorIndex: VectorIndexManifest
  relativePathIndex: ScalarIndexStatus
  plannedActions: AdaptiveIndexAction[]
  completedActions: AdaptiveIndexAction[]
  warning: string | null
}

export interface AdaptiveIndexMaintenanceOptions {
  dryRun?: boolean
  annMinimumRows?: number
  scalarMinimumRows?: number
  vectorDimension?: number
  previousPolicySignature?: string
}

interface VectorIndexPolicy {
  strategy: "exact" | "ivf-pq"
  parameters: VectorIndexParameters
}

interface IndexSnapshot {
  name: string
  indexType: string
  indexedRows: number
  unindexedRows: number
}

export function adaptiveVectorIndexPolicy(
  rowCount: number,
  dimension: number,
  annMinimumRows = ANN_MINIMUM_ROWS,
): VectorIndexPolicy {
  if (rowCount < annMinimumRows || dimension <= 0) {
    return { strategy: "exact", parameters: {} }
  }
  const numPartitions = Math.max(16, Math.round(Math.sqrt(rowCount)))
  const largeCorpus = rowCount >= L_CORPUS_ROWS
  return {
    strategy: "ivf-pq",
    parameters: {
      numPartitions,
      numSubVectors: preferredSubVectors(dimension),
      nprobes: largeCorpus ? numPartitions : Math.min(numPartitions, 32),
      refineFactor: largeCorpus ? 100 : 10,
    },
  }
}

export function vectorModelFingerprint(config: Config, dimension: number): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        provider: config.embeddingProvider,
        model: config.embeddingModel,
        revision: config.embeddingModelRevision,
        dimension,
        metric: VECTOR_DISTANCE_METRIC,
      }),
    )
    .digest("hex")
}

export async function maintainAdaptiveIndices(
  table: Table,
  config: Config,
  options: AdaptiveIndexMaintenanceOptions = {},
): Promise<AdaptiveIndexMaintenanceReport> {
  const dryRun = options.dryRun === true
  const [tableStats, inferredDimension, indices] = await Promise.all([
    table.stats(),
    options.vectorDimension === undefined ? vectorDimension(table) : undefined,
    table.listIndices(),
  ])
  const dimension = options.vectorDimension ?? inferredDimension ?? 0
  const rowCount = tableStats.numRows
  const policy = adaptiveVectorIndexPolicy(
    rowCount,
    dimension,
    options.annMinimumRows ?? ANN_MINIMUM_ROWS,
  )
  const policySignature = vectorPolicySignature(policy, dimension)
  const scalarMinimumRows = options.scalarMinimumRows ?? SCALAR_INDEX_MINIMUM_ROWS
  const vectorBefore = await indexSnapshot(table, indices, "vector")
  const scalarBefore = await indexSnapshot(table, indices, "relativePath")
  const plannedActions = adaptiveIndexActions(
    policy,
    rowCount,
    scalarMinimumRows,
    vectorBefore,
    scalarBefore,
    options.previousPolicySignature !== policySignature,
  )
  const completedActions: AdaptiveIndexAction[] = []
  const warnings: string[] = []

  if (!dryRun) {
    for (const action of plannedActions) {
      try {
        await applyAdaptiveIndexAction(table, action, policy)
        completedActions.push(action)
      } catch (error) {
        warnings.push(`${adaptiveIndexActionLabel(action)} failed (${errorDetail(error)}).`)
      }
    }
  }

  const afterIndices = dryRun ? indices : await table.listIndices()
  const [vectorAfter, scalarAfter] = await Promise.all([
    indexSnapshot(table, afterIndices, "vector"),
    indexSnapshot(table, afterIndices, "relativePath"),
  ])
  const vectorAction = plannedActions.find(isVectorIndexAction)
  const vectorPolicyApplied = vectorAction === undefined || completedActions.includes(vectorAction)
  const vectorIndex = vectorManifest(
    config,
    rowCount,
    dimension,
    policy,
    vectorAfter,
    vectorPolicyApplied,
  )
  const relativePathIndex = scalarStatus(rowCount, scalarAfter)
  return {
    desiredVectorStrategy: policy.strategy,
    policySignature,
    vectorIndex,
    relativePathIndex,
    plannedActions,
    completedActions,
    warning: warnings.length > 0 ? warnings.join(" ") : null,
  }
}

export function configureAdaptiveVectorQuery(
  query: VectorQuery,
  vectorIndex: VectorIndexManifest,
  forceExact: boolean,
): VectorQuery {
  const metricQuery = query.distanceType(VECTOR_DISTANCE_METRIC)
  if (forceExact || vectorIndex.strategy === "exact" || vectorIndex.coverage < 1) {
    return metricQuery.bypassVectorIndex()
  }
  if (vectorIndex.strategy === "hnsw-sq") {
    return metricQuery.ef(vectorIndex.parameters.ef ?? 200)
  }
  return metricQuery
    .nprobes(vectorIndex.parameters.nprobes ?? 32)
    .refineFactor(vectorIndex.parameters.refineFactor ?? 10)
}

export function vectorIndexManifestCompatible(
  vectorIndex: VectorIndexManifest,
  config: Config,
  dimension: number,
): boolean {
  return (
    vectorIndex.policyVersion === VECTOR_INDEX_POLICY_VERSION &&
    vectorIndex.column === "vector" &&
    vectorIndex.distanceMetric === VECTOR_DISTANCE_METRIC &&
    vectorIndex.dimension === dimension &&
    vectorIndex.modelFingerprint === vectorModelFingerprint(config, dimension) &&
    vectorIndex.coverage === 1 &&
    vectorIndex.unindexedRows === 0
  )
}

function adaptiveIndexActions(
  policy: VectorIndexPolicy,
  rowCount: number,
  scalarMinimumRows: number,
  vector: IndexSnapshot | null,
  scalar: IndexSnapshot | null,
  vectorPolicyChanged: boolean,
): AdaptiveIndexAction[] {
  const actions: AdaptiveIndexAction[] = []
  if (policy.strategy === "exact") {
    if (vector) {
      actions.push("drop-vector-index")
    }
  } else if (vector?.indexType !== "IVF_PQ") {
    actions.push("create-vector-index")
  } else if (vectorPolicyChanged || vector.unindexedRows > 0 || vector.indexedRows !== rowCount) {
    actions.push("refresh-vector-index")
  }

  if (rowCount < scalarMinimumRows) {
    if (scalar) {
      actions.push("drop-relative-path-index")
    }
  } else if (scalar?.indexType !== "BTREE") {
    actions.push("create-relative-path-index")
  } else if (scalar.unindexedRows > 0 || scalar.indexedRows !== rowCount) {
    actions.push("refresh-relative-path-index")
  }
  return actions
}

async function applyAdaptiveIndexAction(
  table: Table,
  action: AdaptiveIndexAction,
  policy: VectorIndexPolicy,
): Promise<void> {
  if (action === "drop-vector-index") {
    await table.dropIndex(VECTOR_INDEX_NAME)
    return
  }
  if (action === "drop-relative-path-index") {
    await table.dropIndex(RELATIVE_PATH_INDEX_NAME)
    return
  }
  if (action === "create-relative-path-index" || action === "refresh-relative-path-index") {
    await table.createIndex("relativePath", { config: lancedb.Index.btree(), replace: true })
    return
  }
  if (policy.strategy !== "ivf-pq") {
    return
  }
  const { numPartitions, numSubVectors } = policy.parameters
  if (numPartitions === undefined || numSubVectors === undefined) {
    throw new Error("IVF-PQ policy is missing build parameters.")
  }
  await table.createIndex("vector", {
    config: lancedb.Index.ivfPq({
      distanceType: VECTOR_DISTANCE_METRIC,
      numPartitions,
      numSubVectors,
    }),
    replace: true,
  })
}

async function indexSnapshot(
  table: Table,
  indices: Awaited<ReturnType<Table["listIndices"]>>,
  column: string,
): Promise<IndexSnapshot | null> {
  const index = indices.find((candidate) => candidate.columns.includes(column))
  if (!index) {
    return null
  }
  const stats = await table.indexStats(index.name)
  return stats
    ? {
        name: index.name,
        indexType: stats.indexType,
        indexedRows: stats.numIndexedRows,
        unindexedRows: stats.numUnindexedRows,
      }
    : null
}

function vectorManifest(
  config: Config,
  rowCount: number,
  dimension: number,
  policy: VectorIndexPolicy,
  snapshot: IndexSnapshot | null,
  policyApplied: boolean,
): VectorIndexManifest {
  const complete =
    policyApplied &&
    policy.strategy === "ivf-pq" &&
    snapshot?.indexType === "IVF_PQ" &&
    snapshot.indexedRows === rowCount &&
    snapshot.unindexedRows === 0
  const strategy: VectorIndexStrategy = complete ? "ivf-pq" : "exact"
  return {
    policyVersion: VECTOR_INDEX_POLICY_VERSION,
    strategy,
    indexName: snapshot?.name ?? null,
    indexType: snapshot?.indexType ?? null,
    column: "vector",
    distanceMetric: VECTOR_DISTANCE_METRIC,
    dimension,
    modelFingerprint: vectorModelFingerprint(config, dimension),
    indexedRows: complete ? (snapshot?.indexedRows ?? 0) : rowCount,
    unindexedRows: complete ? (snapshot?.unindexedRows ?? rowCount) : 0,
    coverage: rowCount === 0 ? 1 : complete ? (snapshot?.indexedRows ?? 0) / rowCount : 1,
    parameters: complete ? policy.parameters : {},
  }
}

function vectorPolicySignature(policy: VectorIndexPolicy, dimension: number): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        policyVersion: VECTOR_INDEX_POLICY_VERSION,
        distanceMetric: VECTOR_DISTANCE_METRIC,
        dimension,
        strategy: policy.strategy,
        parameters: policy.parameters,
      }),
    )
    .digest("hex")
}

function isVectorIndexAction(action: AdaptiveIndexAction): boolean {
  return action.endsWith("vector-index")
}

function scalarStatus(rowCount: number, snapshot: IndexSnapshot | null): ScalarIndexStatus {
  const indexedRows = snapshot?.indexedRows ?? 0
  const unindexedRows = snapshot?.unindexedRows ?? rowCount
  return {
    indexName: snapshot?.name ?? null,
    indexType: snapshot?.indexType ?? null,
    present: snapshot !== null,
    indexedRows,
    unindexedRows,
    coverage: rowCount === 0 ? 1 : indexedRows / rowCount,
  }
}

async function vectorDimension(table: Table): Promise<number> {
  const [row] = (await table.query().select(["vector"]).limit(1).toArray()) as Array<{
    vector?: unknown
  }>
  const vector = row?.vector
  return vector &&
    typeof vector === "object" &&
    "length" in vector &&
    typeof vector.length === "number"
    ? vector.length
    : 0
}

function preferredSubVectors(dimension: number): number {
  if (dimension % 16 === 0) {
    return dimension / 16
  }
  if (dimension % 8 === 0) {
    return dimension / 8
  }
  return 1
}

function adaptiveIndexActionLabel(action: AdaptiveIndexAction): string {
  return action.replaceAll("-", " ")
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
