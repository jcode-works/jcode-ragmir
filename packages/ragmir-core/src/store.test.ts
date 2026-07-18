import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { INDEX_MANIFEST_FILENAME } from "./defaults.js"
import { type DurableWritePhase, withDurableWriteFaultForTests } from "./durable-file.js"
import { maintainOpenStorageTable } from "./storage-maintenance.js"
import {
  closeIndexReadSnapshot,
  countRows,
  indexManifestRecoveryDiagnostic,
  loadIndexReadSnapshot,
  openRowsTable,
  readEmptyTextFiles,
  readIndexManifest,
  readIndexManifestFilePage,
  readRows,
  updateRowsInTable,
  writeEmptyTextFiles,
  writeIndexManifest,
  writeRows,
  writeRowsToTable,
} from "./store.js"
import { testConfig } from "./test-support/config.js"
import type { IndexManifest } from "./types.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

function sampleRow(
  relativePath: string,
  chunkIndex: number,
  vector: number[],
  config: ReturnType<typeof testConfig>,
) {
  return {
    id: `${relativePath}#${chunkIndex}`,
    source: path.basename(relativePath),
    relativePath,
    chunkIndex,
    contextPath: "Evidence",
    searchText: `Evidence\ncontent ${chunkIndex}`,
    text: `content ${chunkIndex}`,
    charStart: chunkIndex * 10,
    charEnd: chunkIndex * 10 + 9,
    lineStart: chunkIndex + 1,
    lineEnd: chunkIndex + 1,
    checksum: `checksum-${chunkIndex}`,
    bytes: 10,
    mtimeMs: 1,
    vector,
    embeddingProvider: config.embeddingProvider,
    embeddingModel: config.embeddingModel,
  }
}

async function fullTextEvidence(table: NonNullable<Awaited<ReturnType<typeof openRowsTable>>>) {
  const rows = await table
    .search("maintenance baseline", "fts", "searchText")
    .select(["relativePath", "lineStart", "lineEnd", "_score"])
    .limit(5)
    .toArray()
  return rows.flatMap((row) => {
    if (
      typeof row.relativePath !== "string" ||
      typeof row.lineStart !== "number" ||
      typeof row.lineEnd !== "number"
    ) {
      return []
    }
    return [`${row.relativePath}:${row.lineStart}-${row.lineEnd}`]
  })
}

