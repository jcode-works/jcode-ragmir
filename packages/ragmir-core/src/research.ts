import { readFile } from "node:fs/promises"
import path from "node:path"
import type { Connection } from "@lancedb/lancedb"
import fg from "fast-glob"
import { recordAccess } from "./access-log.js"
import { loadConfig } from "./config.js"
import { countSkippedByReason, DEFAULT_FAST_GLOB_IGNORES, isSensitiveFilePath } from "./files.js"
import { audit } from "./ingest.js"
import { operationSignal, throwIfAborted } from "./operation.js"
import { searchWithConfig } from "./query.js"
import { redactText } from "./redaction.js"
import { securityAudit } from "./security.js"
import { normalizeForMatch } from "./text.js"
import type {
  CodeEvidence,
  CompactSearchResult,
  Config,
  ResearchEvidence,
  ResearchOptions,
  ResearchReport,
  SearchResult,
} from "./types.js"

const DEFAULT_RESEARCH_QUERY_LIMIT = 5
const DEFAULT_CODE_EVIDENCE_LIMIT = 20
const CODE_EVIDENCE_CANDIDATE_MULTIPLIER = 5
const COMPACT_SNIPPET_LENGTH = 260
const CODE_SCAN_MAX_BYTES = 256_000
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
])
const CODE_SCAN_IGNORE = [
  ...DEFAULT_FAST_GLOB_IGNORES,
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
]

export async function research(
  query: string,
  options: ResearchOptions = {},
): Promise<ResearchReport> {
  const config = await loadConfig(String(options.cwd ?? process.cwd()))
  return researchWithConfig(query, options, config)
}

