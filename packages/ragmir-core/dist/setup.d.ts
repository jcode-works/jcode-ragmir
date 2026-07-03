import { type PullEmbeddingModelResult } from "./embeddings.js";
import { type PackageManager } from "./package-manager.js";
import { type EnableSemanticEmbeddingsResult } from "./semantic-config.js";
import { type AgentTarget, type InstallSkillResult } from "./skill.js";
import type { DoctorReport, IngestResult } from "./types.js";
export interface SetupOptions {
    cwd?: string;
    targetDir?: string;
    ingest?: boolean;
    semantic?: boolean;
    agents?: readonly AgentTarget[];
    mcpServerName?: string;
    mcpCommand?: string;
    mcpArgs?: readonly string[];
}
export interface SetupSemanticResult {
    model: PullEmbeddingModelResult;
    config: EnableSemanticEmbeddingsResult;
}
export interface SetupResult {
    projectRoot: string;
    packageManager: PackageManager;
    runCommand: string;
    created: string[];
    agentKit: InstallSkillResult;
    semantic: SetupSemanticResult | null;
    ingested: IngestResult | null;
    doctor: DoctorReport;
    nextSteps: string[];
}
export declare function setupProject(options?: SetupOptions): Promise<SetupResult>;
//# sourceMappingURL=setup.d.ts.map