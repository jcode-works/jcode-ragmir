import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config.js";
const ACCESS_LOG_ACTIONS = [
    "ingest",
    "search",
    "ask",
    "research",
    "evaluate",
    "destroy-index",
];
const ACCESS_LOG_ACTION_SET = new Set(ACCESS_LOG_ACTIONS);
const DEFAULT_USAGE_REPORT_DAYS = 7;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
export async function recordAccess(config, event) {
    if (!config.accessLog) {
        return;
    }
    try {
        await mkdir(path.dirname(config.accessLogPath), { recursive: true });
        await appendFile(config.accessLogPath, `${JSON.stringify(toLogLine(event))}\n`, "utf8");
    }
    catch {
        // Access logging is best-effort so read-only workspaces do not block local use.
    }
}
export async function accessLogUsageReport(options = {}) {
    const config = await loadConfig(String(options.cwd ?? process.cwd()));
    const days = normalizeUsageReportDays(options.days);
    const until = new Date();
    const since = new Date(until.getTime() - days * MILLISECONDS_PER_DAY);
    const eventsByAction = emptyEventsByAction();
    const queryHashes = new Set();
    let totalEvents = 0;
    let invalidLines = 0;
    let resultCountTotal = 0;
    let resultCountEvents = 0;
    let lastEventAt = null;
    if (existsSync(config.accessLogPath)) {
        const lines = (await readFile(config.accessLogPath, "utf8")).split(/\r?\n/u).filter(Boolean);
        for (const line of lines) {
            const event = parseAccessLogLine(line);
            if (!event) {
                invalidLines += 1;
                continue;
            }
            const timestamp = Date.parse(event.timestamp);
            if (!Number.isFinite(timestamp) ||
                timestamp < since.getTime() ||
                timestamp > until.getTime()) {
                continue;
            }
            totalEvents += 1;
            eventsByAction[event.action] += 1;
            if (event.queryHash) {
                queryHashes.add(event.queryHash);
            }
            if (typeof event.resultCount === "number") {
                resultCountTotal += event.resultCount;
                resultCountEvents += 1;
            }
            if (lastEventAt === null || event.timestamp > lastEventAt) {
                lastEventAt = event.timestamp;
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
        lastEventAt,
    };
}
function toLogLine(event) {
    return {
        timestamp: new Date().toISOString(),
        action: event.action,
        queryHash: event.query ? hashQuery(event.query) : undefined,
        topK: event.topK,
        resultCount: event.resultCount,
        redactions: event.redactions,
    };
}
function hashQuery(query) {
    return createHash("sha256").update(query).digest("hex");
}
function emptyEventsByAction() {
    return {
        ingest: 0,
        search: 0,
        ask: 0,
        research: 0,
        evaluate: 0,
        "destroy-index": 0,
    };
}
function normalizeUsageReportDays(days) {
    if (days === undefined) {
        return DEFAULT_USAGE_REPORT_DAYS;
    }
    if (!Number.isInteger(days) || days <= 0) {
        throw new Error("usage-report days must be a positive integer.");
    }
    return days;
}
function parseAccessLogLine(line) {
    try {
        const parsed = JSON.parse(line);
        if (!isAccessLogLine(parsed)) {
            return null;
        }
        return parsed;
    }
    catch {
        return null;
    }
}
function isAccessLogLine(value) {
    return (typeof value === "object" &&
        value !== null &&
        hasTimestamp(value) &&
        hasAction(value) &&
        hasOptionalQueryHash(value) &&
        hasOptionalResultCount(value));
}
function hasTimestamp(value) {
    return "timestamp" in value && typeof value.timestamp === "string";
}
function hasAction(value) {
    return ("action" in value && typeof value.action === "string" && ACCESS_LOG_ACTION_SET.has(value.action));
}
function hasOptionalQueryHash(value) {
    return !("queryHash" in value) || typeof value.queryHash === "string";
}
function hasOptionalResultCount(value) {
    return !("resultCount" in value) || typeof value.resultCount === "number";
}
//# sourceMappingURL=access-log.js.map