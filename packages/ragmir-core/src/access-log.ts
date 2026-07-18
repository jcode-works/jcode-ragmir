import { createHmac, randomBytes } from "node:crypto"
import { existsSync } from "node:fs"
import { appendFile, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { loadConfig } from "./config.js"
import { operationSignal, throwIfAborted } from "./operation.js"
import { ensurePrivateDirectory, hardenPrivateFile } from "./permissions.js"
import type {
  AccessLogAction,
  AccessLogUsageOptions,
  AccessLogUsageReport,
  Config,
  McpOutputTool,
} from "./types.js"

export interface AccessLogEvent {
  action: AccessLogAction
  query?: string
  topK?: number
  resultCount?: number
  redactions?: number
}

export interface McpOutputLogEvent {
  tool: McpOutputTool
  retrievedBytes: number
  returnedBytes: number
  compacted: boolean
  truncated: boolean
}

interface AccessLogLine {
  timestamp: string
  action: AccessLogAction
  queryHash?: string
  resultCount?: number
}

interface McpOutputLogLine {
  timestamp: string
  kind: "mcp-output"
  tool: McpOutputTool
  retrievedBytes: number
  returnedBytes: number
  compacted: boolean
  truncated: boolean
}

type ParsedAccessLogLine = AccessLogLine | McpOutputLogLine

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
const MCP_OUTPUT_TOOLS: McpOutputTool[] = [
  "ragmir_search",
  "ragmir_ask",
  "ragmir_research",
  "ragmir_expand",
]
const MCP_OUTPUT_TOOL_SET = new Set<string>(MCP_OUTPUT_TOOLS)
const DEFAULT_USAGE_REPORT_DAYS = 7
export const MAX_USAGE_REPORT_DAYS = 3_650
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
export const MAX_ACCESS_LOG_PENDING_EVENTS = 1_024
const ACCESS_LOG_WRITE_BATCH_SIZE = 64

interface PendingAccessLogLine {
  render: () => Promise<string>
  settle: () => void
}

interface AccessLogWriterState {
  pending: PendingAccessLogLine[]
  active: Promise<void> | null
  inFlightEvents: number
  writtenEvents: number
  droppedEvents: number
}

export interface AccessLogWriterMetrics {
  pendingEvents: number
  inFlightEvents: number
  writtenEvents: number
  droppedEvents: number
}

const accessLogWriters = new Map<string, AccessLogWriterState>()
const accessLogSalts = new Map<string, Promise<Buffer>>()

export function recordAccess(config: Config, event: AccessLogEvent): Promise<void> {
  if (!config.accessLog) {
    return Promise.resolve()
  }
  return enqueueAccessLogLine(config.accessLogPath, async () =>
    JSON.stringify(await toLogLine(config, event)),
  )
}

export function recordMcpOutput(config: Config, event: McpOutputLogEvent): Promise<void> {
  if (!config.accessLog) {
    return Promise.resolve()
  }
  return enqueueAccessLogLine(config.accessLogPath, async () =>
    JSON.stringify({
      timestamp: new Date().toISOString(),
      kind: "mcp-output",
      tool: event.tool,
      retrievedBytes: event.retrievedBytes,
      returnedBytes: event.returnedBytes,
      compacted: event.compacted,
      truncated: event.truncated,
    } satisfies McpOutputLogLine),
  )
}

export async function flushAccessLog(config: Config): Promise<AccessLogWriterMetrics> {
  const state = accessLogWriters.get(config.accessLogPath)
  if (!state) {
    return emptyAccessLogWriterMetrics()
  }
  while (state.active || state.pending.length > 0) {
    startAccessLogWriter(config.accessLogPath, state)
    if (state.active) {
      await state.active
    }
  }
  return accessLogWriterMetrics(config)
}

export function accessLogWriterMetrics(config: Config): AccessLogWriterMetrics {
  const state = accessLogWriters.get(config.accessLogPath)
  return state
    ? {
        pendingEvents: state.pending.length,
        inFlightEvents: state.inFlightEvents,
        writtenEvents: state.writtenEvents,
        droppedEvents: state.droppedEvents,
      }
    : emptyAccessLogWriterMetrics()
}

function enqueueAccessLogLine(accessLogPath: string, render: () => Promise<string>): Promise<void> {
  const state = accessLogWriters.get(accessLogPath) ?? {
    pending: [],
    active: null,
    inFlightEvents: 0,
    writtenEvents: 0,
    droppedEvents: 0,
  }
  accessLogWriters.set(accessLogPath, state)
  if (state.pending.length >= MAX_ACCESS_LOG_PENDING_EVENTS) {
    state.droppedEvents += 1
    return Promise.resolve()
  }
  return new Promise((settle) => {
    state.pending.push({ render, settle })
    startAccessLogWriter(accessLogPath, state)
  })
}

function startAccessLogWriter(accessLogPath: string, state: AccessLogWriterState): void {
  if (state.active || state.pending.length === 0) {
    return
  }
  const batch = state.pending.splice(0, ACCESS_LOG_WRITE_BATCH_SIZE)
  state.inFlightEvents = batch.length
  const active = writeAccessLogBatch(accessLogPath, batch)
    .then(() => {
      state.writtenEvents += batch.length
    })
    .catch(() => {
      state.droppedEvents += batch.length
    })
    .finally(() => {
      for (const entry of batch) {
        entry.settle()
      }
      state.inFlightEvents = 0
      state.active = null
      startAccessLogWriter(accessLogPath, state)
    })
  state.active = active
}

async function writeAccessLogBatch(
  accessLogPath: string,
  batch: PendingAccessLogLine[],
): Promise<void> {
  await ensurePrivateDirectory(path.dirname(accessLogPath))
  await trimAccessLogIfNeeded(accessLogPath)
  const lines = await Promise.all(batch.map((entry) => entry.render()))
  await appendFile(accessLogPath, `${lines.join("\n")}\n`, {
    encoding: "utf8",
    mode: 0o600,
  })
  await hardenPrivateFile(accessLogPath)
}

function emptyAccessLogWriterMetrics(): AccessLogWriterMetrics {
  return {
    pendingEvents: 0,
    inFlightEvents: 0,
    writtenEvents: 0,
    droppedEvents: 0,
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
  const signal = operationSignal(options)
  throwIfAborted(signal)
  const config = await loadConfig(String(options.cwd ?? process.cwd()))
  return accessLogUsageReportWithConfig(config, options)
}

export async function accessLogUsageReportWithConfig(
  config: Config,
  options: AccessLogUsageOptions = {},
): Promise<AccessLogUsageReport> {
  const signal = operationSignal(options)
  throwIfAborted(signal)
  await flushAccessLog(config)
  throwIfAborted(signal)
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
  let mcpOutputResponses = 0
  let mcpRetrievedBytes = 0
  let mcpReturnedBytes = 0
  let compactedResponses = 0
  let truncatedResponses = 0
  let lastEventAt: string | null = null

  if (existsSync(config.accessLogPath)) {
    let content: string
    try {
      content = await readFile(config.accessLogPath, { encoding: "utf8", signal })
    } catch (error) {
      throwIfAborted(signal)
      throw error
    }
    throwIfAborted(signal)
    const lines = content.split(/\r?\n/u).filter(Boolean)
    for (const line of lines) {
      throwIfAborted(signal)
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
      if (isMcpOutputLogLine(event)) {
        mcpOutputResponses += 1
        mcpRetrievedBytes += event.retrievedBytes
        mcpReturnedBytes += event.returnedBytes
        compactedResponses += event.compacted ? 1 : 0
        truncatedResponses += event.truncated ? 1 : 0
        if (lastEventAt === null || event.timestamp > lastEventAt) {
          lastEventAt = event.timestamp
        }
        continue
      }
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

  throwIfAborted(signal)
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
    mcpOutput: {
      responses: mcpOutputResponses,
      retrievedBytes: mcpRetrievedBytes,
      returnedBytes: mcpReturnedBytes,
      savedBytes: mcpRetrievedBytes - mcpReturnedBytes,
      reductionRatio: mcpRetrievedBytes === 0 ? null : 1 - mcpReturnedBytes / mcpRetrievedBytes,
      compactedResponses,
      truncatedResponses,
    },
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
  const cached = accessLogSalts.get(saltPath)
  if (cached) {
    return cached
  }
  const loading = loadAccessLogSalt(saltPath)
  accessLogSalts.set(saltPath, loading)
  try {
    return await loading
  } catch (error) {
    if (accessLogSalts.get(saltPath) === loading) {
      accessLogSalts.delete(saltPath)
    }
    throw error
  }
}

async function loadAccessLogSalt(saltPath: string): Promise<Buffer> {
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
  if (!Number.isSafeInteger(days) || days <= 0 || days > MAX_USAGE_REPORT_DAYS) {
    throw new Error(`usage-report days must be an integer between 1 and ${MAX_USAGE_REPORT_DAYS}.`)
  }
  return days
}

function parseAccessLogLine(line: string): ParsedAccessLogLine | null {
  try {
    const parsed: unknown = JSON.parse(line)
    if (isAccessLogLine(parsed) || isMcpOutputLogLine(parsed)) {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

function isMcpOutputLogLine(value: unknown): value is McpOutputLogLine {
  return (
    typeof value === "object" &&
    value !== null &&
    hasTimestamp(value) &&
    "kind" in value &&
    value.kind === "mcp-output" &&
    "tool" in value &&
    typeof value.tool === "string" &&
    MCP_OUTPUT_TOOL_SET.has(value.tool) &&
    hasNonNegativeNumber(value, "retrievedBytes") &&
    hasNonNegativeNumber(value, "returnedBytes") &&
    hasBoolean(value, "compacted") &&
    hasBoolean(value, "truncated")
  )
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

function hasNonNegativeNumber(value: object, key: string): boolean {
  const field = Reflect.get(value, key)
  return typeof field === "number" && Number.isFinite(field) && field >= 0
}

function hasBoolean(value: object, key: string): boolean {
  return typeof Reflect.get(value, key) === "boolean"
}
