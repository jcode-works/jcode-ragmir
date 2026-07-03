export declare function serveMcp(cwd?: string): Promise<void>;
export declare function resolveMcpProjectRoot(env?: NodeJS.ProcessEnv, fallback?: string): string;
export declare function searchOptions(cwd: string, topK: number | undefined): Promise<{
    cwd: string;
    topK?: number;
}>;
export declare function projectRelativeGoldenPath(cwd: string, goldenPath: string): string;
//# sourceMappingURL=mcp.d.ts.map