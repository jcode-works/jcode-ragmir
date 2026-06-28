export type PackageManager = "pnpm" | "npm" | "yarn" | "bun";
export interface KbCommand {
    packageManager: PackageManager;
    command: string;
    args: string[];
    display: string;
}
export declare function detectPackageManager(cwd?: string): Promise<PackageManager>;
export declare function kbCommand(cwd: string, args: string[]): Promise<KbCommand>;
//# sourceMappingURL=package-manager.d.ts.map