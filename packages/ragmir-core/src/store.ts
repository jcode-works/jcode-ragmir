import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import * as lancedb from "@lancedb/lancedb"
import { isRecord } from "./guards.js"
import type { Config, IndexManifest, VectorRow } from "./types.js"

const EMPTY_TEXT_FILES_MANIFEST = "empty-text-files.json"
const INDEX_MANIFEST = "index-manifest.json"
/**
 * LanceDB requires a minimum number of rows to train an IVF_PQ vector index.
 * Below this threshold, brute-force (flat) scan is used instead, which is
 * optimal for small corpora and avoids wasted index-training work.
 */
const MIN_INDEX_ROWS = 256
/**
 * IVF partition count heuristic: roughly sqrt(row_count), bounded to keep both
 * small corpora (too many empty partitions) and very large corpora (training
 * cost) well-behaved. See LanceDB production guidance.
 */
const MIN_IVF_PARTITIONS = 8
const MAX_IVF_PARTITIONS = 1024

export interface EmptyTextFileRecord {
  relativePath: string
  checksum: string
}

export interface IndexWriteResult {
  vectorIndexWarning: string | null
}

export async function writeRows(rows: VectorRow[], config: Config): Promise<IndexWriteResult> {
  await mkdir(config.storageDir, { recursive: true })
  const db = await lancedb.connect(config.storageDir)

  if (rows.length === 0) {
    const tableNames = await db.tableNames()
    if (tableNames.includes(config.tableName)) {
      await db.dropTable(config.tableName)
    }
    await rm(path.join(config.storageDir, INDEX_MANIFEST), { force: true })
    return { vectorIndexWarning: null }
  }

  const records = rows.map((row) => ({ ...row }))
  const table = await db.createTable(config.tableName, records, {
    mode: "overwrite",
  })

  // Train an IVF_PQ vector index once the corpus is large enough to benefit
  // from approximate nearest-neighbour search. Below the threshold, LanceDB
  // falls back to an exact flat scan, which is faster for small corpora and
  // avoids wasting work training an index on too few vectors.
  if (rows.length < MIN_INDEX_ROWS) {
    return { vectorIndexWarning: null }
  }

  const result = await ensureVectorIndex(table, rows.length)
  return { vectorIndexWarning: result.warning }
}

interface EnsureVectorIndexResult {
  created: boolean
  warning: string | null
}

async function ensureVectorIndex(
  table: lancedb.Table,
  rowCount: number,
): Promise<EnsureVectorIndexResult> {
  const existing = await table.listIndices()
  const hasVectorIndex = existing.some((index) => index.name === "vector_idx")
  if (hasVectorIndex) {
    return { created: false, warning: null }
  }

  // numSubVectors must divide the vector dimension evenly. 16 is a safe default
  // for the 384-dim local-hash and mxbai-xsmall models; LanceDB validates and
  // will reject a value that does not divide evenly, so larger models still
  // fall back to flat scan rather than corrupting the index.
  const numSubVectors = 16
  const numPartitions = clampIvfPartitions(Math.round(Math.sqrt(rowCount)))
  try {
    await table.createIndex("vector", {
      config: lancedb.Index.ivfPq({ numPartitions, numSubVectors }),
    })
    return { created: true, warning: null }
  } catch (error) {
    // Index training can fail on edge-case dimensionality or tiny effective
    // corpora; the table remains usable via flat scan, but the operator
    // deserves to know queries will be slower than expected.
    const detail = error instanceof Error ? error.message : String(error)
    return {
      created: false,
      warning: `Vector index training failed (${detail}). Falling back to flat scan; queries will be slower on large corpora.`,
    }
  }
}

function clampIvfPartitions(value: number): number {
  return Math.min(MAX_IVF_PARTITIONS, Math.max(MIN_IVF_PARTITIONS, value))
}

export async function writeIndexManifest(manifest: IndexManifest, config: Config): Promise<void> {
  await mkdir(config.storageDir, { recursive: true })
  const manifestPath = path.join(config.storageDir, INDEX_MANIFEST)
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8")
}

export async function readIndexManifest(config: Config): Promise<IndexManifest | null> {
  try {
    const raw = JSON.parse(
      await readFile(path.join(config.storageDir, INDEX_MANIFEST), "utf8"),
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
    typeof value.chunkSize === "number" &&
    typeof value.chunkOverlap === "number" &&
    typeof value.fileCount === "number" &&
    typeof value.chunkCount === "number"
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

  await mkdir(config.storageDir, { recursive: true })
  const sortedRecords = [...records].sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  await writeFile(
    manifestPath,
    JSON.stringify({ version: 1, files: sortedRecords }, null, 2),
    "utf8",
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

export async function openRowsTable(config: Config): Promise<lancedb.Table | null> {
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
  return ((await table.query().toArray()) as StoredVectorRow[]).map((row) => ({
    ...row,
    vector: normalizeVector(row.vector),
  }))
}

export async function countRows(config: Config): Promise<number> {
  const table = await openRowsTable(config)
  return table ? table.countRows() : 0
}

interface StoredVectorRow extends Omit<VectorRow, "vector"> {
  vector: unknown
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
    isRecord(value) && typeof value.relativePath === "string" && typeof value.checksum === "string"
  )
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}
