export type PackageManager = "pnpm" | "npm" | "yarn" | "bun";
export interface RagmirCommand {
    packageManager: PackageManager;
    command: string;
    args: string[];
    display: string;
}
export declare function detectPackageManager(cwd?: string): Promise<PackageManager>;
export declare function ragmirCommand(cwd: string, args: string[]): Promise<RagmirCommand>;
export declare const kbCommand: typeof ragmirCommand;
//# sourceMappingURL=package-manager.d.ts.map