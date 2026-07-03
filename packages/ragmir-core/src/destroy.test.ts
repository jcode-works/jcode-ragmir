import { existsSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { destroyIndex } from "./destroy.js"
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
    await writeFile(path.join(config.storageDir, "marker"), "present", "utf8")

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

  it("writes a destroy-index access log entry", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-destroy-log-"))
    tempDirs.push(root)
    const config = testConfig(root)
    await mkdir(path.dirname(config.accessLogPath), { recursive: true })

    await destroyIndex(root)

    expect(existsSync(config.accessLogPath)).toBe(true)
  })
})
