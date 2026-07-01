import type { CompactSearchResult, ResearchEvidence, ResearchOptions, ResearchReport, SearchResult } from "./types.js";
export declare function research(query: string, options?: ResearchOptions): Promise<ResearchReport>;
export declare function compactSearchResults(results: SearchResult[], maxLength?: number): CompactSearchResult[];
export declare function compactResearchReport(report: ResearchReport): Omit<ResearchReport, "evidence"> & {
    evidence: Array<Omit<ResearchEvidence, "text"> & {
        snippet: string;
    }>;
};
//# sourceMappingURL=research.d.ts.map