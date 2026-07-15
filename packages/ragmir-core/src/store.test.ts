import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  countRows,
  openRowsTable,
  readEmptyTextFiles,
  readIndexManifest,
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

describe("store", () => {
  it("round-trips vector rows from LanceDB as plain numeric arrays", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-store-"))
    tempDirs.push(root)
    const config = testConfig(root)

    await writeRows([sampleRow(".ragmir/raw/evidence.md", 0, [0.1, 0.2, 0.3], config)], config)

    const rows = await readRows(config)

    expect(rows).toHaveLength(1)
    expect(rows[0]?.vector).toHaveLength(3)
    expect(rows[0]?.vector[0]).toBeCloseTo(0.1)
    expect(rows[0]?.vector[1]).toBeCloseTo(0.2)
    expect(rows[0]?.vector[2]).toBeCloseTo(0.3)
    expect(rows[0]?.embeddingProvider).toBe("local-hash")
    expect(rows[0]?.contextPath).toBe("Evidence")
    expect(rows[0]?.searchText).toBe("Evidence\ncontent 0")
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
    const generationTable = "chunks__generation_test"
    await writeRows([sampleRow(".ragmir/raw/legacy.md", 0, [0.1, 0.2], config)], config)
    await writeRowsToTable(
      [sampleRow(".ragmir/raw/current.md", 0, [0.3, 0.4], config)],
      generationTable,
      config,
    )

    await writeIndexManifest(
      {
        schemaVersion: 7,
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
})
