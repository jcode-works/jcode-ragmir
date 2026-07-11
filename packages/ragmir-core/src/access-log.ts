import { createHmac, randomBytes } from "node:crypto"
import { existsSync } from "node:fs"
import { appendFile, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { loadConfig } from "./config.js"
import { ensurePrivateDirectory, hardenPrivateFile } from "./permissions.js"
import type {
  AccessLogAction,
  AccessLogUsageOptions,
  AccessLogUsageReport,
  Config,
} from "./types.js"

export interface AccessLogEvent {
  action: AccessLogAction
  query?: string
  topK?: number
  resultCount?: number
  redactions?: number
}

interface AccessLogLine {
  timestamp: string
  action: AccessLogAction
  queryHash?: string
  resultCount?: number
}

interface ResultCountStats {
  total: number
  events: number
}

const ACCESS_LOG_ACTIONS: AccessLogAction[] = [
  "ingest",
  "search",
  "ask",
  "research",
  "evaluate",
  "destroy-index",
]
const ACCESS_LOG_ACTION_SET = new Set<string>(ACCESS_LOG_ACTIONS)
const DEFAULT_USAGE_REPORT_DAYS = 7
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000
/**
 * Soft cap above which the access log is trimmed to its most recent lines.
 * Keeps the file bounded so long-lived installations (MCP server) do not grow
 * it without limit, and so usage reports do not load an unbounded file.
 */
const MAX_ACCESS_LOG_BYTES = 10 * 1024 * 1024
/** Number of most recent lines retained when the log exceeds the byte cap. */
const TRIMMED_ACCESS_LOG_LINES = 50_000
const ACCESS_LOG_SALT_FILE = ".ragmir-access-log.salt"

export async function recordAccess(config: Config, event: AccessLogEvent): Promise<void> {
  if (!config.accessLog) {
    return
  }

  try {
    await ensurePrivateDirectory(path.dirname(config.accessLogPath))
    await trimAccessLogIfNeeded(config.accessLogPath)
    await appendFile(config.accessLogPath, `${JSON.stringify(await toLogLine(config, event))}\n`, {
      encoding: "utf8",
      mode: 0o600,
    })
    await hardenPrivateFile(config.accessLogPath)
  } catch {
    // Access logging is best-effort so read-only workspaces do not block local use.
  }
}

async function trimAccessLogIfNeeded(accessLogPath: string): Promise<void> {
  let size = 0
  try {
    size = (await stat(accessLogPath)).size
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return
    }
    throw error
  }

  if (size <= MAX_ACCESS_LOG_BYTES) {
    return
  }

  const content = await readFile(accessLogPath, "utf8")
  const lines = content.split("\n").filter((line) => line.length > 0)
  const kept = lines.slice(Math.max(0, lines.length - TRIMMED_ACCESS_LOG_LINES))
  await writeFile(accessLogPath, `${kept.join("\n")}\n`, "utf8")
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}

export async function accessLogUsageReport(
  options: AccessLogUsageOptions = {},
): Promise<AccessLogUsageReport> {
  const config = await loadConfig(String(options.cwd ?? process.cwd()))
  const days = normalizeUsageReportDays(options.days)
  const until = new Date()
  const since = new Date(until.getTime() - days * MILLISECONDS_PER_DAY)
  const eventsByAction = emptyEventsByAction()
  const queryHashes = new Set<string>()
  const resultCountsByAction = emptyResultCountsByAction()
  let totalEvents = 0
  let invalidLines = 0
  let resultCountTotal = 0
  let resultCountEvents = 0
  let lastEventAt: string | null = null

  if (existsSync(config.accessLogPath)) {
    const lines = (await readFile(config.accessLogPath, "utf8")).split(/\r?\n/u).filter(Boolean)
    for (const line of lines) {
      const event = parseAccessLogLine(line)
      if (!event) {
        invalidLines += 1
        continue
      }
      const timestamp = Date.parse(event.timestamp)
      if (
        !Number.isFinite(timestamp) ||
        timestamp < since.getTime() ||
        timestamp > until.getTime()
      ) {
        continue
      }
      totalEvents += 1
      eventsByAction[event.action] += 1
      if (event.queryHash) {
        queryHashes.add(event.queryHash)
      }
      if (typeof event.resultCount === "number") {
        resultCountTotal += event.resultCount
        resultCountEvents += 1
        resultCountsByAction[event.action].total += event.resultCount
        resultCountsByAction[event.action].events += 1
      }
      if (lastEventAt === null || event.timestamp > lastEventAt) {
        lastEventAt = event.timestamp
      }
    }
  }

  return {
    accessLogEnabled: config.accessLog,
    since: since.toISOString(),
    until: until.toISOString(),
    totalEvents,
    invalidLines,
    eventsByAction,
    uniqueQueryHashes: queryHashes.size,
    averageResultCount: resultCountEvents === 0 ? null : resultCountTotal / resultCountEvents,
    averageResultCountByAction: averageResultCounts(resultCountsByAction),
    lastEventAt,
  }
}

