import { recordAccess } from "./access-log.js";
import { chunkDocument } from "./chunking.js";
import { loadConfig } from "./config.js";
import { embedTexts } from "./embeddings.js";
import { inventorySourceFiles, summarizeUnsupportedExtensions } from "./files.js";
import { parseFile } from "./parsing.js";
import { redactText, totalRedactions } from "./redaction.js";
import { openRowsTable, writeRows } from "./store.js";
const MAX_AUDIT_ROWS = 100_000;
export async function ingest(options = {}) {
    const config = await loadConfig(String(options.cwd ?? process.cwd()));
    const inventory = await inventorySourceFiles(config);
    const files = inventory.supportedFiles;
    const allChunks = [];
    const errors = [];
    const redactionCounts = [];
    let emptyFiles = 0;
    const results = await mapLimit(files, config.ingestConcurrency, async (file) => {
        try {
            const parsed = await parseFile(file);
            const redacted = redactText(parsed.text, config);
            const chunks = chunkDocument({ ...parsed, text: redacted.text }, config.chunkSize, config.chunkOverlap);
            return { chunks, redactions: redacted.counts, error: null };
        }
        catch (error) {
            return {
                chunks: [],
                redactions: [],
                error: {
                    path: file.relativePath,
                    message: error instanceof Error ? error.message : String(error),
                },
            };
        }
    });
    for (const result of results) {
        if (result.error) {
            errors.push(result.error);
            continue;
        }
        redactionCounts.push(...result.redactions);
        if (result.chunks.length === 0) {
            emptyFiles += 1;
        }
        allChunks.push(...result.chunks);
    }
    const rows = [];
    for (let i = 0; i < allChunks.length; i += config.embeddingBatchSize) {
        const batch = allChunks.slice(i, i + config.embeddingBatchSize);
        const embeddings = await embedTexts(batch.map((chunk) => chunk.text), config);
        for (const [index, chunk] of batch.entries()) {
            const vector = embeddings[index];
            if (!vector) {
                throw new Error(`Missing embedding for chunk ${chunk.relativePath}#${chunk.chunkIndex}.`);
            }
            rows.push({ ...chunk, vector });
        }
    }
    await writeRows(rows, config);
    await recordAccess(config, {
        action: "ingest",
        resultCount: rows.length,
        redactions: totalRedactions(redactionCounts),
    });
    return {
        indexedFiles: new Set(rows.map((row) => row.relativePath)).size,
        chunks: rows.length,
        discoveredFiles: inventory.discoveredFiles,
        supportedFiles: files.length,
        skippedFiles: inventory.skippedFiles.length + emptyFiles,
        unsupportedFiles: countSkipped(inventory.skippedFiles, "unsupported-extension"),
        oversizedFiles: countSkipped(inventory.skippedFiles, "oversized"),
        sensitiveFiles: countSkipped(inventory.skippedFiles, "sensitive-name"),
        unsupportedExtensions: summarizeUnsupportedExtensions(inventory.skippedFiles),
        redactions: totalRedactions(redactionCounts),
        errors,
    };
}
export async function audit(cwd = process.cwd()) {
    const config = await loadConfig(cwd);
    const inventory = await inventorySourceFiles(config);
    const files = inventory.supportedFiles;
    const supportedFiles = files.map((file) => file.relativePath);
    const table = await openRowsTable(config);
    if (!table) {
        return {
            indexedFiles: [],
            supportedFiles,
            skippedFiles: inventory.skippedFiles,
            unsupportedExtensions: summarizeUnsupportedExtensions(inventory.skippedFiles),
            missingFromIndex: supportedFiles,
            staleInIndex: [],
            totalChunks: 0,
        };
    }
    const rows = (await table.query().limit(MAX_AUDIT_ROWS).toArray());
    const counts = new Map();
    const checksums = new Map();
    for (const row of rows) {
        counts.set(row.relativePath, (counts.get(row.relativePath) ?? 0) + 1);
        if (row.checksum) {
            const fileChecksums = checksums.get(row.relativePath) ?? new Set();
            fileChecksums.add(row.checksum);
            checksums.set(row.relativePath, fileChecksums);
        }
    }
    const supportedSet = new Set(supportedFiles);
    const indexedSet = new Set(counts.keys());
    const currentChecksums = new Map(files.map((file) => [file.relativePath, file.checksum]));
    return {
        indexedFiles: [...counts.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([source, chunks]) => ({ source, chunks })),
        supportedFiles,
        skippedFiles: inventory.skippedFiles,
        unsupportedExtensions: summarizeUnsupportedExtensions(inventory.skippedFiles),
        missingFromIndex: supportedFiles.filter((file) => !indexedSet.has(file)),
        staleInIndex: [...indexedSet]
            .filter((file) => {
            if (!supportedSet.has(file)) {
                return true;
            }
            const currentChecksum = currentChecksums.get(file);
            const indexedChecksums = checksums.get(file);
            return !currentChecksum || !indexedChecksums?.has(currentChecksum);
        })
            .sort(),
        totalChunks: rows.length,
    };
}
async function mapLimit(items, concurrency, worker) {
    const results = new Array(items.length);
    let nextIndex = 0;
    async function run() {
        while (nextIndex < items.length) {
            const index = nextIndex;
            nextIndex += 1;
            const item = items[index];
            if (item !== undefined) {
                results[index] = await worker(item);
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
    return results;
}
function countSkipped(files, reason) {
    return files.filter((file) => file.reason === reason).length;
}
//# sourceMappingURL=ingest.js.map