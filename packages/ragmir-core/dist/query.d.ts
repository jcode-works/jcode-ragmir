import type { AskResult, SearchOptions, SearchResult } from "./types.js";
export declare function search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
export declare function vectorCandidateLimit(topK: number): number;
export declare function ask(query: string, options?: SearchOptions): Promise<AskResult>;
//# sourceMappingURL=query.d.ts.map