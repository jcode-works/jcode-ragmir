import { createHash } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
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
//# sourceMappingURL=access-log.js.map