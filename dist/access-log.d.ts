import type { Config } from "./types.js";
export interface AccessLogEvent {
    action: "ingest" | "search" | "ask" | "destroy-index";
    query?: string;
    topK?: number;
    resultCount?: number;
    redactions?: number;
}
export declare function recordAccess(config: Config, event: AccessLogEvent): Promise<void>;
//# sourceMappingURL=access-log.d.ts.map