import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { loadConfig } from "./config.js"
import {
  collectGenerationGarbageUnlocked,
  withActiveGenerationReadLease,
} from "./generation-retention.js"
import { ingest } from "./ingest.js"
import type { IngestionRunState } from "./ingestion-state.js"
import { generationTableName } from "./ingestion-state.js"
import { initProject } from "./init.js"
import { connectStore, writeIndexManifest, writeRowsToTable } from "./store.js"
import { testConfig } from "./test-support/config.js"
import type { Config } from "./types.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const directory of tempDirs.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

describe("generation retention", () => {
  it("should converge after ten real rebuilds using persisted generation roles", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-generation-rebuilds-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    const sourcePath = path.join(root, ".ragmir", "raw", "evidence.md")
    await writeFile(sourcePath, "generation zero evidence\n")
    await ingest({ cwd: root })
    for (let generation = 1; generation <= 10; generation += 1) {
      await writeFile(sourcePath, `generation ${generation} evidence\n`)
      await ingest({ cwd: root, rebuild: true })
    }

    const config = await loadConfig(root)
    const connection = await connectStore(config)
    try {
      const before = await connection.tableNames()
      expect(before).toHaveLength(11)

      const report = await collectGenerationGarbageUnlocked(config, connection, {
        now: new Date(Date.now() + 10 * 60 * 1_000),
      })

      expect(report.activeTableName).toMatch(/__generation_[0-9a-f]{32}$/u)
      expect(report.rollbackTableName).toMatch(/__generation_[0-9a-f]{32}$/u)
      expect(report.deletedTables).toHaveLength(8)
      expect(await connection.tableNames()).toHaveLength(3)
    } finally {
      connection.close()
    }
  })

  it("should bound ten rebuild generations after the reader grace period", async () => {
    const { config, tableNames, activeState } = await generationFixture(10)
    const connection = await connectStore(config)
    try {
      const future = new Date(Date.now() + 10 * 60 * 1_000)
      const dryRun = await collectGenerationGarbageUnlocked(config, connection, {
        dryRun: true,
        now: future,
        state: activeState,
      })
      expect(
        dryRun.generations.filter((generation) => generation.role === "orphaned"),
      ).toHaveLength(7)
      expect(dryRun.reclaimableBytes).toBeGreaterThan(0)

      const collected = await collectGenerationGarbageUnlocked(config, connection, {
        now: future,
        state: activeState,
      })

      expect(collected.deletedTables).toHaveLength(7)
      expect(collected.reclaimedBytes).toBe(collected.reclaimableBytes)
      expect(
        (await connection.tableNames()).filter((name) => tableNames.includes(name)),
      ).toHaveLength(3)
    } finally {
      connection.close()
    }
  })

  it("should preserve a leased reader while reclaiming other orphaned generations", async () => {
    const { config, tableNames, activeState } = await generationFixture(10)
    const connection = await connectStore(config)
    const leasedTableName = tableNames[0]
    if (!leasedTableName) {
      throw new Error("Expected a generation to lease.")
    }
    try {
      await writeIndexManifest(manifestFor(config, leasedTableName), config)
      await withActiveGenerationReadLease(config, async (tableName) => {
        const leasedTable = await connection.openTable(tableName)
        await writeIndexManifest(manifestFor(config, activeState.tableName), config)
        const report = await collectGenerationGarbageUnlocked(config, connection, {
          now: new Date(Date.now() + 10 * 60 * 1_000),
          state: activeState,
        })

        expect(report.generations.find((item) => item.tableName === leasedTableName)).toEqual(
          expect.objectContaining({ role: "leased", leased: true, deleted: false }),
        )
        expect(report.deletedTables).not.toContain(leasedTableName)
        await expect(leasedTable.countRows()).resolves.toBe(1)
      })
    } finally {
      connection.close()
    }
  })

  it("should preserve an interrupted rebuild generation as resumable", async () => {
    const { config, tableNames } = await generationFixture(5)
    const activeTableName = tableNames[4]
    const resumableTableName = tableNames[0]
    if (!activeTableName || !resumableTableName) {
      throw new Error("Expected active and resumable generations.")
    }
    await writeIndexManifest(manifestFor(config, activeTableName), config)
    const interruptedState = ingestionState({
      tableName: resumableTableName,
      previousTableName: activeTableName,
      status: "interrupted",
    })
    const connection = await connectStore(config)
    try {
      const report = await collectGenerationGarbageUnlocked(config, connection, {
        now: new Date(Date.now() + 10 * 60 * 1_000),
        state: interruptedState,
      })

      expect(report.resumableTableName).toBe(resumableTableName)
      expect(report.generations.find((item) => item.tableName === resumableTableName)).toEqual(
        expect.objectContaining({ role: "resumable", deleted: false }),
      )
      expect(await connection.tableNames()).toContain(resumableTableName)
    } finally {
      connection.close()
    }
  })

  it("should skip cleanup when the active manifest table is missing", async () => {
    const { config, tableNames } = await generationFixture(5)
    const missingActive = generationTableName(
      config.tableName,
      "00000000-0000-4000-8000-999999999998",
    )
    await writeIndexManifest(manifestFor(config, missingActive), config)
    const connection = await connectStore(config)
    try {
      const report = await collectGenerationGarbageUnlocked(config, connection, {
        now: new Date(Date.now() + 10 * 60 * 1_000),
        state: null,
      })

      expect(report.warning).toContain("is missing")
      expect(report.deletedTables).toEqual([])
      expect(
        (await connection.tableNames()).filter((name) => tableNames.includes(name)),
      ).toHaveLength(5)
    } finally {
      connection.close()
    }
  })
})

