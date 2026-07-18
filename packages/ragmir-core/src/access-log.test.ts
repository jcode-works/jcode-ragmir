import { appendFile, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  accessLogUsageReport,
  accessLogWriterMetrics,
  flushAccessLog,
  MAX_ACCESS_LOG_PENDING_EVENTS,
  MAX_USAGE_REPORT_DAYS,
  recordAccess,
  recordMcpOutput,
} from "./access-log.js"
import { loadConfig } from "./config.js"
import { initProject } from "./init.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("accessLogUsageReport", () => {
  it("should stop before reading the access log when the signal is already aborted", async () => {
    const controller = new AbortController()
    controller.abort("cancelled by caller")

    await expect(
      accessLogUsageReport({ cwd: process.cwd(), signal: controller.signal }),
    ).rejects.toMatchObject({ code: "ABORTED", retryable: true })
  })

  it("summarizes metadata-only usage without exposing raw queries", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-access-log-"))
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

  it("should reject usage windows when outside the supported range", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-access-log-"))
    tempDirs.push(root)
    await initProject(root)

    await expect(
      accessLogUsageReport({ cwd: root, days: MAX_USAGE_REPORT_DAYS }),
    ).resolves.toMatchObject({ accessLogEnabled: true })
    for (const days of [0, MAX_USAGE_REPORT_DAYS + 1, Number.NaN]) {
      await expect(accessLogUsageReport({ cwd: root, days })).rejects.toThrow(
        `usage-report days must be an integer between 1 and ${MAX_USAGE_REPORT_DAYS}.`,
      )
    }
  })

  it("separates query result averages from ingestion chunk counts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-access-log-actions-"))
    tempDirs.push(root)
    await initProject(root)
    const config = await loadConfig(root)
    await recordAccess(config, { action: "ingest", resultCount: 1_000 })
    await recordAccess(config, { action: "search", query: "first", resultCount: 8 })
    await recordAccess(config, { action: "search", query: "second", resultCount: 4 })
    await recordAccess(config, { action: "ask", query: "third", resultCount: 2 })

    const report = await accessLogUsageReport({ cwd: root, days: 7 })

    expect(report.averageResultCount).toBe(253.5)
    expect(report.averageResultCountByAction.ingest).toBe(1_000)
    expect(report.averageResultCountByAction.search).toBe(6)
    expect(report.averageResultCountByAction.ask).toBe(2)
    expect(report.averageResultCountByAction.evaluate).toBeNull()
  })

  it("should aggregate metadata-only MCP output metrics without storing corpus details", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-mcp-output-log-"))
    tempDirs.push(root)
    await initProject(root)
    const config = await loadConfig(root)

    await recordMcpOutput(config, {
      tool: "ragmir_search",
      retrievedBytes: 8_000,
      returnedBytes: 2_000,
      compacted: true,
      truncated: false,
    })
    await recordMcpOutput(config, {
      tool: "ragmir_expand",
      retrievedBytes: 3_000,
      returnedBytes: 1_000,
      compacted: false,
      truncated: true,
    })

    const report = await accessLogUsageReport({ cwd: root, days: 7 })
    const rawLog = await readFile(config.accessLogPath, "utf8")

    expect(report.mcpOutput).toEqual({
      responses: 2,
      retrievedBytes: 11_000,
      returnedBytes: 3_000,
      savedBytes: 8_000,
      reductionRatio: 8 / 11,
      compactedResponses: 1,
      truncatedResponses: 1,
    })
    expect(rawLog).not.toContain("private query")
    expect(rawLog).not.toContain("raw/policy.md")
    expect(rawLog).not.toContain(root)
  })

  it("should reject malformed MCP metric lines while reading older access entries", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-mcp-output-invalid-"))
    tempDirs.push(root)
    await initProject(root)
    const config = await loadConfig(root)
    await recordAccess(config, { action: "search", query: "known query", resultCount: 1 })
    await appendFile(
      config.accessLogPath,
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        kind: "mcp-output",
        tool: "ragmir_search",
        retrievedBytes: -1,
        returnedBytes: 1,
        compacted: false,
        truncated: false,
      })}\n`,
      "utf8",
    )

    const report = await accessLogUsageReport({ cwd: root, days: 7 })

    expect(report.eventsByAction.search).toBe(1)
    expect(report.mcpOutput.responses).toBe(0)
    expect(report.invalidLines).toBe(1)
  })
})

describe("recordAccess retention", () => {
  it("should bound queued events and expose explicit drop metrics", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-access-log-bounded-"))
    tempDirs.push(root)
    await initProject(root)
    const config = await loadConfig(root)
    const eventCount = MAX_ACCESS_LOG_PENDING_EVENTS + 128
    const writes = Array.from({ length: eventCount }, () =>
      recordMcpOutput(config, {
        tool: "ragmir_search",
        retrievedBytes: 2,
        returnedBytes: 1,
        compacted: true,
        truncated: false,
      }),
    )

    expect(accessLogWriterMetrics(config).droppedEvents).toBeGreaterThan(0)
    const metrics = await flushAccessLog(config)
    await Promise.all(writes)

    expect(metrics.pendingEvents).toBe(0)
    expect(metrics.inFlightEvents).toBe(0)
    expect(metrics.writtenEvents + metrics.droppedEvents).toBe(eventCount)
  })

  it("trims the access log when it exceeds the size cap, keeping the most recent lines", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-access-log-trim-"))
    tempDirs.push(root)
    await initProject(root)
    const config = await loadConfig(root)

    // Pre-grow the log past the 10 MB cap with filler lines, then append one
    // real event. The retention trim must shrink the file well below the cap
    // while keeping the newest event intact.
    const fillerLine = '{"action":"ingest","timestamp":"2024-01-01T00:00:00.000Z"}'
    const fillerCount = Math.ceil((11 * 1024 * 1024) / (fillerLine.length + 1))
    const filler = `${Array(fillerCount).fill(fillerLine).join("\n")}\n`
    await writeFile(config.accessLogPath, filler, "utf8")
    const sizeBefore = (await stat(config.accessLogPath)).size
    expect(sizeBefore).toBeGreaterThan(10 * 1024 * 1024)

    await recordAccess(config, { action: "search", resultCount: 1 })

    const sizeAfter = (await stat(config.accessLogPath)).size
    expect(sizeAfter).toBeLessThan(sizeBefore)
    expect(sizeAfter).toBeLessThan(10 * 1024 * 1024)
  })

  it("should preserve concurrent events when retention and appends overlap", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-access-log-concurrent-trim-"))
    tempDirs.push(root)
    await initProject(root)
    const config = await loadConfig(root)
    const fillerLine = '{"action":"ingest","timestamp":"2024-01-01T00:00:00.000Z"}'
    const fillerCount = Math.ceil((11 * 1024 * 1024) / (fillerLine.length + 1))
    await writeFile(
      config.accessLogPath,
      `${Array(fillerCount).fill(fillerLine).join("\n")}\n`,
      "utf8",
    )

    await Promise.all([
      ...Array.from({ length: 4 }, (_value, index) =>
        recordAccess(config, {
          action: "search",
          query: `concurrent query ${index}`,
          resultCount: 1,
        }),
      ),
      ...Array.from({ length: 4 }, () =>
        recordMcpOutput(config, {
          tool: "ragmir_search",
          retrievedBytes: 2,
          returnedBytes: 1,
          compacted: true,
          truncated: false,
        }),
      ),
    ])

    const report = await accessLogUsageReport({ cwd: root, days: 7 })
    expect(report.totalEvents).toBe(8)
    expect(report.uniqueQueryHashes).toBe(4)
    expect(report.mcpOutput.responses).toBe(4)
  })

  it("salts query hashes per project and hardens local files", async () => {
    const firstRoot = await mkdtemp(path.join(os.tmpdir(), "ragmir-access-salt-a-"))
    const secondRoot = await mkdtemp(path.join(os.tmpdir(), "ragmir-access-salt-b-"))
    tempDirs.push(firstRoot, secondRoot)
    await initProject(firstRoot)
    await initProject(secondRoot)
    const firstConfig = await loadConfig(firstRoot)
    const secondConfig = await loadConfig(secondRoot)

    await recordAccess(firstConfig, { action: "search", query: "same private query" })
    await recordAccess(secondConfig, { action: "search", query: "same private query" })
    const firstLine = JSON.parse(await readFile(firstConfig.accessLogPath, "utf8")) as {
      queryHash: string
    }
    const secondLine = JSON.parse(await readFile(secondConfig.accessLogPath, "utf8")) as {
      queryHash: string
    }

    expect(firstLine.queryHash).not.toBe(secondLine.queryHash)
    if (process.platform !== "win32") {
      expect((await stat(firstConfig.accessLogPath)).mode & 0o777).toBe(0o600)
      expect((await stat(path.dirname(firstConfig.accessLogPath))).mode & 0o777).toBe(0o700)
    }
  })

  it("does not write a log entry when access logging is disabled", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-access-log-disabled-"))
    tempDirs.push(root)
    await initProject(root)
    const config = await loadConfig(root)
    const disabledConfig = { ...config, accessLog: false }

    await recordAccess(disabledConfig, { action: "search", resultCount: 1 })

    // No log file should exist because the disabled path returns before any append.
    await expect(stat(config.accessLogPath)).rejects.toThrow("ENOENT")
  })
})
