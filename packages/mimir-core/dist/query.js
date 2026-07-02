import { recordAccess } from "./access-log.js";
import { loadConfig } from "./config.js";
import { embedText } from "./embeddings.js";
import { openRowsTable } from "./store.js";
import { normalizeForMatch, tokenize } from "./text.js";
const MIN_VECTOR_CANDIDATES = 80;
const VECTOR_CANDIDATE_MULTIPLIER = 4;
const HYBRID_TEXT_SCAN_LIMIT = 5_000;
const VECTOR_SCORE_WEIGHT = 0.55;
const LEXICAL_SCORE_WEIGHT = 0.45;
const EXACT_QUERY_BOOST = 0.15;
const BM25_K1 = 1.2;
const BM25_B = 0.75;
export async function search(query, options = {}) {
    const config = await loadConfig(String(options.cwd ?? process.cwd()));
    const table = await openRowsTable(config);
    if (!table) {
        return [];
    }
    const topK = options.topK ?? config.topK;
    const vector = await embedText(query, config);
    const vectorRows = (await table
        .vectorSearch(vector)
        .limit(vectorCandidateLimit(topK))
        .toArray());
    const textRows = (await table.query().limit(HYBRID_TEXT_SCAN_LIMIT).toArray());
    const rows = rankHybridRows(query, vectorRows, textRows).slice(0, topK);
    const results = rows.map((row) => ({
        source: row.row.source,
        relativePath: row.row.relativePath,
        chunkIndex: row.row.chunkIndex,
        text: row.row.text,
        distance: typeof row.row._distance === "number" ? row.row._distance : null,
    }));
    await recordAccess(config, {
        action: "search",
        query,
        topK,
        resultCount: results.length,
    });
    return results;
}
export function vectorCandidateLimit(topK) {
    return Math.max(MIN_VECTOR_CANDIDATES, topK * VECTOR_CANDIDATE_MULTIPLIER);
}
export async function ask(query, options = {}) {
    const config = await loadConfig(String(options.cwd ?? process.cwd()));
    const sources = await search(query, options);
    if (sources.length === 0) {
        return {
            answer: "No relevant passages were found. Add documents and run `mimir doctor --fix` first.",
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
function rankHybridRows(query, vectorRows, textRows) {
    const queryTokens = tokenize(query);
    const rows = mergeRows(vectorRows, textRows);
    const vectorScores = new Map();
    for (const row of vectorRows) {
        vectorScores.set(rowKey(row), vectorScore(row));
    }
    const lexicalScores = bm25Scores(queryTokens, rows);
    const maxVectorScore = Math.max(...vectorScores.values(), 0);
    const maxLexicalScore = Math.max(...lexicalScores.values(), 0);
    const normalizedQuery = normalizeForMatch(query);
    return rows
        .map((row) => {
        const key = rowKey(row);
        const vector = normalizeScore(vectorScores.get(key) ?? 0, maxVectorScore);
        const lexical = normalizeScore(lexicalScores.get(key) ?? 0, maxLexicalScore);
        const exactBoost = normalizedQuery.length > 0 && normalizeForMatch(row.text).includes(normalizedQuery)
            ? EXACT_QUERY_BOOST
            : 0;
        return {
            row,
            vectorScore: vector,
            lexicalScore: lexical,
            combinedScore: vector * VECTOR_SCORE_WEIGHT + lexical * LEXICAL_SCORE_WEIGHT + exactBoost,
        };
    })
        .filter((ranked) => ranked.combinedScore > 0)
        .sort((a, b) => {
        const scoreDelta = b.combinedScore - a.combinedScore;
        if (scoreDelta !== 0) {
            return scoreDelta;
        }
        const distanceDelta = rowDistance(a.row) - rowDistance(b.row);
        if (Number.isFinite(distanceDelta) && distanceDelta !== 0) {
            return distanceDelta;
        }
        return (a.row.relativePath.localeCompare(b.row.relativePath) || a.row.chunkIndex - b.row.chunkIndex);
    });
}
function mergeRows(vectorRows, textRows) {
    const rows = new Map();
    for (const row of textRows) {
        rows.set(rowKey(row), row);
    }
    for (const row of vectorRows) {
        rows.set(rowKey(row), row);
    }
    return [...rows.values()];
}
function bm25Scores(queryTokens, rows) {
    const scores = new Map();
    if (queryTokens.length === 0 || rows.length === 0) {
        return scores;
    }
    const uniqueQueryTokens = [...new Set(queryTokens)];
    const documents = rows.map((row) => {
        const tokens = tokenize(row.text);
        const frequencies = new Map();
        for (const token of tokens) {
            frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
        }
        return { row, tokens, frequencies };
    });
    const averageLength = documents.reduce((sum, document) => sum + document.tokens.length, 0) / documents.length || 1;
    const documentFrequencies = new Map();
    for (const token of uniqueQueryTokens) {
        documentFrequencies.set(token, documents.filter((document) => document.frequencies.has(token)).length);
    }
    for (const document of documents) {
        let score = 0;
        for (const token of uniqueQueryTokens) {
            const frequency = document.frequencies.get(token) ?? 0;
            if (frequency === 0) {
                continue;
            }
            const documentFrequency = documentFrequencies.get(token) ?? 0;
            const inverseDocumentFrequency = Math.log(1 + (documents.length - documentFrequency + 0.5) / (documentFrequency + 0.5));
            const denominator = frequency + BM25_K1 * (1 - BM25_B + BM25_B * (document.tokens.length / averageLength));
            score += inverseDocumentFrequency * ((frequency * (BM25_K1 + 1)) / denominator);
        }
        if (score > 0) {
            scores.set(rowKey(document.row), score);
        }
    }
    return scores;
}
function vectorScore(row) {
    const distance = rowDistance(row);
    return 1 / (1 + distance);
}
function rowDistance(row) {
    return typeof row._distance === "number" && row._distance >= 0
        ? row._distance
        : Number.POSITIVE_INFINITY;
}
function normalizeScore(score, maxScore) {
    return maxScore > 0 ? score / maxScore : 0;
}
function rowKey(row) {
    return `${row.relativePath}\0${row.chunkIndex}`;
}
//# sourceMappingURL=query.js.map