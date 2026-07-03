export interface SourceEntriesResult {
    sourcesFile: string;
    entries: string[];
}
export interface AddSourceEntriesOptions {
    cwd?: string;
    entries: readonly string[];
}
export interface AddSourceEntriesResult {
    sourcesFile: string;
    added: string[];
    skipped: string[];
}
export declare function listSourceEntries(cwd?: string): Promise<SourceEntriesResult>;
export declare function addSourceEntries(options: AddSourceEntriesOptions): Promise<AddSourceEntriesResult>;
//# sourceMappingURL=sources.d.ts.map