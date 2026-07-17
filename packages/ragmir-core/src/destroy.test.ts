import { existsSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { destroyIndex } from "./destroy.js"
import { withIndexWriteLock } from "./index-write-lock.js"
import { createIngestionRunState, writeIngestionState } from "./ingestion-state.js"
import { testConfig } from "./test-support/config.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("destroyIndex", () => {
  it("removes an existing storage directory and reports removed=true", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-destroy-"))
    tempDirs.push(root)
    const config = testConfig(root)
    await mkdir(config.storageDir, { recursive: true })
    await writeFile(path.join(config.storageDir, "index-manifest.json"), "{}", "utf8")

    const result = await destroyIndex(root)

    expect(result.removed).toBe(true)
    expect(result.storageDir).toBe(config.storageDir)
    expect(existsSync(config.storageDir)).toBe(false)
    expect(result.note).toContain("encrypted")
  })

  it("reports removed=false when the storage directory did not exist", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-destroy-missing-"))
    tempDirs.push(root)

    const result = await destroyIndex(root)

    expect(result.removed).toBe(false)
  })

  it("removes storage from an interrupted first run with valid ingestion state", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-destroy-ingestion-state-"))
    tempDirs.push(root)
    const config = testConfig(root)
    await writeIngestionState(
      createIngestionRunState({
        mode: "incremental",
        tableName: config.tableName,
        previousTableName: null,
        policyFingerprint: "test-policy",
        batchSize: 25,
        files: [],
        reusablePaths: new Set(),
        reusableChunkCounts: new Map(),
      }),
      config,
    )

    await expect(destroyIndex(root)).resolves.toMatchObject({ removed: true })
    expect(existsSync(config.storageDir)).toBe(false)
  })

  it("writes a destroy-index access log entry", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-destroy-log-"))
    tempDirs.push(root)
    const config = testConfig(root)
    await mkdir(path.dirname(config.accessLogPath), { recursive: true })

    await destroyIndex(root)

    expect(existsSync(config.accessLogPath)).toBe(true)
  })

  it("should wait for the active writer before destroying index storage", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-destroy-locked-"))
    tempDirs.push(root)
    const config = testConfig(root)
    await mkdir(config.storageDir, { recursive: true })
    await writeFile(path.join(config.storageDir, "index-manifest.json"), "{}", "utf8")
    let releaseWriter: (() => void) | undefined
    const writerFinished = new Promise<void>((resolve) => {
      releaseWriter = resolve
    })
    let markWriterStarted: (() => void) | undefined
    const writerStarted = new Promise<void>((resolve) => {
      markWriterStarted = resolve
    })
    const active = withIndexWriteLock(config.storageDir, undefined, async () => {
      markWriterStarted?.()
      await writerFinished
    })
    await writerStarted

    const destruction = destroyIndex(root)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(existsSync(config.storageDir)).toBe(true)

    releaseWriter?.()
    await active
    await expect(destruction).resolves.toMatchObject({ removed: true })
    expect(existsSync(config.storageDir)).toBe(false)
  })

  it("refuses to remove the project root when storageDir points to it", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-destroy-root-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".ragmir"), { recursive: true })
    await writeFile(path.join(root, ".ragmir", "config.json"), JSON.stringify({ storageDir: "." }))

    await expect(destroyIndex(root)).rejects.toThrow("unsafe storageDir")
    expect(existsSync(root)).toBe(true)
  })

  it("refuses to remove an unmarked directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-destroy-unmarked-"))
    tempDirs.push(root)
    const config = testConfig(root)
    await mkdir(config.storageDir, { recursive: true })
    await writeFile(path.join(config.storageDir, "unrelated.txt"), "keep", "utf8")

    await expect(destroyIndex(root)).rejects.toThrow("contains neither index-manifest.json")
    expect(existsSync(config.storageDir)).toBe(true)
  })
})