describe("store", () => {
  it("round-trips vector rows from LanceDB as plain numeric arrays", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-store-"))
    tempDirs.push(root)
    const config = testConfig(root)

    await writeRows(
      [
        {
          ...sampleRow(".ragmir/raw/evidence.md", 0, [0.1, 0.2, 0.3], config),
          locationKind: "sheet" as const,
          locationStart: 2,
          locationEnd: 2,
          locationLabel: "Finance & Ops",
          cellStart: "A7",
          cellEnd: "D7",
        },
      ],
      config,
    )

    const rows = await readRows(config)

    expect(rows).toHaveLength(1)
    expect(rows[0]?.vector).toHaveLength(3)
    expect(rows[0]?.vector[0]).toBeCloseTo(0.1)
    expect(rows[0]?.vector[1]).toBeCloseTo(0.2)
    expect(rows[0]?.vector[2]).toBeCloseTo(0.3)
    expect(rows[0]?.embeddingProvider).toBe("local-hash")
    expect(rows[0]?.contextPath).toBe("Evidence")
    expect(rows[0]?.searchText).toBe("Evidence\ncontent 0")
    expect(rows[0]).toEqual(
      expect.objectContaining({
        locationKind: "sheet",
        locationStart: 2,
        locationEnd: 2,
        locationLabel: "Finance & Ops",
        cellStart: "A7",
        cellEnd: "D7",
      }),
    )
  })

  it("drops the table when writing zero rows", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-store-empty-"))
    tempDirs.push(root)
    const config = testConfig(root)

    await writeRows([sampleRow(".ragmir/raw/a.md", 0, [0.1, 0.2], config)], config)
    expect(await countRows(config)).toBe(1)

    await writeRows([], config)
    expect(await countRows(config)).toBe(0)
  })

  it("overwrites the full table on re-write and reports the new row count", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-store-rewrite-"))
    tempDirs.push(root)
    const config = testConfig(root)

    await writeRows([sampleRow(".ragmir/raw/a.md", 0, [0.1, 0.2], config)], config)
    await writeRows(
      [
        sampleRow(".ragmir/raw/b.md", 0, [0.3, 0.4], config),
        sampleRow(".ragmir/raw/b.md", 1, [0.5, 0.6], config),
      ],
      config,
    )

    expect(await countRows(config)).toBe(2)
    const rows = await readRows(config)
    expect(rows.map((row) => row.relativePath)).toEqual([".ragmir/raw/b.md", ".ragmir/raw/b.md"])
  })

  it("returns a null vectorIndexWarning on a nominal small write (flat scan)", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-store-warning-"))
    tempDirs.push(root)
    const config = testConfig(root)

    const result = await writeRows([sampleRow(".ragmir/raw/a.md", 0, [0.1, 0.2], config)], config)
    expect(result.vectorIndexWarning).toBeNull()
    expect(result.lexicalIndexWarning).toBeNull()
  })

  it("should compact fragments and fully refresh FTS after twenty mutation batches", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-store-maintenance-"))
    tempDirs.push(root)
    const config = testConfig(root)
    const stablePath = ".ragmir/raw/stable.md"
    const mutablePath = ".ragmir/raw/mutable.md"
    await writeRows(
      [
        {
          ...sampleRow(stablePath, 0, [0.1, 0.2], config),
          searchText: "Evidence\nmaintenance baseline",
          text: "maintenance baseline",
        },
        sampleRow(mutablePath, 0, [0.3, 0.4], config),
      ],
      config,
    )

    for (let mutation = 1; mutation <= 21; mutation += 1) {
      await updateRowsInTable(
        [
          {
            ...sampleRow(mutablePath, 0, [0.3, 0.4], config),
            checksum: `mutation-${mutation}`,
            searchText: `Evidence\nmutable content ${mutation}`,
            text: `mutable content ${mutation}`,
          },
        ],
        [mutablePath],
        config.tableName,
        config,
      )
    }

    const table = await openRowsTable(config)
    expect(table).not.toBeNull()
    if (!table) {
      return
    }
    const versionBefore = await table.version()
    const fragmentsBefore = (await table.stats()).fragmentStats
    const coverageBefore = await table.indexStats("searchText_idx")
    const evidenceBefore = await fullTextEvidence(table)
    expect(coverageBefore?.numUnindexedRows).toBeGreaterThan(0)

    const dryRun = await maintainOpenStorageTable(table, config.tableName, config, {
      additionalMutations: 21,
      dryRun: true,
    })
    expect(dryRun.plannedActions).toEqual([
      "compact-fragments",
      "prune-old-versions",
      "refresh-full-text-index",
    ])
    expect(await table.version()).toBe(versionBefore)

    const report = await maintainOpenStorageTable(table, config.tableName, config, {
      additionalMutations: 21,
    })
    const coverageAfter = await table.indexStats("searchText_idx")
    const fragmentsAfter = (await table.stats()).fragmentStats
    const evidenceAfter = await fullTextEvidence(table)

    expect(report.status).toBe("completed")
    expect(report.mutationsSinceOptimization).toBe(0)
    expect(report.completedActions).toEqual([
      "compact-fragments",
      "prune-old-versions",
      "refresh-full-text-index",
    ])
    expect(coverageAfter).toEqual(
      expect.objectContaining({ numIndexedRows: 2, numUnindexedRows: 0 }),
    )
    expect(fragmentsAfter.numSmallFragments).toBeLessThanOrEqual(fragmentsBefore.numSmallFragments)
    expect(evidenceAfter).toEqual(evidenceBefore)
    expect(evidenceAfter).toEqual([`${stablePath}:1-1`])
  })

  it("should keep the active table readable when optional compaction fails", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-store-maintenance-failure-"))
    tempDirs.push(root)
    const config = testConfig(root)
    await writeRows(
      [
        {
          ...sampleRow(".ragmir/raw/stable.md", 0, [0.1, 0.2], config),
          searchText: "Evidence\nmaintenance baseline",
          text: "maintenance baseline",
        },
      ],
      config,
    )
    const table = await openRowsTable(config)
    expect(table).not.toBeNull()
    if (!table) {
      return
    }
    vi.spyOn(table, "optimize").mockRejectedValueOnce(new Error("simulated optimize failure"))

    const report = await maintainOpenStorageTable(table, config.tableName, config, { force: true })

    expect(report.status).toBe("warning")
    expect(report.warning).toContain("simulated optimize failure")
    await expect(table.countRows()).resolves.toBe(1)
    await expect(fullTextEvidence(table)).resolves.toEqual([".ragmir/raw/stable.md:1-1"])
  })

  it("should replace all rows for a source in one table version when content shrinks", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-store-merge-"))
    tempDirs.push(root)
    const config = testConfig(root)
    const replacedPath = ".ragmir/raw/replaced.md"
    const preservedPath = ".ragmir/raw/preserved.md"
    await writeRows(
      [
        sampleRow(replacedPath, 0, [0.1, 0.2], config),
        sampleRow(replacedPath, 1, [0.3, 0.4], config),
        sampleRow(preservedPath, 0, [0.5, 0.6], config),
      ],
      config,
    )
    const tableBefore = await openRowsTable(config)
    const versionBefore = await tableBefore?.version()
    const replacement = {
      ...sampleRow(replacedPath, 0, [0.7, 0.8], config),
      text: "replacement content",
      searchText: "Evidence\nreplacement content",
      checksum: "replacement-checksum",
    }

    await updateRowsInTable([replacement], [replacedPath], config.tableName, config)

    const rows = await readRows(config)
    const tableAfter = await openRowsTable(config)
    expect(rows.map((row) => `${row.relativePath}#${row.chunkIndex}`).sort()).toEqual([
      ".ragmir/raw/preserved.md#0",
      ".ragmir/raw/replaced.md#0",
    ])
    expect(rows.find((row) => row.relativePath === replacedPath)?.text).toBe("replacement content")
    expect(await tableAfter?.version()).toBe((versionBefore ?? 0) + 1)
  })

  it("activates a completed generation through the manifest while preserving legacy tables", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-store-generation-"))
    tempDirs.push(root)
    const config = testConfig(root)
    const generationTable = "chunks__generation_00000000000040008000000000000001"
    await writeRows([sampleRow(".ragmir/raw/legacy.md", 0, [0.1, 0.2], config)], config)
    await writeRowsToTable(
      [sampleRow(".ragmir/raw/current.md", 0, [0.3, 0.4], config)],
      generationTable,
      config,
    )

    await writeIndexManifest(
      {
        schemaVersion: 8,
        createdAt: "2026-07-14T00:00:00.000Z",
        ragmirVersion: "test",
        embeddingProvider: config.embeddingProvider,
        embeddingModel: config.embeddingModel,
        chunkSize: config.chunkSize,
        chunkOverlap: config.chunkOverlap,
        fileCount: 1,
        chunkCount: 1,
        tableName: generationTable,
      },
      config,
    )

    expect((await readRows(config)).map((row) => row.relativePath)).toEqual([
      ".ragmir/raw/current.md",
    ])
  })

  it("should ignore a malformed optional quality report without invalidating the core manifest", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-manifest-quality-"))
    tempDirs.push(root)
    const config = testConfig(root)
    const manifest: IndexManifest = {
      schemaVersion: 8,
      createdAt: "2026-07-17T00:00:00.000Z",
      ragmirVersion: "test",
      embeddingProvider: config.embeddingProvider,
      embeddingModel: config.embeddingModel,
      chunkSize: config.chunkSize,
      chunkOverlap: config.chunkOverlap,
      fileCount: 0,
      chunkCount: 0,
    }
    await writeIndexManifest(manifest, config)
    await writeFile(
      path.join(config.storageDir, INDEX_MANIFEST_FILENAME),
      JSON.stringify({ ...manifest, qualityReport: { schemaVersion: "invalid" } }),
      "utf8",
    )

    await expect(readIndexManifest(config)).resolves.toEqual(manifest)
  })
})

