import { type PackageManager } from "./package-manager.js";
import { type AgentTarget, type InstallSkillResult } from "./skill.js";
import type { DoctorReport, IngestResult } from "./types.js";
export interface SetupOptions {
    cwd?: string;
    targetDir?: string;
    ingest?: boolean;
    agents?: readonly AgentTarget[];
    mcpServerName?: string;
    mcpCommand?: string;
    mcpArgs?: readonly string[];
}
export interface SetupResult {
    projectRoot: string;
    packageManager: PackageManager;
    runCommand: string;
    created: string[];
    agentKit: InstallSkillResult;
    ingested: IngestResult | null;
    doctor: DoctorReport;
    nextSteps: string[];
}
export declare function setupProject(options?: SetupOptions): Promise<SetupResult>;
//# sourceMappingURL=setup.d.ts.map