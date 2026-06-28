import { recordAccess } from "./access-log.js";
import { loadConfig } from "./config.js";
import { embedText } from "./embeddings.js";
import { openRowsTable } from "./store.js";
export async function search(query, options = {}) {
    const config = await loadConfig(String(options.cwd ?? process.cwd()));
    const table = await openRowsTable(config);
    if (!table) {
        return [];
    }
    const vector = await embedText(query, config);
    const rows = (await table
        .vectorSearch(vector)
        .limit(options.topK ?? config.topK)
        .toArray());
    const results = rows.map((row) => ({
        source: row.source,
        relativePath: row.relativePath,
        chunkIndex: row.chunkIndex,
        text: row.text,
        distance: typeof row._distance === "number" ? row._distance : null,
    }));
    await recordAccess(config, {
        action: "search",
        query,
        topK: options.topK ?? config.topK,
        resultCount: results.length,
    });
    return results;
}
export async function ask(query, options = {}) {
    const config = await loadConfig(String(options.cwd ?? process.cwd()));
    const sources = await search(query, options);
    if (sources.length === 0) {
        return {
            answer: "No relevant passages were found. Add documents and run `kb ingest` first.",
            sources,
        };
    }
    await recordAccess(config, {
        action: "ask",
        query,
        topK: options.topK ?? config.topK,
        resultCount: sources.length,
    });
    return {
        answer: retrievalOnlyAnswer(sources),
        sources,
    };
}
function retrievalOnlyAnswer(sources) {
    const snippets = sources
        .map((source, index) => {
        const text = source.text.replace(/\s+/gu, " ").trim();
        return `[${index + 1}] ${source.relativePath}#${source.chunkIndex}: ${text}`;
    })
        .join("\n\n");
    return [
        "Mimir returns retrieval context only. Use these passages as grounded context for your agent or LLM:",
        "",
        snippets,
    ].join("\n");
}
//# sourceMappingURL=query.js.map