import type { Config, SkippedSourceFile, SourceFile, SourceInventory } from "./types.js";
export declare const DEFAULT_SUPPORTED_EXTENSIONS: Set<string>;
export declare function listSourceFiles(config: Config): Promise<SourceFile[]>;
export declare function inventorySourceFiles(config: Config): Promise<SourceInventory>;
export declare function supportedExtensions(config: Config): Set<string>;
export declare function summarizeUnsupportedExtensions(skippedFiles: SkippedSourceFile[]): Array<{
    extension: string;
    count: number;
}>;
//# sourceMappingURL=files.d.ts.map