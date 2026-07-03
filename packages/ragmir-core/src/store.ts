import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import * as lancedb from "@lancedb/lancedb"
import { isRecord } from "./guards.js"
import type { Config, VectorRow } from "./types.js"

const EMPTY_TEXT_FILES_MANIFEST = "empty-text-files.json"

export interface EmptyTextFileRecord {
  relativePath: string
  checksum: string
}

export async function writeRows(rows: VectorRow[], config: Config): Promise<void> {
  await mkdir(config.storageDir, { recursive: true })
  const db = await lancedb.connect(config.storageDir)

  if (rows.length === 0) {
    const tableNames = await db.tableNames()
    if (tableNames.includes(config.tableName)) {
      await db.dropTable(config.tableName)
    }
    return
  }

  const records = rows.map((row) => ({ ...row }))
  await db.createTable(config.tableName, records, {
    mode: "overwrite",
  })
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
