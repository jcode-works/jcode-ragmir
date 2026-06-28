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
    readmePath: string;
    written: string[];
}
export declare function bundledSkillPath(skillName?: string): string;
export declare function installSkill(options?: InstallSkillOptions): Promise<InstallSkillResult>;
//# sourceMappingURL=skill.d.ts.map