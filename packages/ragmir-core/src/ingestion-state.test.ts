import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  createIngestionRunState,
  generationTableName,
  ingestionProgress,
  readIngestionState,
  removeStagedIndexManifest,
  updateIngestionFile,
  writeIngestionState,
} from "./ingestion-state.js"
import { testConfig } from "./test-support/config.js"
import type { Config, SourceFile } from "./types.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("ingestion state", () => {
  it.each([
    {
      condition: "runId contains a traversal payload",
      mutate: (state: ReturnType<typeof validIncrementalState>) => {
        state.runId = "../../outside"
      },
    },
    {
      condition: "tableName is not managed by the configured index",
      mutate: (state: ReturnType<typeof validIncrementalState>) => {
        state.tableName = "unrelated_table"
      },
    },
    {
      condition: "incremental mode claims a previous table",
      mutate: (state: ReturnType<typeof validIncrementalState>) => {
        state.previousTableName = state.tableName
      },
    },
    {
      condition: "batchSize is zero",
      mutate: (state: ReturnType<typeof validIncrementalState>) => {
        state.batchSize = 0
      },
    },
    {
      condition: "batchSize is fractional",
      mutate: (state: ReturnType<typeof validIncrementalState>) => {
        state.batchSize = 1.5
      },
    },
    {
      condition: "a persisted timestamp is invalid",
      mutate: (state: ReturnType<typeof validIncrementalState>) => {
        state.updatedAt = "not-a-date"
      },
    },
    {
      condition: "a file counter is negative",
      mutate: (state: ReturnType<typeof validIncrementalState>) => {
        const file = state.files[0]
        if (file) {
          file.chunkCount = -1
        }
      },
    },
    {
      condition: "a file claims stale rows without a last-good checksum",
      mutate: (state: ReturnType<typeof validIncrementalState>) => {
        const file = state.files[0]
        if (file) {
          file.staleLastKnownGood = true
        }
      },
    },
    {
      condition: "a file policy differs from the run policy",
      mutate: (state: ReturnType<typeof validIncrementalState>) => {
        const file = state.files[0]
        if (file) {
          file.policyFingerprint = "different-policy"
        }
      },
    },
    {
      condition: "file paths are duplicated",
      mutate: (state: ReturnType<typeof validIncrementalState>) => {
        const file = state.files[0]
        if (file) {
          state.files.push({ ...file })
        }
      },
    },
  ])("should reject persisted state when $condition", async ({ mutate }) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-state-invalid-"))
    tempDirs.push(root)
    const config = testConfig(root)
    const state = validIncrementalState(config)
    mutate(state)
    await writeRawState(config, state)

    await expect(readIngestionState(config)).resolves.toBeNull()
  })

  it("should accept a rebuild state when table generations match the run", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-state-rebuild-"))
    tempDirs.push(root)
    const config = testConfig(root)
    const state = createIngestionRunState({
      mode: "rebuild",
      tableName: config.tableName,
      previousTableName: config.tableName,
      policyFingerprint: "test-policy",
      batchSize: 25,
      files: [sourceFile(root)],
      reusablePaths: new Set(),
      reusableChunkCounts: new Map(),
    })
    state.tableName = generationTableName(config.tableName, state.runId)

    await writeIngestionState(state, config)

    await expect(readIngestionState(config)).resolves.toEqual(state)
  })

  it("should accept an incremental state when it writes to an active generation", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-state-generation-"))
    tempDirs.push(root)
    const config = testConfig(root)
    const state = validIncrementalState(config)
    state.tableName = generationTableName(config.tableName, "123e4567-e89b-42d3-a456-426614174000")

    await writeIngestionState(state, config)

    await expect(readIngestionState(config)).resolves.toEqual(state)
  })

  it("should accept legacy last-good manifest metadata without byte or mtime fields", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-state-last-good-"))
    tempDirs.push(root)
    const config = testConfig(root)
    const file = sourceFile(root)
    const state = createIngestionRunState({
      mode: "incremental",
      tableName: config.tableName,
      previousTableName: null,
      policyFingerprint: "test-policy",
      batchSize: 25,
      files: [{ ...file, checksum: "b".repeat(64) }],
      reusablePaths: new Set(),
      reusableChunkCounts: new Map(),
      previousFiles: new Map([
        [
          file.relativePath,
          { relativePath: file.relativePath, checksum: file.checksum, chunkCount: 1 },
        ],
      ]),
    })

    await writeIngestionState(state, config)

    await expect(readIngestionState(config)).resolves.toEqual(state)
  })

  it("should persist one file update as a bounded journal delta", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-state-journal-"))
    tempDirs.push(root)
    const config = testConfig(root)
    const files = Array.from({ length: 100 }, (_entry, index) => ({
      ...sourceFile(root),
      absolutePath: path.join(root, `.ragmir/raw/evidence-${index}.md`),
      relativePath: `.ragmir/raw/evidence-${index}.md`,
      checksum: index.toString(16).padStart(64, "0"),
    }))
    const state = createIngestionRunState({
      mode: "incremental",
      tableName: config.tableName,
      previousTableName: null,
      policyFingerprint: "test-policy",
      batchSize: 25,
      files,
      reusablePaths: new Set(),
      reusableChunkCounts: new Map(),
    })
    await writeIngestionState(state, config)
    const snapshotPath = path.join(config.storageDir, "ingestion-state.json")
    const snapshotBefore = await readFile(snapshotPath, "utf8")
    const snapshotHeader = JSON.parse(snapshotBefore) as {
      fileSnapshot?: string
      fileCount?: number
      files?: unknown
    }
    const filesReference = state.files

    expect(snapshotHeader.files).toBeUndefined()
    expect(snapshotHeader.fileCount).toBe(100)
    expect(snapshotHeader.fileSnapshot).toMatch(/^ingestion-state\.files\..+\.jsonl$/u)
    expect(Buffer.byteLength(snapshotBefore)).toBeLessThan(1_024)
    const fileSnapshotBefore = await readFile(
      path.join(config.storageDir, snapshotHeader.fileSnapshot ?? ""),
      "utf8",
    )
    expect(fileSnapshotBefore).toContain("evidence-99.md")

    updateIngestionFile(state, files[37]?.relativePath ?? "", {
      state: "indexed",
      chunkCount: 10,
      lastGoodChecksum: files[37]?.checksum ?? null,
      lastGoodChunkCount: 10,
      lastGoodBytes: files[37]?.bytes ?? null,
      lastGoodMtimeMs: files[37]?.mtimeMs ?? null,
      staleLastKnownGood: false,
    })
    await writeIngestionState(state, config)

    const snapshotAfter = await readFile(snapshotPath, "utf8")
    const journal = await readFile(
      path.join(config.storageDir, "ingestion-state.journal.jsonl"),
      "utf8",
    )
    expect(state.files).toBe(filesReference)
    expect(snapshotAfter).toBe(snapshotBefore)
    expect(Buffer.byteLength(journal)).toBeLessThan(Buffer.byteLength(fileSnapshotBefore) / 10)
    expect(journal).toContain("evidence-37.md")
    expect(journal).not.toContain("evidence-36.md")
    expect(ingestionProgress(state)).toMatchObject({
      indexedFiles: 1,
      pendingFiles: 99,
      chunksIndexed: 10,
    })
    await expect(readIngestionState(config)).resolves.toEqual(state)

    await appendFile(
      path.join(config.storageDir, "ingestion-state.journal.jsonl"),
      '{"version":1,"type":"file"',
      "utf8",
    )
    await expect(readIngestionState(config)).resolves.toEqual(state)
  })

  it("should preserve files outside storageDir when runId is malicious", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-state-path-"))
    tempDirs.push(root)
    const config = testConfig(root)
    const outsidePath = path.join(root, ".ragmir", "outside.staging.json")
    await mkdir(path.dirname(outsidePath), { recursive: true })
    await writeFile(outsidePath, "keep", "utf8")

    await expect(removeStagedIndexManifest("x/../../outside", config)).rejects.toThrow(
      "valid UUID v4",
    )
    await expect(readFile(outsidePath, "utf8")).resolves.toBe("keep")
  })
})

function validIncrementalState(config: Config) {
  return createIngestionRunState({
    mode: "incremental",
    tableName: config.tableName,
    previousTableName: null,
    policyFingerprint: "test-policy",
    batchSize: 25,
    files: [sourceFile(config.projectRoot)],
    reusablePaths: new Set(),
    reusableChunkCounts: new Map(),
  })
}

function sourceFile(root: string): SourceFile {
  return {
    absolutePath: path.join(root, ".ragmir", "raw", "evidence.md"),
    relativePath: ".ragmir/raw/evidence.md",
    source: "evidence.md",
    extension: ".md",
    bytes: 10,
    mtimeMs: 1,
    checksum: "a".repeat(64),
  }
}

async function writeRawState(config: Config, state: unknown): Promise<void> {
  await mkdir(config.storageDir, { recursive: true })
  await writeFile(
    path.join(config.storageDir, "ingestion-state.json"),
    JSON.stringify(state),
    "utf8",
  )
}
