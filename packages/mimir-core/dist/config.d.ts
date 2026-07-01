import type { Config } from "./types.js";
interface ProjectConfigFile {
    projectRoot: string;
    configPath: string;
    legacy: boolean;
}
export declare function findProjectRoot(start?: string): string;
export declare function findProjectConfig(start?: string): ProjectConfigFile;
export declare function loadConfig(start?: string): Promise<Config>;
export {};
//# sourceMappingURL=config.d.ts.map