export async function researchWithConfig(
  query: string,
  options: ResearchOptions,
  config: Config,
  connection?: Connection,
): Promise<ResearchReport> {
  const signal = operationSignal(options)
  throwIfAborted(signal)
  const normalizedQuery = query.trim()
  if (!normalizedQuery) {
    throw new Error("Research query must not be empty.")
  }
  const topK = options.topK ?? config.topK
  const [auditReport, securityReport] = await Promise.all([
    audit(config.projectRoot),
    securityAudit(config.projectRoot),
  ])
  throwIfAborted(signal)
  const generatedQueries = researchQueries(normalizedQuery)
  const includeCode = config.privacyProfile === "strict" ? false : options.includeCode !== false
  const perQueryTopK = Math.max(2, Math.ceil(topK / 2))
  const searchResults = await Promise.all(
    generatedQueries.map(async (generatedQuery) => ({
      query: generatedQuery,
      results: await searchWithConfig(
        generatedQuery,
        {
          cwd: config.projectRoot,
          topK: perQueryTopK,
          ...(options.includePaths ? { includePaths: options.includePaths } : {}),
          ...(options.excludePaths ? { excludePaths: options.excludePaths } : {}),
          ...(options.contextPaths ? { contextPaths: options.contextPaths } : {}),
        },
        config,
        connection,
        signal,
      ),
    })),
  )
  throwIfAborted(signal)
  const evidence = mergeEvidence(searchResults).slice(0, topK)
  const codeEvidence = !includeCode
    ? []
    : await findCodeEvidence(config, normalizedQuery, DEFAULT_CODE_EVIDENCE_LIMIT, signal)
  throwIfAborted(signal)
  const unsupportedFiles = countSkippedByReason(auditReport.skippedFiles, "unsupported-extension")
  const oversizedFiles = countSkippedByReason(auditReport.skippedFiles, "oversized")
  const gaps = researchGaps({
    evidenceCount: evidence.length,
    codeEvidenceCount: codeEvidence.length,
    includeCode,
    missingFromIndex: auditReport.missingFromIndex.length,
    staleInIndex: auditReport.staleInIndex.length,
    emptyTextFiles: auditReport.emptyTextFiles.length,
    securityWarnings: securityReport.warnings.length,
    unsupportedFiles,
    oversizedFiles,
    duplicateCandidates: auditReport.sourceDiagnostics.duplicateCandidates.length,
    archiveCandidates: auditReport.sourceDiagnostics.archiveCandidates.length,
    mirrorCandidates: auditReport.sourceDiagnostics.mirrorCandidates.length,
  })

  await recordAccess(config, {
    action: "research",
    query: normalizedQuery,
    topK,
    resultCount: evidence.length,
  })

  return {
    query: normalizedQuery,
    generatedQueries,
    ready:
      evidence.length > 0 &&
      auditReport.missingFromIndex.length === 0 &&
      auditReport.staleInIndex.length === 0 &&
      auditReport.emptyTextFiles.length === 0 &&
      oversizedFiles === 0 &&
      securityReport.warnings.length === 0,
    audit: {
      supportedFiles: auditReport.supportedFiles.length,
      supportedBytes: auditReport.supportedBytes,
      largestFileBytes: auditReport.largestFileBytes,
      skippedFiles: auditReport.skippedFiles.length,
      unsupportedFiles,
      oversizedFiles,
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
  }
}

export function compactSearchResults(
  results: SearchResult[],
  maxLength = COMPACT_SNIPPET_LENGTH,
): CompactSearchResult[] {
  return results.map((result) => ({
    source: result.source,
    relativePath: result.relativePath,
    chunkIndex: result.chunkIndex,
    contextPath: result.contextPath,
    citation: result.citation,
    snippet: compactText(result.text, maxLength),
    distance: result.distance,
    lineStart: result.lineStart,
    lineEnd: result.lineEnd,
    pageStart: result.pageStart,
    pageEnd: result.pageEnd,
    ...(result.score === undefined ? {} : { score: result.score }),
  }))
}

export function compactResearchReport(report: ResearchReport): Omit<ResearchReport, "evidence"> & {
  evidence: Array<Omit<ResearchEvidence, "text"> & { snippet: string }>
} {
  return {
    ...report,
    evidence: report.evidence.map((evidence) => ({
      source: evidence.source,
      relativePath: evidence.relativePath,
      chunkIndex: evidence.chunkIndex,
      contextPath: evidence.contextPath,
      citation: evidence.citation,
      snippet: compactText(evidence.text),
      distance: evidence.distance,
      lineStart: evidence.lineStart,
      lineEnd: evidence.lineEnd,
      pageStart: evidence.pageStart,
      pageEnd: evidence.pageEnd,
      queries: evidence.queries,
    })),
  }
}

function researchQueries(query: string): string[] {
  const trimmed = query.trim()
  const queries = [
    trimmed,
    `${trimmed} scope requirements rules`,
    `${trimmed} actors permissions workflow status validation`,
    `${trimmed} dates deadlines planning risks blockers`,
    `${trimmed} integration API data model export dependencies`,
  ]
  return [...new Set(queries)].slice(0, DEFAULT_RESEARCH_QUERY_LIMIT)
}

function mergeEvidence(
  searchResults: Array<{ query: string; results: SearchResult[] }>,
): ResearchEvidence[] {
  const bySource = new Map<string, ResearchEvidence>()
  for (const searchResult of searchResults) {
    for (const result of searchResult.results) {
      const key = `${result.relativePath}\0${result.chunkIndex}`
      const existing = bySource.get(key)
      if (existing) {
        existing.queries.push(searchResult.query)
        continue
      }
      bySource.set(key, {
        source: result.source,
        relativePath: result.relativePath,
        chunkIndex: result.chunkIndex,
        contextPath: result.contextPath,
        citation: result.citation,
        text: result.text,
        distance: result.distance,
        lineStart: result.lineStart,
        lineEnd: result.lineEnd,
        pageStart: result.pageStart,
        pageEnd: result.pageEnd,
        queries: [searchResult.query],
      })
    }
  }
  return [...bySource.values()]
}

async function findCodeEvidence(
  config: Config,
  query: string,
  limit: number,
  signal: AbortSignal | undefined,
): Promise<CodeEvidence[]> {
  throwIfAborted(signal)
  const terms = meaningfulTerms(query)
  if (terms.length === 0) {
    return []
  }
  const ignore = [...CODE_SCAN_IGNORE, ...projectRelativeIgnores(config)]
  const minimumMatchedTerms = terms.length === 1 ? 1 : 2
  const candidateLimit = Math.max(limit, limit * CODE_EVIDENCE_CANDIDATE_MULTIPLIER)
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
  })) as Array<{ path: string; stats?: { size: number } }>
  const candidates: CodeEvidence[] = []

  for (const entry of entries) {
    throwIfAborted(signal)
    if (candidates.length >= candidateLimit) {
      break
    }
    const absolutePath = path.isAbsolute(entry.path)
      ? entry.path
      : path.resolve(config.projectRoot, entry.path)
    if (
      !isScannableCodePath(absolutePath) ||
      isSensitiveFilePath(absolutePath) ||
      (entry.stats?.size ?? 0) > CODE_SCAN_MAX_BYTES
    ) {
      continue
    }
    const relativePath = path.relative(config.projectRoot, absolutePath)
    const content = await readFile(absolutePath, "utf8").catch(() => null)
    throwIfAborted(signal)
    if (content === null) {
      continue
    }
    for (const [index, line] of content.split(/\r?\n/u).entries()) {
      const normalizedLine = normalizeForMatch(line)
      const matchedTerms = terms.filter((term) => normalizedLine.includes(term))
      if (matchedTerms.length < minimumMatchedTerms) {
        continue
      }
      const redactedSnippet = redactText(line.trim(), config).text
      candidates.push({
        relativePath,
        lineNumber: index + 1,
        snippet: redactedSnippet.slice(0, COMPACT_SNIPPET_LENGTH),
        matchedTerms,
      })
      break
    }
  }

  return candidates.sort(compareCodeEvidence).slice(0, limit)
}

