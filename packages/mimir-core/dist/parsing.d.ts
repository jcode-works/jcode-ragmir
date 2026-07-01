import type { ParsedDocument, SourceFile } from "./types.js";
export interface ParseFileOptions {
    projectRoot?: string;
    pdfOcrCommand?: string[];
    pdfOcrTimeoutMs?: number;
    imageOcrCommand?: string[];
    imageOcrTimeoutMs?: number;
    legacyWordCommand?: string[];
    legacyWordTimeoutMs?: number;
}
export declare function parseFile(file: SourceFile, options?: ParseFileOptions): Promise<ParsedDocument>;
//# sourceMappingURL=parsing.d.ts.map