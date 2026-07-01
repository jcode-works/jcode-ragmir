export type PackageManager = "pnpm" | "npm" | "yarn" | "bun";
export interface MimirCommand {
    packageManager: PackageManager;
    command: string;
    args: string[];
    display: string;
}
export type KbCommand = MimirCommand;
export declare function detectPackageManager(cwd?: string): Promise<PackageManager>;
export declare function mimirCommand(cwd: string, args: string[]): Promise<MimirCommand>;
export declare const kbCommand: typeof mimirCommand;
//# sourceMappingURL=package-manager.d.ts.map