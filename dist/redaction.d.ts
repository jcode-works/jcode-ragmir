import type { Config, RedactionCount } from "./types.js";
export declare function redactText(input: string, config: Config): {
    text: string;
    counts: RedactionCount[];
};
export declare function totalRedactions(counts: RedactionCount[]): number;
//# sourceMappingURL=redaction.d.ts.map