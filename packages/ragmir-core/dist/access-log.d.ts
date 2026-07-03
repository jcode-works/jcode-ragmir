import type { AccessLogAction, AccessLogUsageOptions, AccessLogUsageReport, Config } from "./types.js";
export interface AccessLogEvent {
    action: AccessLogAction;
    query?: string;
    topK?: number;
    resultCount?: number;
    redactions?: number;
}
export declare function recordAccess(config: Config, event: AccessLogEvent): Promise<void>;
export declare function accessLogUsageReport(options?: AccessLogUsageOptions): Promise<AccessLogUsageReport>;
//# sourceMappingURL=access-log.d.ts.map