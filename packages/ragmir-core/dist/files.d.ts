import type { Config, SkippedSourceFile, SkippedSourceReason, SourceFile, SourceInventory } from "./types.js";
export declare const OCR_IMAGE_EXTENSIONS: Set<string>;
export declare const DEFAULT_FAST_GLOB_IGNORES: string[];
export declare const DEFAULT_SUPPORTED_EXTENSIONS: Set<string>;
export declare function listSourceFiles(config: Config): Promise<SourceFile[]>;
export declare function inventorySourceFiles(config: Config): Promise<SourceInventory>;
export declare function supportedExtensions(config: Config): Set<string>;
export declare function summarizeUnsupportedExtensions(skippedFiles: SkippedSourceFile[]): Array<{
    extension: string;
    count: number;
}>;
export declare function isSensitiveFilePath(absolutePath: string): boolean;
export declare function countSkippedByReason(files: Array<{
    reason: SkippedSourceReason;
}>, reason: SkippedSourceReason): number;
//# sourceMappingURL=files.d.ts.map