describe("empty-text-files manifest", () => {
  it("round-trips empty-text file records", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-manifest-"))
    tempDirs.push(root)
    const config = testConfig(root)

    await writeEmptyTextFiles(
      [
        { relativePath: "scanned.pdf", checksum: "abc" },
        { relativePath: "image.png", checksum: "def" },
      ],
      config,
    )
    const records = await readEmptyTextFiles(config)

    expect(records.map((record) => record.relativePath)).toEqual(["image.png", "scanned.pdf"])
  })

  it("removes the manifest when given zero records", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-manifest-empty-"))
    tempDirs.push(root)
    const config = testConfig(root)

    await writeEmptyTextFiles([{ relativePath: "x.pdf", checksum: "c" }], config)
    await writeEmptyTextFiles([], config)

    expect(await readEmptyTextFiles(config)).toEqual([])
  })

  it("returns an empty list when the manifest is missing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-manifest-missing-"))
    tempDirs.push(root)

    expect(await readEmptyTextFiles(testConfig(root))).toEqual([])
  })

  it("returns an empty list when the manifest is malformed", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-manifest-bad-"))
    tempDirs.push(root)
    const config = testConfig(root)
    await mkdir(config.storageDir, { recursive: true })
    await writeFile(
      path.join(config.storageDir, "empty-text-files.json"),
      "{not valid json",
      "utf8",
    )

    await expect(readEmptyTextFiles(config)).rejects.toThrow()
  })

  it("filters out malformed entries while keeping valid ones", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-manifest-filter-"))
    tempDirs.push(root)
    const config = testConfig(root)
    await mkdir(config.storageDir, { recursive: true })
    // A record object with the wrong shape (missing checksum) sits alongside a valid one.
    await writeFile(
      path.join(config.storageDir, "empty-text-files.json"),
      JSON.stringify({
        version: 1,
        files: [
          { relativePath: "good.pdf", checksum: "ok" },
          { relativePath: "bad.pdf" },
          "not-a-record",
        ],
      }),
      "utf8",
    )

    const records = await readEmptyTextFiles(config)
    expect(records).toHaveLength(1)
    expect(records[0]?.relativePath).toBe("good.pdf")
  })
})