function compareCodeEvidence(a: CodeEvidence, b: CodeEvidence): number {
  return (
    b.matchedTerms.length - a.matchedTerms.length ||
    a.relativePath.localeCompare(b.relativePath) ||
    a.lineNumber - b.lineNumber
  )
}

function projectRelativeIgnores(config: Config): string[] {
  return [config.rawDir, config.storageDir, config.embeddingModelPath]
    .map((absolutePath) => path.relative(config.projectRoot, absolutePath))
    .filter((relativePath) => relativePath && !relativePath.startsWith(".."))
    .map((relativePath) => `${relativePath}/**`)
}

function isScannableCodePath(absolutePath: string): boolean {
  const extension = path.extname(absolutePath).toLowerCase()
  return CODE_SCAN_EXTENSIONS.has(extension)
}

function meaningfulTerms(query: string): string[] {
  return [
    ...new Set(
      normalizeForMatch(query)
        .match(/[\p{L}\p{N}]{3,}/gu)
        ?.filter((term) => !STOP_WORDS.has(term)) ?? [],
    ),
  ].slice(0, 8)
}

function researchGaps(input: {
  evidenceCount: number
  codeEvidenceCount: number
  includeCode: boolean
  missingFromIndex: number
  staleInIndex: number
  emptyTextFiles: number
  securityWarnings: number
  unsupportedFiles: number
  oversizedFiles: number
  duplicateCandidates: number
  archiveCandidates: number
  mirrorCandidates: number
}): string[] {
  const gaps: string[] = []
  if (input.evidenceCount === 0) {
    gaps.push("No retrieved evidence matched the research query.")
  }
  if (input.includeCode && input.codeEvidenceCount === 0) {
    gaps.push("No code evidence matched the research query.")
  }
  if (input.missingFromIndex > 0) {
    gaps.push(`${input.missingFromIndex} supported source files are missing from the index.`)
  }
  if (input.staleInIndex > 0) {
    gaps.push(`${input.staleInIndex} indexed source files are stale.`)
  }
  if (input.emptyTextFiles > 0) {
    gaps.push(`${input.emptyTextFiles} supported source files produced no indexable text.`)
  }
  if (input.securityWarnings > 0) {
    gaps.push(`${input.securityWarnings} security warnings require review.`)
  }
  if (input.unsupportedFiles > 0) {
    gaps.push(
      `${input.unsupportedFiles} source files were skipped because their type is unsupported.`,
    )
  }
  if (input.oversizedFiles > 0) {
    gaps.push(`${input.oversizedFiles} source files exceeded maxFileBytes and were skipped.`)
  }
  if (input.duplicateCandidates > 0) {
    gaps.push(
      `${input.duplicateCandidates} possible duplicate source groups need source-truth review.`,
    )
  }
  if (input.archiveCandidates > 0 || input.mirrorCandidates > 0) {
    gaps.push("Some source paths look like archives, exports, raw files, or drive mirrors.")
  }
  return gaps
}

function researchNextSteps(gaps: string[]): string[] {
  if (gaps.length === 0) {
    return [
      "Use the cited evidence as grounded context for an AI agent or reviewer.",
      "Run targeted searches for names, dates, amounts, and decisions before high-stakes conclusions.",
    ]
  }
  return gaps.map((gap) => {
    if (gap.includes("missing") || gap.includes("stale")) {
      return "Run `rgr doctor --fix`, then rerun `rgr research`."
    }
    if (gap.includes("unsupported") || gap.includes("maxFileBytes")) {
      return "Run `rgr audit --unsupported` and transcribe, OCR, convert, or explicitly configure unsupported formats."
    }
    if (gap.includes("indexable text")) {
      return "Configure local OCR, convert the affected files, or add extracted text, then re-ingest."
    }
    if (gap.includes("duplicate") || gap.includes("archive") || gap.includes("mirror")) {
      return "Review source diagnostics and prefer the canonical source before presenting conclusions."
    }
    if (gap.includes("code evidence")) {
      return "Run repository-aware code search to compare documents with implementation."
    }
    return "Add or refresh source documents, then rerun the research command."
  })
}

function compactText(text: string, maxLength = COMPACT_SNIPPET_LENGTH): string {
  const normalized = text.replace(/\s+/gu, " ").trim()
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
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
])
