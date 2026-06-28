import { createHash } from "node:crypto"
import { appendFile, mkdir } from "node:fs/promises"
import path from "node:path"
import type { Config } from "./types.js"

export interface AccessLogEvent {
  action: "ingest" | "search" | "ask" | "destroy-index"
  query?: string
  topK?: number
  resultCount?: number
  redactions?: number
}

export async function recordAccess(config: Config, event: AccessLogEvent): Promise<void> {
  if (!config.accessLog) {
    return
  }

  try {
    await mkdir(path.dirname(config.accessLogPath), { recursive: true })
    await appendFile(config.accessLogPath, `${JSON.stringify(toLogLine(event))}\n`, "utf8")
  } catch {
    // Access logging is best-effort so read-only workspaces do not block local use.
  }
}

function toLogLine(event: AccessLogEvent): Record<string, unknown> {
  return {
    timestamp: new Date().toISOString(),
    action: event.action,
    queryHash: event.query ? hashQuery(event.query) : undefined,
    topK: event.topK,
    resultCount: event.resultCount,
    redactions: event.redactions,
  }
}

function hashQuery(query: string): string {
  return createHash("sha256").update(query).digest("hex")
}