describe("index manifest", () => {
  const sampleManifest: IndexManifest = {
    schemaVersion: 2,
    createdAt: "2026-01-01T00:00:00.000Z",
    ragmirVersion: "0.4.12",
    embeddingProvider: "local-hash",
    embeddingModel: "mixedbread-ai/mxbai-embed-xsmall-v1",
    vectorDimension: 384,
    vectorDistanceMetric: "l2",
    chunkSize: 1200,
    chunkOverlap: 200,
    fileCount: 3,
    chunkCount: 12,
  }

  it("round-trips the index manifest", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-index-manifest-"))
    tempDirs.push(root)
    const config = testConfig(root)

    await writeIndexManifest(sampleManifest, config)
    const manifest = await readIndexManifest(config)

    expect(manifest).toEqual(sampleManifest)
  })

  it("should keep the activation manifest compact while streaming file metadata", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-index-manifest-files-"))
    tempDirs.push(root)
    const config = testConfig(root)
    const indexedFiles = [
      { relativePath: "raw/a.md", checksum: "a".repeat(64), chunkCount: 1 },
      { relativePath: "raw/b.md", checksum: "b".repeat(64), chunkCount: 2 },
    ]
    const manifest: IndexManifest = {
      ...sampleManifest,
      fileCount: indexedFiles.length,
      chunkCount: 3,
      indexedFiles,
    }

    await writeIndexManifest(manifest, config)

    const header = JSON.parse(
      await readFile(path.join(config.storageDir, INDEX_MANIFEST_FILENAME), "utf8"),
    ) as { indexedFiles?: unknown; indexedFilesSnapshot?: string }
    expect(header.indexedFiles).toBeUndefined()
    expect(header.indexedFilesSnapshot).toMatch(/^index-manifest\.files\..+\.jsonl$/u)
    expect(
      await readFile(path.join(config.storageDir, header.indexedFilesSnapshot ?? ""), "utf8"),
    ).toContain("raw/b.md")
    await expect(readIndexManifest(config)).resolves.toEqual(manifest)
    await expect(readIndexManifestFilePage(config, 1, 1)).resolves.toEqual({
      files: [indexedFiles[1]],
      total: 2,
      offset: 1,
      limit: 1,
      nextOffset: null,
    })

    await writeIndexManifest(manifest, config)
    expect(
      (await readdir(config.storageDir)).filter((entry) =>
        entry.startsWith("index-manifest.files."),
      ),
    ).toHaveLength(2)
  })

  it("returns null when the manifest is missing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-index-manifest-missing-"))
    tempDirs.push(root)

    expect(await readIndexManifest(testConfig(root))).toBeNull()
  })

  it("returns null when the manifest is malformed", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-index-manifest-bad-"))
    tempDirs.push(root)
    const config = testConfig(root)
    await mkdir(config.storageDir, { recursive: true })
    await writeFile(path.join(config.storageDir, "index-manifest.json"), "{not valid json", "utf8")

    expect(await readIndexManifest(config)).toBeNull()
  })

  it("returns null when the manifest has the wrong shape", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-index-manifest-shape-"))
    tempDirs.push(root)
    const config = testConfig(root)
    await mkdir(config.storageDir, { recursive: true })
    await writeFile(
      path.join(config.storageDir, "index-manifest.json"),
      JSON.stringify({ schemaVersion: 1, createdAt: "x" }),
      "utf8",
    )

    expect(await readIndexManifest(config)).toBeNull()
  })

  it("should reject a malformed optional corpus fingerprint", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-index-manifest-fingerprint-"))
    tempDirs.push(root)
    const config = testConfig(root)
    await mkdir(config.storageDir, { recursive: true })
    await writeFile(
      path.join(config.storageDir, INDEX_MANIFEST_FILENAME),
      JSON.stringify({ ...sampleManifest, corpusFingerprint: "invalid" }),
      "utf8",
    )

    expect(await readIndexManifest(config)).toBeNull()
  })

  it.each([
    { phase: "before-write" as const, selected: "old" as const },
    { phase: "before-sync" as const, selected: "old" as const },
    { phase: "before-rename" as const, selected: "old" as const },
    { phase: "after-rename" as const, selected: "new" as const },
  ])("should restart on a complete generation after a manifest fault at $phase", async ({
    phase,
    selected,
  }) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-manifest-fault-"))
    tempDirs.push(root)
    const config = testConfig(root)
    const oldTable = `${config.tableName}__generation_00000000000040008000000000000001`
    const newTable = `${config.tableName}__generation_00000000000040008000000000000002`
    await writeRowsToTable(
      [sampleRow(".ragmir/raw/default.md", 0, [0.1, 0.2], config)],
      config.tableName,
      config,
    )
    await writeRowsToTable(
      [sampleRow(".ragmir/raw/old.md", 0, [0.3, 0.4], config)],
      oldTable,
      config,
    )
    await writeRowsToTable(
      [sampleRow(".ragmir/raw/new.md", 0, [0.5, 0.6], config)],
      newTable,
      config,
    )
    await writeIndexManifest({ ...sampleManifest, tableName: oldTable }, config)

    await expect(
      withDurableWriteFaultForTests(failManifestAt(phase), () =>
        writeIndexManifest({ ...sampleManifest, tableName: newTable }, config),
      ),
    ).rejects.toThrow(`fault:${phase}`)

    const expectedTable = selected === "old" ? oldTable : newTable
    await expect(readIndexManifest(config)).resolves.toMatchObject({ tableName: expectedTable })
    const snapshot = await loadIndexReadSnapshot(config)
    try {
      expect(snapshot.tableName).toBe(expectedTable)
      expect(snapshot.table?.name).toBe(expectedTable)
      expect(snapshot.table?.name).not.toBe(config.tableName)
    } finally {
      closeIndexReadSnapshot(snapshot, config)
    }
  })

  it.each([
    "missing",
    "invalid",
  ] as const)("should recover the previous generation when the canonical manifest is $failure", async (failure) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-manifest-recovery-"))
    tempDirs.push(root)
    const config = testConfig(root)
    const oldTable = `${config.tableName}__generation_00000000000040008000000000000003`
    const newTable = `${config.tableName}__generation_00000000000040008000000000000004`
    await writeRowsToTable(
      [sampleRow(".ragmir/raw/default.md", 0, [0.1, 0.2], config)],
      config.tableName,
      config,
    )
    await writeRowsToTable(
      [sampleRow(".ragmir/raw/old.md", 0, [0.3, 0.4], config)],
      oldTable,
      config,
    )
    await writeRowsToTable(
      [sampleRow(".ragmir/raw/new.md", 0, [0.5, 0.6], config)],
      newTable,
      config,
    )
    await writeIndexManifest({ ...sampleManifest, tableName: oldTable }, config)
    await writeIndexManifest({ ...sampleManifest, tableName: newTable }, config)
    const canonicalPath = path.join(config.storageDir, INDEX_MANIFEST_FILENAME)
    if (failure === "missing") {
      await rm(canonicalPath)
    } else {
      await writeFile(canonicalPath, "{invalid", "utf8")
    }

    await expect(readIndexManifest(config)).resolves.toMatchObject({ tableName: oldTable })
    expect(indexManifestRecoveryDiagnostic(config)).toMatchObject({
      canonicalStatus: failure,
      previousStatus: "valid",
      selected: "previous",
    })
    const snapshot = await loadIndexReadSnapshot(config)
    try {
      expect(snapshot.table?.name).toBe(oldTable)
      expect(snapshot.table?.name).not.toBe(config.tableName)
    } finally {
      closeIndexReadSnapshot(snapshot, config)
    }
  })

  it("should refuse an unverified default table when both manifests are invalid", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-manifest-unrecoverable-"))
    tempDirs.push(root)
    const config = testConfig(root)
    await writeRowsToTable(
      [sampleRow(".ragmir/raw/default.md", 0, [0.1, 0.2], config)],
      config.tableName,
      config,
    )
    await writeIndexManifest(sampleManifest, config)
    await writeFile(path.join(config.storageDir, INDEX_MANIFEST_FILENAME), "{invalid", "utf8")
    await writeFile(
      path.join(config.storageDir, "index-manifest.previous.json"),
      "{invalid",
      "utf8",
    )

    const snapshot = await loadIndexReadSnapshot(config)
    expect(snapshot.manifest).toBeNull()
    expect(snapshot.table).toBeNull()
    expect(indexManifestRecoveryDiagnostic(config)?.warning).toContain(
      "will not select an unverified default table",
    )
  })
})

function failManifestAt(phase: DurableWritePhase) {
  return (event: { targetPath: string; phase: DurableWritePhase }): void => {
    if (path.basename(event.targetPath) === INDEX_MANIFEST_FILENAME && event.phase === phase) {
      throw new Error(`fault:${phase}`)
    }
  }
}