async function generationFixture(count: number): Promise<{
  config: Config
  tableNames: string[]
  activeState: IngestionRunState
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-generation-retention-"))
  tempDirs.push(root)
  const config = testConfig(root)
  const tableNames: string[] = []
  for (let index = 0; index < count; index += 1) {
    const runId = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`
    const tableName = generationTableName(config.tableName, runId)
    tableNames.push(tableName)
    await writeRowsToTable([rowFor(config, tableName, index)], tableName, config)
  }
  const activeTableName = tableNames.at(-1)
  const rollbackTableName = tableNames.at(-2)
  if (!activeTableName || !rollbackTableName) {
    throw new Error("Generation fixture requires at least two tables.")
  }
  await writeIndexManifest(manifestFor(config, activeTableName), config)
  return {
    config,
    tableNames,
    activeState: ingestionState({
      tableName: activeTableName,
      previousTableName: rollbackTableName,
      status: "completed",
    }),
  }
}

function ingestionState(input: {
  tableName: string
  previousTableName: string
  status: IngestionRunState["status"]
}): IngestionRunState {
  const now = new Date().toISOString()
  return {
    version: 3,
    runId: "00000000-0000-4000-8000-999999999999",
    mode: "rebuild",
    status: input.status,
    tableName: input.tableName,
    previousTableName: input.previousTableName,
    policyFingerprint: "test-policy",
    batchSize: 1,
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
    resumed: false,
    files: [],
  }
}

function manifestFor(config: Config, tableName: string) {
  return {
    schemaVersion: 8,
    createdAt: new Date().toISOString(),
    ragmirVersion: "test",
    embeddingProvider: config.embeddingProvider,
    embeddingModel: config.embeddingModel,
    chunkSize: config.chunkSize,
    chunkOverlap: config.chunkOverlap,
    fileCount: 1,
    chunkCount: 1,
    tableName,
  }
}

function rowFor(config: Config, tableName: string, index: number) {
  const relativePath = `.ragmir/raw/generation-${index}.md`
  return {
    id: `${relativePath}#0`,
    source: path.basename(relativePath),
    relativePath,
    chunkIndex: 0,
    contextPath: "Evidence",
    searchText: `Evidence\ngeneration ${index}`,
    text: `generation ${index}`,
    charStart: 0,
    charEnd: 12,
    lineStart: 1,
    lineEnd: 1,
    checksum: tableName,
    bytes: 12,
    mtimeMs: index + 1,
    vector: [0.1, 0.2],
    embeddingProvider: config.embeddingProvider,
    embeddingModel: config.embeddingModel,
  }
}
