export interface InstallSkillOptions {
    cwd?: string;
    targetDir?: string;
}
export interface InstallSkillResult {
    skillPath: string;
    audioSkillPath: string;
    mcpConfigPath: string;
    readmePath: string;
    written: string[];
}
export declare function bundledSkillPath(skillName?: string): string;
export declare function installSkill(options?: InstallSkillOptions): Promise<InstallSkillResult>;
//# sourceMappingURL=skill.d.ts.map