import { readFile } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { recordAccess } from "./access-log.js";
import { loadConfig } from "./config.js";
import { audit } from "./ingest.js";
import { search } from "./query.js";
import { redactText } from "./redaction.js";
import { securityAudit } from "./security.js";
const DEFAULT_RESEARCH_QUERY_LIMIT = 5;
const DEFAULT_CODE_EVIDENCE_LIMIT = 20;
const CODE_EVIDENCE_CANDIDATE_MULTIPLIER = 5;
const COMPACT_SNIPPET_LENGTH = 260;
const CODE_SCAN_MAX_BYTES = 256_000;
const CODE_SCAN_EXTENSIONS = new Set([
    ".c",
    ".cjs",
    ".cpp",
    ".cs",
    ".go",
    ".java",
    ".js",
    ".json",
    ".jsonl",
    ".jsx",
    ".kt",
    ".md",
    ".mdx",
    ".mjs",
    ".mts",
    ".php",
    ".py",
    ".rb",
    ".rs",
    ".sql",
    ".txt",
    ".ts",
    ".tsx",
    ".vue",
    ".yaml",
    ".yml",
]);
const CODE_SCAN_IGNORE = [
    "**/.git/**",
    "**/.mimir/**",
    "**/.kb/**",
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/.next/**",
    "**/coverage/**",
    "**/release-artifacts/**",
    "**/bun.lock",
    "**/bun.lockb",
    "**/Cargo.lock",
    "**/composer.lock",
    "**/Gemfile.lock",
    "**/go.sum",
    "**/npm-shrinkwrap.json",
    "**/package-lock.json",
    "**/Pipfile.lock",
    "**/pnpm-lock.yaml",
    "**/poetry.lock",
    "**/yarn.lock",
];
export async function research(query, options = {}) {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
        throw new Error("Research query must not be empty.");
    }
    const config = await loadConfig(String(options.cwd ?? process.cwd()));
    const topK = options.topK ?? config.topK;
    const [auditReport, securityReport] = await Promise.all([
        audit(config.projectRoot),
        securityAudit(config.projectRoot),
    ]);
    const generatedQueries = researchQueries(normalizedQuery);
    const perQueryTopK = Math.max(2, Math.ceil(topK / 2));
    const searchResults = await Promise.all(generatedQueries.map(async (generatedQuery) => ({
        query: generatedQuery,
        results: await search(generatedQuery, { cwd: config.projectRoot, topK: perQueryTopK }),
    })));
    const evidence = mergeEvidence(searchResults).slice(0, topK);
    const codeEvidence = options.includeCode === false
        ? []
        : await findCodeEvidence(config, normalizedQuery, DEFAULT_CODE_EVIDENCE_LIMIT);
    const unsupportedFiles = auditReport.skippedFiles.filter((file) => file.reason === "unsupported-extension").length;
    const gaps = researchGaps({
        evidenceCount: evidence.length,
        codeEvidenceCount: codeEvidence.length,
        includeCode: options.includeCode !== false,
        missingFromIndex: auditReport.missingFromIndex.length,
        staleInIndex: auditReport.staleInIndex.length,
        securityWarnings: securityReport.warnings.length,
        unsupportedFiles,
        duplicateCandidates: auditReport.sourceDiagnostics.duplicateCandidates.length,
        archiveCandidates: auditReport.sourceDiagnostics.archiveCandidates.length,
        mirrorCandidates: auditReport.sourceDiagnostics.mirrorCandidates.length,
    });
    await recordAccess(config, {
        action: "research",
        query: normalizedQuery,
        topK,
        resultCount: evidence.length,
    });
    return {
        query: normalizedQuery,
        generatedQueries,
        ready: evidence.length > 0 &&
            auditReport.missingFromIndex.length === 0 &&
            auditReport.staleInIndex.length === 0 &&
            securityReport.warnings.length === 0,
        audit: {
            supportedFiles: auditReport.supportedFiles.length,
            skippedFiles: auditReport.skippedFiles.length,
            unsupportedFiles,
            indexedFiles: auditReport.indexedFiles.length,
            totalChunks: auditReport.totalChunks,
            missingFromIndex: auditReport.missingFromIndex.length,
            staleInIndex: auditReport.staleInIndex.length,
            emptyTextFiles: auditReport.emptyTextFiles.length,
        },
        securityWarnings: securityReport.warnings,
        sourceDiagnostics: auditReport.sourceDiagnostics,
        evidence,
        codeEvidence,
        gaps,
        nextSteps: researchNextSteps(gaps),
    };
}
export function compactSearchResults(results, maxLength = COMPACT_SNIPPET_LENGTH) {
    return results.map((result) => ({
        source: result.source,
        relativePath: result.relativePath,
        chunkIndex: result.chunkIndex,
        snippet: compactText(result.text, maxLength),
        distance: result.distance,
    }));
}
export function compactResearchReport(report) {
    return {
        ...report,
        evidence: report.evidence.map((evidence) => ({
            source: evidence.source,
            relativePath: evidence.relativePath,
            chunkIndex: evidence.chunkIndex,
            snippet: compactText(evidence.text),
            distance: evidence.distance,
            queries: evidence.queries,
        })),
    };
}
function researchQueries(query) {
    const trimmed = query.trim();
    const queries = [
        trimmed,
        `${trimmed} scope requirements rules`,
        `${trimmed} actors permissions workflow status validation`,
        `${trimmed} dates deadlines planning risks blockers`,
        `${trimmed} integration API data model export dependencies`,
    ];
    return [...new Set(queries)].slice(0, DEFAULT_RESEARCH_QUERY_LIMIT);
}
function mergeEvidence(searchResults) {
    const bySource = new Map();
    for (const searchResult of searchResults) {
        for (const result of searchResult.results) {
            const key = `${result.relativePath}\0${result.chunkIndex}`;
            const existing = bySource.get(key);
            if (existing) {
                existing.queries.push(searchResult.query);
                continue;
            }
            bySource.set(key, {
                source: result.source,
                relativePath: result.relativePath,
                chunkIndex: result.chunkIndex,
                text: result.text,
                distance: result.distance,
                queries: [searchResult.query],
            });
        }
    }
    return [...bySource.values()];
}
async function findCodeEvidence(config, query, limit) {
    const terms = meaningfulTerms(query);
    if (terms.length === 0) {
        return [];
    }
    const ignore = [...CODE_SCAN_IGNORE, ...projectRelativeIgnores(config)];
    const minimumMatchedTerms = terms.length === 1 ? 1 : 2;
    const candidateLimit = Math.max(limit, limit * CODE_EVIDENCE_CANDIDATE_MULTIPLIER);
    const entries = (await fg("**/*", {
        cwd: config.projectRoot,
        absolute: true,
        onlyFiles: true,
        dot: true,
        followSymbolicLinks: false,
        ignore,
        objectMode: true,
        stats: true,
        unique: true,
    }));
    const candidates = [];
    for (const entry of entries) {
        if (candidates.length >= candidateLimit) {
            break;
        }
        const absolutePath = path.isAbsolute(entry.path)
            ? entry.path
            : path.resolve(config.projectRoot, entry.path);
        if (!isScannableCodePath(absolutePath) || (entry.stats?.size ?? 0) > CODE_SCAN_MAX_BYTES) {
            continue;
        }
        const relativePath = path.relative(config.projectRoot, absolutePath);
        const content = await readFile(absolutePath, "utf8").catch(() => null);
        if (content === null) {
            continue;
        }
        for (const [index, line] of content.split(/\r?\n/u).entries()) {
            const normalizedLine = normalizeForMatch(line);
            const matchedTerms = terms.filter((term) => normalizedLine.includes(term));
            if (matchedTerms.length < minimumMatchedTerms) {
                continue;
            }
            const redactedSnippet = redactText(line.trim(), config).text;
            candidates.push({
                relativePath,
                lineNumber: index + 1,
                snippet: redactedSnippet.slice(0, COMPACT_SNIPPET_LENGTH),
                matchedTerms,
            });
            break;
        }
    }
    return candidates.sort(compareCodeEvidence).slice(0, limit);
}
function compareCodeEvidence(a, b) {
    return (b.matchedTerms.length - a.matchedTerms.length ||
        a.relativePath.localeCompare(b.relativePath) ||
        a.lineNumber - b.lineNumber);
}
function projectRelativeIgnores(config) {
    return [config.rawDir, config.storageDir, config.embeddingModelPath]
        .map((absolutePath) => path.relative(config.projectRoot, absolutePath))
        .filter((relativePath) => relativePath && !relativePath.startsWith(".."))
        .map((relativePath) => `${relativePath}/**`);
}
function isScannableCodePath(absolutePath) {
    const extension = path.extname(absolutePath).toLowerCase();
    return CODE_SCAN_EXTENSIONS.has(extension);
}
function meaningfulTerms(query) {
    return [
        ...new Set(normalizeForMatch(query)
            .match(/[\p{L}\p{N}]{3,}/gu)
            ?.filter((term) => !STOP_WORDS.has(term)) ?? []),
    ].slice(0, 8);
}
function researchGaps(input) {
    const gaps = [];
    if (input.evidenceCount === 0) {
        gaps.push("No retrieved evidence matched the research query.");
    }
    if (input.includeCode && input.codeEvidenceCount === 0) {
        gaps.push("No code evidence matched the research query.");
    }
    if (input.missingFromIndex > 0) {
        gaps.push(`${input.missingFromIndex} supported source files are missing from the index.`);
    }
    if (input.staleInIndex > 0) {
        gaps.push(`${input.staleInIndex} indexed source files are stale.`);
    }
    if (input.securityWarnings > 0) {
        gaps.push(`${input.securityWarnings} security warnings require review.`);
    }
    if (input.unsupportedFiles > 0) {
        gaps.push(`${input.unsupportedFiles} source files were skipped because their type is unsupported.`);
    }
    if (input.duplicateCandidates > 0) {
        gaps.push(`${input.duplicateCandidates} possible duplicate source groups need source-truth review.`);
    }
    if (input.archiveCandidates > 0 || input.mirrorCandidates > 0) {
        gaps.push("Some source paths look like archives, exports, raw files, or drive mirrors.");
    }
    return gaps;
}
function researchNextSteps(gaps) {
    if (gaps.length === 0) {
        return [
            "Use the cited evidence as grounded context for an AI agent or reviewer.",
            "Run targeted searches for names, dates, amounts, and decisions before high-stakes conclusions.",
        ];
    }
    return gaps.map((gap) => {
        if (gap.includes("missing") || gap.includes("stale")) {
            return "Run `mimir doctor --fix`, then rerun `mimir research`.";
        }
        if (gap.includes("unsupported")) {
            return "Run `mimir audit --unsupported` and transcribe, OCR, convert, or explicitly configure unsupported formats.";
        }
        if (gap.includes("duplicate") || gap.includes("archive") || gap.includes("mirror")) {
            return "Review source diagnostics and prefer the canonical source before presenting conclusions.";
        }
        if (gap.includes("code evidence")) {
            return "Run repository-aware code search to compare documents with implementation.";
        }
        return "Add or refresh source documents, then rerun the research command.";
    });
}
function compactText(text, maxLength = COMPACT_SNIPPET_LENGTH) {
    const normalized = text.replace(/\s+/gu, " ").trim();
    if (normalized.length <= maxLength) {
        return normalized;
    }
    return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}
function normalizeForMatch(text) {
    return text
        .toLowerCase()
        .normalize("NFKD")
        .replace(/\p{Diacritic}/gu, "");
}
const STOP_WORDS = new Set([
    "about",
    "avec",
    "dans",
    "des",
    "for",
    "les",
    "pour",
    "que",
    "qui",
    "sur",
    "the",
    "une",
    "what",
]);
//# sourceMappingURL=research.js.map