function emptyResultCountsByAction(): Record<AccessLogAction, ResultCountStats> {
  return {
    ingest: { total: 0, events: 0 },
    search: { total: 0, events: 0 },
    ask: { total: 0, events: 0 },
    research: { total: 0, events: 0 },
    evaluate: { total: 0, events: 0 },
    "destroy-index": { total: 0, events: 0 },
  }
}

function averageResultCounts(
  stats: Record<AccessLogAction, ResultCountStats>,
): Record<AccessLogAction, number | null> {
  return {
    ingest: averageResultCount(stats.ingest),
    search: averageResultCount(stats.search),
    ask: averageResultCount(stats.ask),
    research: averageResultCount(stats.research),
    evaluate: averageResultCount(stats.evaluate),
    "destroy-index": averageResultCount(stats["destroy-index"]),
  }
}

function averageResultCount(stats: ResultCountStats): number | null {
  return stats.events === 0 ? null : stats.total / stats.events
}

async function toLogLine(config: Config, event: AccessLogEvent): Promise<Record<string, unknown>> {
  return {
    timestamp: new Date().toISOString(),
    action: event.action,
    queryHash: event.query ? await hashQuery(config, event.query) : undefined,
    topK: event.topK,
    resultCount: event.resultCount,
    redactions: event.redactions,
  }
}

async function hashQuery(config: Config, query: string): Promise<string> {
  const salt = await accessLogSalt(config)
  return createHmac("sha256", salt).update(query).digest("hex")
}

async function accessLogSalt(config: Config): Promise<Buffer> {
  const saltPath = path.join(path.dirname(config.accessLogPath), ACCESS_LOG_SALT_FILE)
  try {
    return await readFile(saltPath)
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error
    }
  }

  const salt = randomBytes(32)
  try {
    await writeFile(saltPath, salt, { flag: "wx", mode: 0o600 })
    await hardenPrivateFile(saltPath)
    return salt
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      return readFile(saltPath)
    }
    throw error
  }
}

function emptyEventsByAction(): Record<AccessLogAction, number> {
  return {
    ingest: 0,
    search: 0,
    ask: 0,
    research: 0,
    evaluate: 0,
    "destroy-index": 0,
  }
}

function normalizeUsageReportDays(days: number | undefined): number {
  if (days === undefined) {
    return DEFAULT_USAGE_REPORT_DAYS
  }
  if (!Number.isInteger(days) || days <= 0) {
    throw new Error("usage-report days must be a positive integer.")
  }
  return days
}

function parseAccessLogLine(line: string): AccessLogLine | null {
  try {
    const parsed: unknown = JSON.parse(line)
    if (!isAccessLogLine(parsed)) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function isAccessLogLine(value: unknown): value is AccessLogLine {
  return (
    typeof value === "object" &&
    value !== null &&
    hasTimestamp(value) &&
    hasAction(value) &&
    hasOptionalQueryHash(value) &&
    hasOptionalResultCount(value)
  )
}

function hasTimestamp(value: object): value is { timestamp: string } {
  return "timestamp" in value && typeof value.timestamp === "string"
}

function hasAction(value: object): value is { action: AccessLogAction } {
  return (
    "action" in value && typeof value.action === "string" && ACCESS_LOG_ACTION_SET.has(value.action)
  )
}

function hasOptionalQueryHash(value: object): value is { queryHash?: string } {
  return !("queryHash" in value) || typeof value.queryHash === "string"
}

function hasOptionalResultCount(value: object): value is { resultCount?: number } {
  return !("resultCount" in value) || typeof value.resultCount === "number"
}
