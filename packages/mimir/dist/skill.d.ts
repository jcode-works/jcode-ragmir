export type AgentTarget = "claude" | "codex" | "kimi" | "opencode" | "cline";
export type AgentInstallScope = "project" | "user";
export type AgentInstallMode = "link" | "copy";
export interface InstallSkillOptions {
    cwd?: string;
    targetDir?: string;
}
export interface InstallSkillResult {
    skillPath: string;
    audioSkillPath: string;
    reportSkillPath: string;
    mcpConfigPath: string;
    claudeConfigPath: string;
    codexConfigPath: string;
    kimiConfigPath: string;
    opencodeConfigPath: string;
    clineConfigPath: string;
    agentSetupPath: string;
    readmePath: string;
    written: string[];
}
export interface InstallAgentSkillsOptions {
    cwd?: string;
    agents?: readonly AgentTarget[];
    scope?: AgentInstallScope;
    mode?: AgentInstallMode;
    homeDir?: string;
    env?: Record<string, string | undefined>;
}
export interface AgentSkillInstallation {
    agent: AgentTarget;
    label: string;
    scope: AgentInstallScope;
    mode: AgentInstallMode;
    targetDir: string;
    skillPaths: string[];
}
export interface InstallAgentSkillsResult {
    projectKit: InstallSkillResult;
    installations: AgentSkillInstallation[];
    written: string[];
}
export declare const SUPPORTED_AGENT_TARGETS: readonly AgentTarget[];
export declare function bundledSkillPath(skillName?: string): string;
export declare function parseAgentTargets(value: string | readonly string[] | undefined): AgentTarget[];
export declare function installSkill(options?: InstallSkillOptions): Promise<InstallSkillResult>;
export declare function installAgentSkills(options?: InstallAgentSkillsOptions): Promise<InstallAgentSkillsResult>;
//# sourceMappingURL=skill.d.ts.map