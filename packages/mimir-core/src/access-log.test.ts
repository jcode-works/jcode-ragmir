import { appendFile, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { accessLogUsageReport, recordAccess } from "./access-log.js"
import { loadConfig } from "./config.js"
import { initProject } from "./init.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("accessLogUsageReport", () => {
  it("summarizes metadata-only usage without exposing raw queries", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mimir-access-log-"))
    tempDirs.push(root)
    await initProject(root)
    const config = await loadConfig(root)

    await recordAccess(config, {
      action: "search",
      query: "confidential client question",
      topK: 2,
      resultCount: 2,
    })
    await recordAccess(config, {
      action: "ask",
      query: "confidential client question",
      topK: 1,
      resultCount: 1,
    })
    await appendFile(config.accessLogPath, "not-json\n", "utf8")

    const report = await accessLogUsageReport({ cwd: root, days: 7 })

    expect(report.totalEvents).toBe(2)
    expect(report.invalidLines).toBe(1)
    expect(report.eventsByAction.search).toBe(1)
    expect(report.eventsByAction.ask).toBe(1)
    expect(report.uniqueQueryHashes).toBe(1)
    expect(report.averageResultCount).toBe(1.5)
    const serializedReport = JSON.stringify(report)
    expect(serializedReport).not.toContain("confidential client question")
    expect(serializedReport).not.toContain(root)
    expect(serializedReport).not.toContain(config.accessLogPath)
  })

  it("rejects invalid usage windows", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mimir-access-log-"))
    tempDirs.push(root)
    await initProject(root)

    await expect(accessLogUsageReport({ cwd: root, days: 0 })).rejects.toThrow(
      "usage-report days must be a positive integer.",
    )
  })
})
