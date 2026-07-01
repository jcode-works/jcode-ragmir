import path from "node:path";
import { recordAccess } from "./access-log.js";
import { chunkDocument } from "./chunking.js";
import { loadConfig } from "./config.js";
import { embedTexts } from "./embeddings.js";
import { inventorySourceFiles, summarizeUnsupportedExtensions } from "./files.js";
import { parseFile } from "./parsing.js";
import { redactText, totalRedactions } from "./redaction.js";
import { openRowsTable, readEmptyTextFiles, readRows, writeEmptyTextFiles, writeRows, } from "./store.js";
const MAX_AUDIT_ROWS = 100_000;
const MAX_SOURCE_DIAGNOSTIC_ITEMS = 20;
const ARCHIVE_PATH_PATTERNS = [
    /(^|[/_-])archive(s)?([/_-]|$)/iu,
    /(^|[/_-])backup(s)?([/_-]|$)/iu,
    /(^|[/_-])legacy([/_-]|$)/iu,
    /(^|[/_-])old([/_-]|$)/iu,
    /(^|[/_-])obsolete([/_-]|$)/iu,
    /(^|[/_-])poc([/_-]|$)/iu,
];
const MIRROR_PATH_PATTERNS = [
    /(^|[/_-])raw[_-]?files([/_-]|$)/iu,
    /(^|[/_-])google[_-]?drive([/_-]|$)/iu,
    /(^|[/_-])drive[_-]?mirror([/_-]|$)/iu,
    /(^|[/_-])export(s)?([/_-]|$)/iu,
];
export async function ingest(options = {}) {
    const config = await loadConfig(String(options.cwd ?? process.cwd()));
    const inventory = await inventorySourceFiles(config);
    const files = inventory.supportedFiles;
    const currentFiles = new Map(files.map((file) => [file.relativePath, file]));
    const existingRows = options.rebuild ? [] : await readRows(config);
    const reusableRows = options.rebuild ? [] : reusableIndexRows(existingRows, currentFiles, config);
    const reusableFiles = new Set(reusableRows.map((row) => row.relativePath));
    const filesToIndex = options.rebuild
        ? files
        : files.filter((file) => !reusableFiles.has(file.relativePath));
    const allChunks = [];
    const errors = [];
    const redactionCounts = [];
    const emptyTextFiles = [];
    const results = await mapLimit(filesToIndex, config.ingestConcurrency, async (file) => {
        try {
            const parsed = await parseFile(file, config);
            const redacted = redactText(parsed.text, config);
            const chunks = chunkDocument({ ...parsed, text: redacted.text }, config.chunkSize, config.chunkOverlap);
            return { path: file.relativePath, chunks, redactions: redacted.counts, error: null };
        }
        catch (error) {
            return {
                path: file.relativePath,
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
            emptyTextFiles.push(result.path);
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
            rows.push({
                ...chunk,
                vector,
                embeddingProvider: config.embeddingProvider,
                embeddingModel: config.embeddingModel,
            });
        }
    }
    const indexRows = [...reusableRows, ...rows];
    await writeRows(indexRows, config);
    await writeEmptyTextFiles(emptyTextFiles.flatMap((relativePath) => {
        const file = currentFiles.get(relativePath);
        return file ? [{ relativePath, checksum: file.checksum }] : [];
    }), config);
    await recordAccess(config, {
        action: "ingest",
        resultCount: indexRows.length,
        redactions: totalRedactions(redactionCounts),
    });
    return {
        indexedFiles: new Set(indexRows.map((row) => row.relativePath)).size,
        rebuiltFiles: new Set(rows.map((row) => row.relativePath)).size,
        reusedFiles: reusableFiles.size,
        chunks: indexRows.length,
        discoveredFiles: inventory.discoveredFiles,
        supportedFiles: files.length,
        skippedFiles: inventory.skippedFiles.length + emptyTextFiles.length,
        unsupportedFiles: countSkipped(inventory.skippedFiles, "unsupported-extension"),
        oversizedFiles: countSkipped(inventory.skippedFiles, "oversized"),
        sensitiveFiles: countSkipped(inventory.skippedFiles, "sensitive-name"),
        emptyTextFiles,
        unsupportedExtensions: summarizeUnsupportedExtensions(inventory.skippedFiles),
        redactions: totalRedactions(redactionCounts),
        errors,
    };
}
function reusableIndexRows(rows, currentFiles, config) {
    const rowsByFile = new Map();
    for (const row of rows) {
        const fileRows = rowsByFile.get(row.relativePath) ?? [];
        fileRows.push(row);
        rowsByFile.set(row.relativePath, fileRows);
    }
    const reusableRows = [];
    for (const [relativePath, fileRows] of rowsByFile) {
        const file = currentFiles.get(relativePath);
        if (!file) {
            continue;
        }
        if (fileRows.every((row) => row.checksum === file.checksum &&
            row.embeddingProvider === config.embeddingProvider &&
            row.embeddingModel === config.embeddingModel)) {
            reusableRows.push(...fileRows);
        }
    }
    return reusableRows;
}
export async function audit(cwd = process.cwd()) {
    const config = await loadConfig(cwd);
    const inventory = await inventorySourceFiles(config);
    const files = inventory.supportedFiles;
    const supportedFiles = files.map((file) => file.relativePath);
    const table = await openRowsTable(config);
    const emptyTextFiles = await currentEmptyTextFiles(config, files);
    if (!table) {
        return {
            indexedFiles: [],
            supportedFiles,
            skippedFiles: inventory.skippedFiles,
            emptyTextFiles: [...emptyTextFiles],
            unsupportedExtensions: summarizeUnsupportedExtensions(inventory.skippedFiles),
            sourceDiagnostics: sourceDiagnostics(files, inventory.skippedFiles),
            missingFromIndex: supportedFiles.filter((file) => !emptyTextFiles.has(file)),
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
        emptyTextFiles: [...emptyTextFiles].sort(),
        unsupportedExtensions: summarizeUnsupportedExtensions(inventory.skippedFiles),
        sourceDiagnostics: sourceDiagnostics(files, inventory.skippedFiles),
        missingFromIndex: supportedFiles.filter((file) => !indexedSet.has(file) && !emptyTextFiles.has(file)),
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
function sourceDiagnostics(supportedFiles, skippedFiles) {
    const relativePaths = [
        ...supportedFiles.map((file) => file.relativePath),
        ...skippedFiles.map((file) => file.relativePath),
    ];
    return {
        duplicateCandidates: duplicateCandidates(supportedFiles),
        archiveCandidates: pathCandidates(relativePaths, ARCHIVE_PATH_PATTERNS, "archive-like path"),
        mirrorCandidates: pathCandidates(relativePaths, MIRROR_PATH_PATTERNS, "mirror-like path"),
    };
}
function duplicateCandidates(files) {
    const byChecksum = new Map();
    const byLogicalName = new Map();
    for (const file of files) {
        appendGrouped(byChecksum, `sha256:${file.checksum.slice(0, 12)}`, file.relativePath);
        const logicalName = normalizedLogicalName(file.relativePath);
        if (logicalName.length >= 6) {
            appendGrouped(byLogicalName, `name:${logicalName}`, file.relativePath);
        }
    }
    const exact = groupedDuplicates(byChecksum);
    const logical = groupedDuplicates(byLogicalName).filter((candidate) => !exact.some((exactCandidate) => candidate.files.every((file) => exactCandidate.files.includes(file))));
    return [...exact, ...logical]
        .sort((a, b) => b.files.length - a.files.length || a.key.localeCompare(b.key))
        .slice(0, MAX_SOURCE_DIAGNOSTIC_ITEMS);
}
function pathCandidates(relativePaths, patterns, reason) {
    return relativePaths
        .filter((relativePath) => patterns.some((pattern) => pattern.test(relativePath)))
        .sort((a, b) => a.localeCompare(b))
        .slice(0, MAX_SOURCE_DIAGNOSTIC_ITEMS)
        .map((relativePath) => ({ relativePath, reason }));
}
function appendGrouped(groups, key, relativePath) {
    const paths = groups.get(key) ?? [];
    paths.push(relativePath);
    groups.set(key, paths);
}
function groupedDuplicates(groups) {
    return [...groups.entries()]
        .filter(([, files]) => files.length > 1)
        .map(([key, files]) => ({ key, files: [...new Set(files)].sort() }));
}
function normalizedLogicalName(relativePath) {
    return path
        .basename(relativePath, path.extname(relativePath))
        .toLowerCase()
        .normalize("NFKD")
        .replace(/\p{Diacritic}/gu, "")
        .replace(/[^a-z0-9]+/gu, "");
}
async function currentEmptyTextFiles(config, files) {
    const currentChecksums = new Map(files.map((file) => [file.relativePath, file.checksum]));
    const emptyTextFiles = new Set();
    for (const record of await readEmptyTextFiles(config)) {
        if (currentChecksums.get(record.relativePath) === record.checksum) {
            emptyTextFiles.add(record.relativePath);
        }
    }
    return emptyTextFiles;
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