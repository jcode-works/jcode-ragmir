import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { loadConfig } from "./config.js"
import * as embeddingsModule from "./embeddings.js"
import { indexPolicyFingerprint } from "./index-policy.js"
import { audit, ingest } from "./ingest.js"
import { getIngestionProgress, readIngestionState, writeIngestionState } from "./ingestion-state.js"
import { initProject } from "./init.js"
import { search } from "./query.js"
import * as storeModule from "./store.js"
import { connectStore, openRowsTable, readIndexManifest, readRows } from "./store.js"

const tempDirs: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("ingest", () => {
  it("should stop an audit when the signal is already aborted", async () => {
    const controller = new AbortController()
    controller.abort("cancelled by caller")

    await expect(audit(process.cwd(), { signal: controller.signal })).rejects.toMatchObject({
      code: "ABORTED",
      retryable: true,
    })
  })

  it("reports skipped files and detects stale indexed content by checksum", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-ingest-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await writeFile(path.join(root, ".ragmir", "raw", "evidence.md"), "First version.\n", "utf8")
    await writeFile(path.join(root, ".ragmir", "raw", "scan.heic"), "unsupported image\n", "utf8")

    const result = await ingest({ cwd: root })
    expect(result.discoveredFiles).toBe(2)
    expect(result.supportedFiles).toBe(1)
    expect(result.supportedBytes).toBeGreaterThan(0)
    expect(result.largestFileBytes).toBeGreaterThan(0)
    expect(result.rebuiltFiles).toBe(1)
    expect(result.reusedFiles).toBe(0)
    expect(result.unsupportedFiles).toBe(1)
    expect(result.emptyTextFiles).toEqual([])
    expect(result.unsupportedExtensions).toEqual([{ extension: ".heic", count: 1 }])

    await writeFile(path.join(root, ".ragmir", "raw", "evidence.md"), "Changed version.\n", "utf8")
    const report = await audit(root)

    expect(report.missingFromIndex).toEqual([])
    expect(report.discoveredFiles).toBe(2)
    expect(report.supportedBytes).toBeGreaterThan(0)
    expect(report.largestFileBytes).toBeGreaterThan(0)
    expect(report.staleInIndex).toEqual([".ragmir/raw/evidence.md"])
    expect(report.chunkStats.count).toBe(1)
    expect(report.chunkStats.minChars).toBeGreaterThan(0)
    expect(report.chunkStats.p95Chars).toBe(report.chunkStats.maxChars)
    expect(report.chunkStats.contextualRatio).toBe(0)
    expect(report.skippedFiles).toEqual([
      expect.objectContaining({
        relativePath: ".ragmir/raw/scan.heic",
        reason: "unsupported-extension",
      }),
    ])
  })

  it("reuses unchanged indexed rows during incremental ingest", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-ingest-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await writeFile(path.join(root, ".ragmir", "raw", "alpha.md"), "Alpha evidence.\n", "utf8")
    await writeFile(path.join(root, ".ragmir", "raw", "beta.md"), "Beta evidence.\n", "utf8")

    const first = await ingest({ cwd: root })
    await writeFile(
      path.join(root, ".ragmir", "raw", "beta.md"),
      "Changed beta evidence.\n",
      "utf8",
    )
    const second = await ingest({ cwd: root })

    expect(first.indexedFiles).toBe(2)
    expect(second.indexedFiles).toBe(2)
    expect(second.rebuiltFiles).toBe(1)
    expect(second.reusedFiles).toBe(1)
    const rows = await readRows(await loadConfig(root))
    expect(rows.map((row) => row.relativePath).sort()).toEqual([
      ".ragmir/raw/alpha.md",
      ".ragmir/raw/beta.md",
    ])
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length)
  })

  it("should validate indexed files when locale and storage path orders differ", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-ingest-path-order-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await writeFile(path.join(root, ".ragmir", "raw", "Zebra.md"), "Uppercase evidence.\n")
    await writeFile(path.join(root, ".ragmir", "raw", "alpha.md"), "Lowercase evidence.\n")

    const result = await ingest({ cwd: root, rebuild: true })

    expect(result.indexedFiles).toBe(2)
    expect(result.chunks).toBe(2)
  })

  it("should preserve and mark the last known good rows after an incremental parse failure", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-last-good-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    const sourcePath = path.join(root, ".ragmir", "raw", "evidence.json")
    const relativePath = ".ragmir/raw/evidence.json"
    await writeFile(sourcePath, JSON.stringify({ decision: "retain legacy-token evidence" }))
    await ingest({ cwd: root })

    const config = await loadConfig(root)
    const rowsBefore = await readRows(config)
    const manifestBefore = await readIndexManifest(config)
    await writeFile(sourcePath, '{"decision":', "utf8")

    const failed = await ingest({ cwd: root })
    const rowsAfterFailure = await readRows(config)
    const manifestAfterFailure = await readIndexManifest(config)
    const stateAfterFailure = await readIngestionState(config)
    const fileState = stateAfterFailure?.files.find((file) => file.relativePath === relativePath)
    const reportAfterFailure = await audit(root)
    const resultsAfterFailure = await search("legacy-token", { cwd: root })

    expect(failed.staleLastKnownGood).toEqual([relativePath])
    expect(failed.errors).toEqual([expect.objectContaining({ path: relativePath })])
    expect(rowsAfterFailure).toEqual(rowsBefore)
    expect(manifestAfterFailure?.chunkCount).toBe(rowsBefore.length)
    expect(manifestAfterFailure?.indexedFiles).toEqual(manifestBefore?.indexedFiles)
    expect(manifestAfterFailure?.staleFiles).toEqual([
      expect.objectContaining({
        relativePath,
        lastGoodChecksum: manifestBefore?.indexedFiles?.[0]?.checksum,
        chunkCount: rowsBefore.length,
      }),
    ])
    expect(fileState).toMatchObject({
      state: "error",
      lastGoodChecksum: manifestBefore?.indexedFiles?.[0]?.checksum,
      lastGoodChunkCount: rowsBefore.length,
      staleLastKnownGood: true,
    })
    expect(fileState?.checksum).not.toBe(fileState?.lastGoodChecksum)
    expect(reportAfterFailure.staleInIndex).toEqual([relativePath])
    expect(reportAfterFailure.missingFromIndex).toEqual([])
    expect(reportAfterFailure.totalChunks).toBe(rowsBefore.length)
    expect(resultsAfterFailure[0]?.text).toContain("legacy-token")

    await writeFile(sourcePath, JSON.stringify({ decision: "use repaired-token evidence" }))
    const repaired = await ingest({ cwd: root })
    const repairedRows = await readRows(config)
    const repairedManifest = await readIndexManifest(config)

    expect(repaired.staleLastKnownGood).toEqual([])
    expect(repaired.errors).toEqual([])
    expect(repairedRows).toHaveLength(1)
    expect(new Set(repairedRows.map((row) => row.id)).size).toBe(repairedRows.length)
    expect(repairedRows[0]?.text).toContain("repaired-token")
    expect(repairedManifest?.staleFiles).toBeUndefined()
    await expect(audit(root)).resolves.toMatchObject({
      staleInIndex: [],
      missingFromIndex: [],
      totalChunks: 1,
    })

    await rm(sourcePath)
    const deleted = await ingest({ cwd: root })
    expect(deleted.chunks).toBe(0)
    expect(await readRows(config)).toEqual([])
    await expect(audit(root)).resolves.toMatchObject({
      indexedFiles: [],
      supportedFiles: [],
      staleInIndex: [],
      missingFromIndex: [],
      totalChunks: 0,
    })
  })

  it("should remove stale rows only when the strict incremental failure policy is selected", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-remove-stale-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    const sourcePath = path.join(root, ".ragmir", "raw", "evidence.json")
    const relativePath = ".ragmir/raw/evidence.json"
    await writeFile(sourcePath, JSON.stringify({ evidence: "valid before failure" }))
    await ingest({ cwd: root })
    await writeFile(sourcePath, "{invalid", "utf8")

    const result = await ingest({ cwd: root, incrementalFailurePolicy: "remove-stale" })
    const config = await loadConfig(root)
    const state = await readIngestionState(config)

    expect(result.staleLastKnownGood).toEqual([])
    expect(result.errors).toEqual([expect.objectContaining({ path: relativePath })])
    expect(await readRows(config)).toEqual([])
    expect(await readIndexManifest(config)).toMatchObject({
      chunkCount: 0,
      indexedFiles: [],
    })
    expect(state?.files[0]).toMatchObject({
      state: "error",
      lastGoodChecksum: null,
      lastGoodChunkCount: 0,
      staleLastKnownGood: false,
    })
    await expect(audit(root)).resolves.toMatchObject({
      missingFromIndex: [relativePath],
      staleInIndex: [],
      totalChunks: 0,
    })
  })

  it("should keep the active rows and manifest when incremental embedding fails", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-embedding-failure-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    const sourcePath = path.join(root, ".ragmir", "raw", "evidence.md")
    await writeFile(sourcePath, "Healthy evidence before embedding failure.\n")
    await ingest({ cwd: root })
    const config = await loadConfig(root)
    const rowsBefore = await readRows(config)
    const manifestBefore = await readIndexManifest(config)
    await writeFile(sourcePath, "Changed evidence that cannot be embedded.\n")
    vi.spyOn(embeddingsModule, "embedTexts").mockRejectedValueOnce(
      new Error("simulated embedding failure"),
    )

    await expect(ingest({ cwd: root })).rejects.toThrow("simulated embedding failure")

    expect(await readRows(config)).toEqual(rowsBefore)
    expect(await readIndexManifest(config)).toEqual(manifestBefore)
    await expect(readIngestionState(config)).resolves.toMatchObject({
      status: "failed",
      files: [expect.objectContaining({ state: "parsed", staleLastKnownGood: true })],
    })
  })

  it("should keep the active rows and manifest when the incremental Lance write fails", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-lance-failure-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    const sourcePath = path.join(root, ".ragmir", "raw", "evidence.md")
    await writeFile(sourcePath, "Healthy evidence before Lance failure.\n")
    await ingest({ cwd: root })
    const config = await loadConfig(root)
    const rowsBefore = await readRows(config)
    const manifestBefore = await readIndexManifest(config)
    await writeFile(sourcePath, "Changed evidence that cannot be committed.\n")
    vi.spyOn(storeModule, "updateRowsInTable").mockRejectedValueOnce(
      new Error("simulated Lance write failure"),
    )

    await expect(ingest({ cwd: root })).rejects.toThrow("simulated Lance write failure")

    expect(await readRows(config)).toEqual(rowsBefore)
    expect(await readIndexManifest(config)).toEqual(manifestBefore)
    await expect(readIngestionState(config)).resolves.toMatchObject({
      status: "failed",
      files: [expect.objectContaining({ state: "embedded", staleLastKnownGood: true })],
    })
  })

  it("should rebuild changed content when size and mtime are unchanged", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-checksum-refresh-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    const sourcePath = path.join(root, ".ragmir", "raw", "evidence.md")
    const fixedTime = new Date("2026-01-01T00:00:00.000Z")
    await writeFile(sourcePath, "AAAA\n", "utf8")
    await utimes(sourcePath, fixedTime, fixedTime)
    await ingest({ cwd: root })

    await writeFile(sourcePath, "BBBB\n", "utf8")
    await utimes(sourcePath, fixedTime, fixedTime)
    const result = await ingest({ cwd: root })

    expect(result.rebuiltFiles).toBe(1)
    expect(result.reusedFiles).toBe(0)
    expect((await readRows(await loadConfig(root))).map((row) => row.text)).toEqual(["BBBB"])
  })

  it("resumes an interrupted run without reprocessing committed files or duplicating chunks", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-resume-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    for (const name of ["alpha", "beta", "gamma"]) {
      await writeFile(
        path.join(root, ".ragmir", "raw", `${name}.md`),
        `${name} evidence.\n`,
        "utf8",
      )
    }

    const controller = new AbortController()
    await expect(
      ingest({
        cwd: root,
        batchSize: 1,
        signal: controller.signal,
        onProgress(progress) {
          if (progress.indexedFiles === 1) {
            controller.abort("test interruption")
          }
        },
      }),
    ).rejects.toMatchObject({ code: "ABORTED" })

    const config = await loadConfig(root)
    const interruptedState = await readIngestionState(config)
    const committedFile = interruptedState?.files.find((file) => file.state === "indexed")
    expect(interruptedState?.status).toBe("interrupted")
    expect(committedFile).toBeDefined()
    expect(await readRows(config)).toHaveLength(1)

    if (!interruptedState || !committedFile) {
      throw new Error("Expected one committed file in the interrupted ingestion state.")
    }
    await writeIngestionState(
      {
        ...interruptedState,
        files: interruptedState.files.map((file) =>
          file.relativePath === committedFile.relativePath ? { ...file, state: "embedded" } : file,
        ),
      },
      config,
    )

    const resumedProgress: number[] = []
    const resumed = await ingest({
      cwd: root,
      onProgress(progress) {
        resumedProgress.push(progress.indexedFiles)
      },
    })
    const completedState = await readIngestionState(config)
    const committedAfterResume = completedState?.files.find(
      (file) => file.relativePath === committedFile?.relativePath,
    )
    const rows = await readRows(config)

    expect(resumed.runId).toBe(interruptedState?.runId)
    expect(resumed.resumed).toBe(true)
    expect(resumed.batchSize).toBe(1)
    expect(resumedProgress[0]).toBe(1)
    expect(completedState?.status).toBe("completed")
    expect(committedAfterResume?.updatedAt).toBe(committedFile?.updatedAt)
    expect(rows).toHaveLength(3)
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length)
    await expect(getIngestionProgress(config)).resolves.toMatchObject({
      runId: resumed.runId,
      resumed: true,
      indexedFiles: 3,
      pendingFiles: 0,
      errorFiles: 0,
    })
  })

  it("should reject an ingest file batch above the safe maximum", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-ingest-batch-limit-"))
    tempDirs.push(root)
    await initProject(root)

    await expect(ingest({ cwd: root, batchSize: 1_000_000 })).rejects.toThrow(/batchSize.*at most/i)
  })

  it("should persist one bounded commit before cancellation when the file batch is larger", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-bounded-commit-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    for (const name of ["alpha", "beta", "gamma"]) {
      await writeFile(path.join(root, ".ragmir", "raw", `${name}.md`), `${name} evidence.\n`)
    }

    const controller = new AbortController()
    await expect(
      ingest({
        cwd: root,
        batchSize: 3,
        signal: controller.signal,
        onProgress(progress) {
          if (progress.indexedFiles === 1) {
            controller.abort("bounded commit observed")
          }
        },
      }),
    ).rejects.toMatchObject({ code: "ABORTED" })

    const config = await loadConfig(root)
    await expect(readIngestionState(config)).resolves.toMatchObject({
      status: "interrupted",
      files: expect.arrayContaining([expect.objectContaining({ state: "indexed" })]),
    })
    expect(await readRows(config)).toHaveLength(1)
  })

  it("should preserve rows ranking and citations across ingestion window sizes", async () => {
    const roots = await Promise.all(
      ["single", "windowed"].map(async (label) => {
        const root = await mkdtemp(path.join(os.tmpdir(), `ragmir-ingest-equivalence-${label}-`))
        tempDirs.push(root)
        await initProject(root)
        await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
        for (const [name, text] of [
          ["alpha", "Alpha contains the exact launch token ORBIT-ALPHA."],
          ["beta", "Beta contains unrelated deployment background."],
          ["gamma", "Gamma confirms ORBIT-ALPHA is the approved launch token."],
        ] as const) {
          await writeFile(path.join(root, ".ragmir", "raw", `${name}.md`), `${text}\n`)
        }
        return root
      }),
    )
    const [singleRoot, windowedRoot] = roots
    if (!singleRoot || !windowedRoot) {
      throw new Error("Expected two equivalence fixtures.")
    }

    await ingest({ cwd: singleRoot, batchSize: 1 })
    await ingest({ cwd: windowedRoot, batchSize: 3 })
    const comparableRows = async (root: string) =>
      (await readRows(await loadConfig(root)))
        .map((row) => ({
          id: row.id,
          relativePath: row.relativePath,
          chunkIndex: row.chunkIndex,
          text: row.text,
          vector: row.vector,
        }))
        .sort((left, right) => left.id.localeCompare(right.id))
    expect(await comparableRows(windowedRoot)).toEqual(await comparableRows(singleRoot))

    const comparableResults = async (root: string) =>
      (await search("What is the approved launch token ORBIT-ALPHA?", { cwd: root, topK: 3 })).map(
        (result) => ({
          relativePath: result.relativePath,
          chunkIndex: result.chunkIndex,
          citation: result.citation,
          text: result.text,
        }),
      )
    expect(await comparableResults(windowedRoot)).toEqual(await comparableResults(singleRoot))
  })

  it("keeps the active healthy index when a staged rebuild is interrupted", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-rebuild-rollback-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await writeFile(
      path.join(root, ".ragmir", "raw", "healthy.md"),
      "Healthy production evidence.\n",
      "utf8",
    )
    await ingest({ cwd: root })
    const config = await loadConfig(root)
    const manifestBefore = await readIndexManifest(config)
    const rowsBefore = await readRows(config)
    await writeFile(
      path.join(root, ".ragmir", "raw", "new.md"),
      "New evidence for the staged rebuild.\n",
      "utf8",
    )

    const controller = new AbortController()
    await expect(
      ingest({
        cwd: root,
        rebuild: true,
        batchSize: 1,
        signal: controller.signal,
        onProgress(progress) {
          if (progress.mode === "rebuild" && progress.indexedFiles === 1) {
            controller.abort("test rebuild interruption")
          }
        },
      }),
    ).rejects.toMatchObject({ code: "ABORTED" })

    const manifestAfter = await readIndexManifest(config)
    const rowsAfter = await readRows(config)
    expect(manifestAfter).toEqual(manifestBefore)
    expect(rowsAfter).toEqual(rowsBefore)
    await expect(getIngestionProgress(config)).resolves.toMatchObject({
      mode: "rebuild",
      status: "interrupted",
      indexedFiles: 1,
    })
  })

  it("keeps the active healthy index when a staged rebuild fails", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-rebuild-failure-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await writeFile(
      path.join(root, ".ragmir", "raw", "healthy.md"),
      "Healthy index before a failed rebuild.\n",
      "utf8",
    )
    await ingest({ cwd: root })
    const config = await loadConfig(root)
    const manifestBefore = await readIndexManifest(config)
    const rowsBefore = await readRows(config)

    await expect(
      ingest({
        cwd: root,
        rebuild: true,
        batchSize: 1,
        onProgress(progress) {
          if (progress.mode === "rebuild" && progress.indexedFiles === 1) {
            throw new Error("simulated fatal rebuild failure")
          }
        },
      }),
    ).rejects.toThrow("simulated fatal rebuild failure")

    expect(await readIndexManifest(config)).toEqual(manifestBefore)
    expect(await readRows(config)).toEqual(rowsBefore)
    await expect(getIngestionProgress(config)).resolves.toMatchObject({
      mode: "rebuild",
      status: "failed",
      indexedFiles: 1,
    })
  })

  it("continues indexing healthy files when one PDF is corrupt", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-corrupt-pdf-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await writeFile(path.join(root, ".ragmir", "raw", "broken.pdf"), "not a pdf", "utf8")
    await writeFile(
      path.join(root, ".ragmir", "raw", "healthy.md"),
      "Healthy evidence remains indexable.\n",
      "utf8",
    )

    const result = await ingest({ cwd: root, batchSize: 1 })

    expect(result.indexedFiles).toBe(1)
    expect(result.errors).toEqual([expect.objectContaining({ path: ".ragmir/raw/broken.pdf" })])
    expect((await readRows(await loadConfig(root))).map((row) => row.relativePath)).toEqual([
      ".ragmir/raw/healthy.md",
    ])
    await expect(getIngestionProgress(await loadConfig(root))).resolves.toMatchObject({
      status: "completed_with_errors",
      indexedFiles: 1,
      errorFiles: 1,
    })
  })

  it("writes an index manifest after ingest and reports a null vectorIndexWarning", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-manifest-write-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await writeFile(path.join(root, ".ragmir", "raw", "alpha.md"), "Alpha evidence.\n", "utf8")

    const result = await ingest({ cwd: root })

    expect(result.vectorIndexWarning).toBeNull()
    expect(result.lexicalIndexWarning).toBeNull()
    expect(result.storageWarning).toBeNull()
    const manifest = await readIndexManifest(await loadConfig(root))
    expect(manifest).not.toBeNull()
    expect(manifest?.embeddingProvider).toBe("local-hash")
    expect(manifest?.schemaVersion).toBe(9)
    expect(manifest?.indexPolicyFingerprint).toBe(indexPolicyFingerprint(await loadConfig(root)))
    expect(manifest?.vectorDimension).toBeGreaterThan(0)
    expect(manifest?.vectorDistanceMetric).toBe("l2")
    expect(manifest?.vectorIndex).toMatchObject({
      strategy: "exact",
      dimension: manifest?.vectorDimension,
      indexedRows: result.chunks,
      unindexedRows: 0,
      coverage: 1,
    })
    expect(manifest?.chunkCount).toBe(result.chunks)
  })

  it("does not create a LanceDB version for a no-op ingest", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-noop-ingest-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await writeFile(path.join(root, ".ragmir", "raw", "alpha.md"), "Alpha evidence.\n")
    await ingest({ cwd: root })
    const config = await loadConfig(root)
    const table = await openRowsTable(config)
    const versionBefore = await table?.version()

    const result = await ingest({ cwd: root })
    const versionAfter = await (await openRowsTable(config))?.version()

    expect(result.rebuiltFiles).toBe(0)
    expect(result.reusedFiles).toBe(1)
    expect(versionAfter).toBe(versionBefore)
  })

  it("should stream final validation and audit without materializing all rows", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-stream-validation-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await writeFile(path.join(root, ".ragmir", "raw", "alpha.md"), "Alpha evidence.\n")
    await ingest({ cwd: root })
    const config = await loadConfig(root)
    const table = await openRowsTable(config)
    if (!table) {
      throw new Error("Expected an index table for streaming validation.")
    }
    const queryPrototype = Object.getPrototypeOf(table.query()) as {
      toArray: () => Promise<unknown[]>
    }
    const toArray = vi.spyOn(queryPrototype, "toArray")

    await ingest({ cwd: root })
    expect(toArray).toHaveBeenCalledTimes(1)

    toArray.mockClear()
    const report = await audit(root)
    expect(report.totalChunks).toBe(1)
    expect(toArray).not.toHaveBeenCalled()
  })

  it("rebuilds every file when the content policy changes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-policy-rebuild-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await writeFile(path.join(root, ".ragmir", "raw", "alpha.md"), "Contact user@example.test.\n")
    await ingest({ cwd: root })
    await writeFile(
      path.join(root, ".ragmir", "config.json"),
      JSON.stringify({ redaction: { enabled: false } }),
    )

    const result = await ingest({ cwd: root })

    expect(result.policyRebuild).toBe(true)
    expect(result.rebuiltFiles).toBe(1)
    expect(result.reusedFiles).toBe(0)
  })

  it("forces a full re-index of every file when rebuild is requested", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-rebuild-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await writeFile(path.join(root, ".ragmir", "raw", "alpha.md"), "Alpha evidence.\n", "utf8")
    await writeFile(path.join(root, ".ragmir", "raw", "beta.md"), "Beta evidence.\n", "utf8")

    // First ingest indexes both files.
    await ingest({ cwd: root })
    // A normal second ingest would reuse both; rebuild must re-index all of them.
    const rebuilt = await ingest({ cwd: root, rebuild: true })

    expect(rebuilt.indexedFiles).toBe(2)
    expect(rebuilt.rebuiltFiles).toBe(2)
    expect(rebuilt.reusedFiles).toBe(0)
  })

  it("should preserve open readers when a rebuilt generation becomes active", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-rebuild-cleanup-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await writeFile(path.join(root, ".ragmir", "raw", "alpha.md"), "Alpha evidence.\n")
    await ingest({ cwd: root })
    const config = await loadConfig(root)
    const previousTableName = (await readIndexManifest(config))?.tableName ?? config.tableName
    const previousTable = await openRowsTable(config)
    if (!previousTable) {
      throw new Error("Expected the active table before rebuilding.")
    }
    expect(await previousTable.countRows()).toBe(1)

    await ingest({ cwd: root, rebuild: true })

    const activeTableName = (await readIndexManifest(config))?.tableName
    const connection = await connectStore(config)
    try {
      const tableNames = await connection.tableNames()
      const generationPrefix = `${config.tableName}__generation_`
      expect(activeTableName?.startsWith(generationPrefix)).toBe(true)
      expect(activeTableName?.slice(generationPrefix.length)).toMatch(/^[0-9a-f]{32}$/u)
      expect(tableNames).toContain(activeTableName)
      expect(tableNames).toContain(previousTableName)
      await expect(previousTable.countRows()).resolves.toBe(1)
    } finally {
      connection.close()
    }
  })

  it("reports supported files that produce no indexable text", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-empty-text-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await writeFile(path.join(root, ".ragmir", "raw", "scan.pdf"), createBlankPdf())

    const result = await ingest({ cwd: root })

    expect(result.discoveredFiles).toBe(1)
    expect(result.supportedFiles).toBe(1)
    expect(result.indexedFiles).toBe(0)
    expect(result.chunks).toBe(0)
    expect(result.skippedFiles).toBe(1)
    expect(result.emptyTextFiles).toEqual([".ragmir/raw/scan.pdf"])

    const report = await audit(root)
    expect(report.emptyTextFiles).toEqual([".ragmir/raw/scan.pdf"])
    expect(report.missingFromIndex).toEqual([])
  })

  it("reports duplicate and mirror-like source diagnostics", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-source-diagnostics-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw", "raw_files"), { recursive: true })
    await writeFile(
      path.join(root, ".ragmir", "raw", "decision.md"),
      "Canonical evidence.\n",
      "utf8",
    )
    await writeFile(
      path.join(root, ".ragmir", "raw", "raw_files", "decision-copy.md"),
      "Canonical evidence.\n",
      "utf8",
    )

    await ingest({ cwd: root })
    const report = await audit(root)

    expect(report.sourceDiagnostics.duplicateCandidates).toEqual([
      expect.objectContaining({
        files: [".ragmir/raw/decision.md", ".ragmir/raw/raw_files/decision-copy.md"],
      }),
    ])
    expect(report.sourceDiagnostics.mirrorCandidates).toEqual([
      expect.objectContaining({
        relativePath: ".ragmir/raw/raw_files/decision-copy.md",
      }),
    ])
  })

  it("does not report files with the same basename and different content as duplicates", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-source-diagnostics-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw", "nested"), { recursive: true })
    await writeFile(path.join(root, ".ragmir", "raw", "README.md"), "First source.\n", "utf8")
    await writeFile(
      path.join(root, ".ragmir", "raw", "nested", "README.md"),
      "Second source with different evidence.\n",
      "utf8",
    )

    await ingest({ cwd: root })
    const report = await audit(root)

    expect(report.sourceDiagnostics.duplicateCandidates).toEqual([])
  })
})

function createBlankPdf(): string {
  return `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>
endobj
xref
0 4
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
trailer
<< /Size 4 /Root 1 0 R >>
startxref
190
%%EOF`
}
