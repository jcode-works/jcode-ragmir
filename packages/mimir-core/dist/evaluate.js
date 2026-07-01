import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { recordAccess } from "./access-log.js";
import { loadConfig } from "./config.js";
import { search } from "./query.js";
const goldenQuerySchema = z
    .object({
    id: z.string().min(1).optional(),
    query: z.string().min(1),
    expectedPaths: z.array(z.string().min(1)).min(1),
    topK: z.number().int().positive().optional(),
})
    .strict();
const goldenFileSchema = z.union([
    z.array(goldenQuerySchema).min(1),
    z
        .object({
        topK: z.number().int().positive().optional(),
        queries: z.array(goldenQuerySchema).min(1),
    })
        .strict(),
]);
export async function evaluateGoldenQueries(options) {
    const cwd = path.resolve(String(options.cwd ?? process.cwd()));
    const config = await loadConfig(cwd);
    const goldenPath = path.resolve(cwd, String(options.goldenPath));
    const goldenFile = await readGoldenFile(goldenPath);
    const defaultTopK = boundedTopK(options.topK ?? goldenFile.topK ?? 3, options.maxTopK);
    const cases = [];
    for (const goldenQuery of goldenFile.queries) {
        const topK = boundedTopK(goldenQuery.topK ?? defaultTopK, options.maxTopK);
        const results = await search(goldenQuery.query, { cwd, topK });
        const returnedPaths = results.map((result) => result.relativePath);
        const matchedPaths = returnedPaths.filter((resultPath) => goldenQuery.expectedPaths.includes(resultPath));
        const bestRank = returnedPaths.findIndex((resultPath) => goldenQuery.expectedPaths.includes(resultPath)) + 1;
        const result = {
            query: goldenQuery.query,
            expectedPaths: goldenQuery.expectedPaths,
            topK,
            returnedPaths,
            matchedPaths,
            hit: matchedPaths.length > 0,
            bestRank: bestRank > 0 ? bestRank : null,
        };
        if (goldenQuery.id !== undefined) {
            result.id = goldenQuery.id;
        }
        cases.push(result);
    }
    const hits = cases.filter((result) => result.hit).length;
    await recordAccess(config, {
        action: "evaluate",
        topK: defaultTopK,
        resultCount: cases.length,
    });
    return {
        goldenPath,
        embeddingProvider: config.embeddingProvider,
        embeddingModel: config.embeddingModel,
        topK: defaultTopK,
        total: cases.length,
        hits,
        misses: cases.length - hits,
        recall: hits / cases.length,
        cases,
    };
}
async function readGoldenFile(goldenPath) {
    const raw = await readFile(goldenPath, "utf8");
    const parsed = goldenFileSchema.parse(JSON.parse(raw));
    if (Array.isArray(parsed)) {
        return { queries: parsed.map(normalizeGoldenQuery) };
    }
    const result = { queries: parsed.queries.map(normalizeGoldenQuery) };
    if (parsed.topK !== undefined) {
        return { ...result, topK: parsed.topK };
    }
    return result;
}
function normalizeGoldenQuery(value) {
    const result = {
        query: value.query,
        expectedPaths: value.expectedPaths,
    };
    if (value.id !== undefined) {
        result.id = value.id;
    }
    if (value.topK !== undefined) {
        result.topK = value.topK;
    }
    return result;
}
function boundedTopK(topK, maxTopK) {
    return maxTopK === undefined ? topK : Math.min(topK, maxTopK);
}
//# sourceMappingURL=evaluate.js.map