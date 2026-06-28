import { mkdir } from "node:fs/promises"
import * as lancedb from "@lancedb/lancedb"
import type { Config, VectorRow } from "./types.js"

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

export async function openRowsTable(config: Config): Promise<lancedb.Table | null> {
  const db = await lancedb.connect(config.storageDir)
  const tableNames = await db.tableNames()
  if (!tableNames.includes(config.tableName)) {
    return null
  }
  return db.openTable(config.tableName)
}

export async function countRows(config: Config): Promise<number> {
  const table = await openRowsTable(config)
  return table ? table.countRows() : 0
}
