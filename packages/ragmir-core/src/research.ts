import { readFile } from "node:fs/promises"
import path from "node:path"
import type { Connection } from "@lancedb/lancedb"
import fg from "fast-glob"
import { recordAccess } from "./access-log.js"
import { loadConfig } from "./config.js"
import { RagmirError } from "./errors.js"
import { countSkippedByReason, DEFAULT_FAST_GLOB_IGNORES, isSensitiveFilePath } from "./files.js"
import { auditWithConfig } from "./ingest.js"
import { operationSignal, throwIfAborted } from "./operation.js"
import { searchWithConfig } from "./query.js"
import { redactText } from "./redaction.js"
import { securityAuditWithConfig } from "./security.js"
import { closeIndexReadSnapshot, type IndexReadSnapshot, loadIndexReadSnapshot } from "./store.js"
import { normalizeForMatch } from "./text.js"
import type {
  CodeEvidence,
  CompactSearchResult,
  Config,
  IndexManifest,
  ResearchEvidence,
  ResearchOptions,
  ResearchReport,
  SearchResult,
  SourceDiagnostics,
} from "./types.js"

const DEFAULT_RESEARCH_QUERY_LIMIT = 5
const DEFAULT_CODE_EVIDENCE_LIMIT = 20
const DEFAULT_CODE_SCAN_MAX_FILES = 1_000
const DEFAULT_CODE_SCAN_MAX_BYTES = 32 * 1024 * 1024
const DEFAULT_CODE_SCAN_CONCURRENCY = 4
const MAX_CODE_EVIDENCE_LIMIT = 100
const MAX_CODE_SCAN_FILES = 10_000
const MAX_CODE_SCAN_BYTES = 256 * 1024 * 1024
const MAX_CODE_SCAN_CONCURRENCY = 16
const COMPACT_SNIPPET_LENGTH = 260
const CODE_SCAN_MAX_BYTES = 256_000
const RESEARCH_RRF_K = 60
const PRIMARY_QUERY_WEIGHT_FACTOR = 2
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

interface ResearchBudget {
  codeTopK: number
  codeScanMaxFiles: number
  codeScanMaxBytes: number
  codeScanConcurrency: number
}

interface CodeScanEntry {
  absolutePath: string
  relativePath: string
  size: number
}

interface CodeScanResult {
  evidence: CodeEvidence[]
  filesScanned: number
  bytesScanned: number
  truncated: boolean
}

interface ResearchHealthSnapshot {
  indexAvailable: boolean
  audit: ResearchReport["audit"]
  securityWarnings: string[]
  sourceDiagnostics: SourceDiagnostics
}

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
  suppliedSnapshot?: IndexReadSnapshot,
): Promise<ResearchReport> {
  const signal = operationSignal(options)
  throwIfAborted(signal)
  const normalizedQuery = query.trim()
  if (!normalizedQuery) {
    throw new Error("Research query must not be empty.")
  }
  const topK = options.topK ?? config.topK
  const generatedQueries = researchQueries(normalizedQuery)
  const includeCode = config.privacyProfile === "strict" ? false : options.includeCode !== false
  const budget = researchBudget(options)
  const perQueryTopK = Math.max(2, Math.ceil(topK / 2))
  const ownsSnapshot = suppliedSnapshot === undefined
  const snapshot = suppliedSnapshot ?? (await loadIndexReadSnapshot(config, connection))
  try {
    throwIfAborted(signal)
    const [health, searchResults, codeScan] = await Promise.all([
      researchHealthSnapshot(config, options.fullAudit === true, snapshot.manifest, signal),
      Promise.all(
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
            snapshot,
          ),
        })),
      ),
      includeCode
        ? findCodeEvidence(config, normalizedQuery, budget, signal)
        : Promise.resolve(emptyCodeScan()),
    ])
    throwIfAborted(signal)
    const evidence = rankResearchEvidence(searchResults, normalizedQuery).slice(0, topK)
    const codeEvidence = codeScan.evidence
    const gaps = researchGaps({
      indexAvailable: health.indexAvailable,
      evidenceCount: evidence.length,
      codeEvidenceCount: codeEvidence.length,
      includeCode,
      missingFromIndex: health.audit.missingFromIndex,
      staleInIndex: health.audit.staleInIndex,
      emptyTextFiles: health.audit.emptyTextFiles,
      securityWarnings: health.securityWarnings.length,
      unsupportedFiles: health.audit.unsupportedFiles,
      oversizedFiles: health.audit.oversizedFiles,
      duplicateCandidates: health.sourceDiagnostics.duplicateCandidates.length,
      archiveCandidates: health.sourceDiagnostics.archiveCandidates.length,
      mirrorCandidates: health.sourceDiagnostics.mirrorCandidates.length,
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
        health.indexAvailable &&
        evidence.length > 0 &&
        health.audit.missingFromIndex === 0 &&
        health.audit.staleInIndex === 0 &&
        health.audit.emptyTextFiles === 0 &&
        health.audit.oversizedFiles === 0 &&
        health.securityWarnings.length === 0,
      audit: health.audit,
      securityWarnings: health.securityWarnings,
      sourceDiagnostics: health.sourceDiagnostics,
      evidence,
      codeEvidence,
      budgets: {
        timeoutMs: options.timeoutMs ?? null,
        evidenceTopK: topK,
        codeEvidenceTopK: budget.codeTopK,
        codeScanMaxFiles: budget.codeScanMaxFiles,
        codeScanMaxBytes: budget.codeScanMaxBytes,
        codeScanConcurrency: budget.codeScanConcurrency,
        codeFilesScanned: codeScan.filesScanned,
        codeBytesScanned: codeScan.bytesScanned,
        codeScanTruncated: codeScan.truncated,
      },
      gaps,
      nextSteps: researchNextSteps(gaps),
    }
  } finally {
    if (ownsSnapshot) {
      closeIndexReadSnapshot(snapshot, config)
    }
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
      bestRank: evidence.bestRank,
      researchScore: evidence.researchScore,
    })),
  }
}

function researchQueries(query: string): string[] {
  const trimmed = query.trim()
  const keywordQuery = meaningfulTerms(trimmed).join(" ")
  const queries = [
    trimmed,
    keywordQuery,
    ...researchSuffixes(trimmed).map((suffix) => `${trimmed} ${suffix}`),
  ].filter(Boolean)
  return [...new Set(queries)].slice(0, DEFAULT_RESEARCH_QUERY_LIMIT)
}

export function rankResearchEvidence(
  searchResults: Array<{ query: string; results: SearchResult[] }>,
  primaryQuery: string,
): ResearchEvidence[] {
  const canonicalResults = [...searchResults].sort((left, right) =>
    compareResearchQueries(left.query, right.query, primaryQuery),
  )
  const primaryWeight = Math.max(1, canonicalResults.length * PRIMARY_QUERY_WEIGHT_FACTOR)
  const bySource = new Map<
    string,
    {
      result: SearchResult
      resultQuery: string
      resultRank: number
      queryRanks: Map<string, number>
      researchScore: number
    }
  >()
  for (const searchResult of canonicalResults) {
    const weight = searchResult.query === primaryQuery ? primaryWeight : 1
    for (const [index, result] of searchResult.results.entries()) {
      const key = `${result.relativePath}\0${result.chunkIndex}`
      const rank = index + 1
      const existing = bySource.get(key)
      if (existing) {
        existing.queryRanks.set(
          searchResult.query,
          Math.min(existing.queryRanks.get(searchResult.query) ?? rank, rank),
        )
        existing.researchScore += weight / (RESEARCH_RRF_K + rank)
        if (
          compareResearchResultChoice(
            searchResult.query,
            rank,
            existing.resultQuery,
            existing.resultRank,
            primaryQuery,
          ) < 0
        ) {
          existing.result = result
          existing.resultQuery = searchResult.query
          existing.resultRank = rank
        }
        continue
      }
      bySource.set(key, {
        result,
        resultQuery: searchResult.query,
        resultRank: rank,
        queryRanks: new Map([[searchResult.query, rank]]),
        researchScore: weight / (RESEARCH_RRF_K + rank),
      })
    }
  }
  return [...bySource.values()]
    .map(({ result, queryRanks, researchScore }) => ({
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
      queries: [...queryRanks.keys()].sort((left, right) =>
        compareResearchQueries(left, right, primaryQuery),
      ),
      bestRank: Math.min(...queryRanks.values()),
      researchScore: Number(researchScore.toFixed(12)),
    }))
    .sort(compareResearchEvidence)
}

async function researchHealthSnapshot(
  config: Config,
  fullAudit: boolean,
  manifest: Readonly<IndexManifest> | null,
  signal: AbortSignal | undefined,
): Promise<ResearchHealthSnapshot> {
  const operationOptions = signal ? { signal } : {}
  if (fullAudit) {
    const [auditReport, securityReport] = await Promise.all([
      auditWithConfig(config, operationOptions),
      securityAuditWithConfig(config, operationOptions),
    ])
    throwIfAborted(signal)
    return {
      indexAvailable: manifest !== null,
      audit: {
        mode: "full",
        inventoryVerified: true,
        supportedFiles: auditReport.supportedFiles.length,
        supportedBytes: auditReport.supportedBytes,
        largestFileBytes: auditReport.largestFileBytes,
        skippedFiles: auditReport.skippedFiles.length,
        unsupportedFiles: countSkippedByReason(auditReport.skippedFiles, "unsupported-extension"),
        oversizedFiles: countSkippedByReason(auditReport.skippedFiles, "oversized"),
        indexedFiles: auditReport.indexedFiles.length,
        totalChunks: auditReport.totalChunks,
        missingFromIndex: auditReport.missingFromIndex.length,
        staleInIndex: auditReport.staleInIndex.length,
        emptyTextFiles: auditReport.emptyTextFiles.length,
      },
      securityWarnings: securityReport.warnings,
      sourceDiagnostics: auditReport.sourceDiagnostics,
    }
  }

  const health = manifest?.health
  return {
    indexAvailable: manifest !== null && health !== undefined,
    audit: {
      mode: "manifest",
      inventoryVerified: false,
      supportedFiles: health?.supportedFiles ?? 0,
      supportedBytes: health?.supportedBytes ?? 0,
      largestFileBytes: health?.largestFileBytes ?? 0,
      skippedFiles: health?.skippedFiles ?? 0,
      unsupportedFiles: health?.unsupportedFiles ?? 0,
      oversizedFiles: health?.oversizedFiles ?? 0,
      indexedFiles: manifest?.fileCount ?? 0,
      totalChunks: manifest?.chunkCount ?? 0,
      missingFromIndex: health?.missingFromIndex ?? 0,
      staleInIndex: health?.staleInIndex ?? manifest?.staleFiles?.length ?? 0,
      emptyTextFiles: health?.emptyTextFiles ?? 0,
    },
    securityWarnings: health?.securityWarnings ?? [],
    sourceDiagnostics: health?.sourceDiagnostics ?? emptySourceDiagnostics(),
  }
}

function researchBudget(options: ResearchOptions): ResearchBudget {
  return {
    codeTopK: boundedResearchOption(
      "codeTopK",
      options.codeTopK,
      DEFAULT_CODE_EVIDENCE_LIMIT,
      MAX_CODE_EVIDENCE_LIMIT,
    ),
    codeScanMaxFiles: boundedResearchOption(
      "codeScanMaxFiles",
      options.codeScanMaxFiles,
      DEFAULT_CODE_SCAN_MAX_FILES,
      MAX_CODE_SCAN_FILES,
    ),
    codeScanMaxBytes: boundedResearchOption(
      "codeScanMaxBytes",
      options.codeScanMaxBytes,
      DEFAULT_CODE_SCAN_MAX_BYTES,
      MAX_CODE_SCAN_BYTES,
    ),
    codeScanConcurrency: boundedResearchOption(
      "codeScanConcurrency",
      options.codeScanConcurrency,
      DEFAULT_CODE_SCAN_CONCURRENCY,
      MAX_CODE_SCAN_CONCURRENCY,
    ),
  }
}

function boundedResearchOption(
  name: string,
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved <= 0 || resolved > maximum) {
    throw new RagmirError(
      "INVALID_ARGUMENT",
      `${name} must be a positive integer no greater than ${maximum}.`,
    )
  }
  return resolved
}

function compareResearchEvidence(left: ResearchEvidence, right: ResearchEvidence): number {
  return (
    right.researchScore - left.researchScore ||
    left.bestRank - right.bestRank ||
    left.relativePath.localeCompare(right.relativePath) ||
    left.chunkIndex - right.chunkIndex
  )
}

function compareResearchQueries(left: string, right: string, primaryQuery: string): number {
  if (left === primaryQuery) {
    return right === primaryQuery ? 0 : -1
  }
  if (right === primaryQuery) {
    return 1
  }
  return left.localeCompare(right)
}

function compareResearchResultChoice(
  query: string,
  rank: number,
  currentQuery: string,
  currentRank: number,
  primaryQuery: string,
): number {
  const primaryDifference = Number(query !== primaryQuery) - Number(currentQuery !== primaryQuery)
  return primaryDifference || rank - currentRank || query.localeCompare(currentQuery)
}

function researchSuffixes(query: string): string[] {
  if (/\p{Script=Thai}/u.test(query)) {
    return [
      "ขอบเขต ข้อกำหนด กฎ",
      "ผู้เกี่ยวข้อง สิทธิ์ ขั้นตอน สถานะ การตรวจสอบ",
      "วันที่ กำหนดเวลา ความเสี่ยง อุปสรรค",
      "การเชื่อมต่อ ข้อมูล การพึ่งพา",
    ]
  }
  if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u.test(query)) {
    return [
      "範囲 要件 規則",
      "関係者 権限 手順 状態 検証",
      "日付 期限 計画 リスク",
      "統合 API データ 依存関係",
    ]
  }
  if (
    /[àâçéèêëîïôùûüÿœ]/iu.test(query) ||
    /\b(avec|dans|des|exigences|les|politique|pour|quelle?|règles?|une)\b/iu.test(query)
  ) {
    return [
      "périmètre exigences règles",
      "acteurs permissions processus statut validation",
      "dates échéances planification risques blocages",
      "intégration API données dépendances",
    ]
  }
  return [
    "scope requirements rules",
    "actors permissions workflow status validation",
    "dates deadlines planning risks blockers",
    "integration API data model export dependencies",
  ]
}

function emptySourceDiagnostics(): SourceDiagnostics {
  return { duplicateCandidates: [], archiveCandidates: [], mirrorCandidates: [] }
}

async function findCodeEvidence(
  config: Config,
  query: string,
  budget: ResearchBudget,
  signal: AbortSignal | undefined,
): Promise<CodeScanResult> {
  throwIfAborted(signal)
  const terms = meaningfulTerms(query)
  if (terms.length === 0) {
    return emptyCodeScan()
  }
  const ignore = [...CODE_SCAN_IGNORE, ...projectRelativeIgnores(config)]
  const minimumMatchedTerms = terms.length === 1 ? 1 : 2
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
  const eligible = entries
    .map((entry) => {
      const absolutePath = path.isAbsolute(entry.path)
        ? entry.path
        : path.resolve(config.projectRoot, entry.path)
      return {
        absolutePath,
        relativePath: path.relative(config.projectRoot, absolutePath),
        size: entry.stats?.size ?? 0,
      }
    })
    .filter(
      (entry) =>
        isScannableCodePath(entry.absolutePath) &&
        !isSensitiveFilePath(entry.absolutePath) &&
        entry.size <= CODE_SCAN_MAX_BYTES,
    )
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  const selected: CodeScanEntry[] = []
  let bytesScanned = 0
  for (const entry of eligible) {
    if (selected.length >= budget.codeScanMaxFiles) {
      break
    }
    if (bytesScanned + entry.size > budget.codeScanMaxBytes) {
      continue
    }
    selected.push(entry)
    bytesScanned += entry.size
  }
  const candidates: CodeEvidence[] = []
  for (let offset = 0; offset < selected.length; offset += budget.codeScanConcurrency) {
    throwIfAborted(signal)
    const batch = selected.slice(offset, offset + budget.codeScanConcurrency)
    const matches = await Promise.all(
      batch.map((entry) => scanCodeEntry(entry, query, terms, minimumMatchedTerms, config, signal)),
    )
    for (const match of matches) {
      if (match) {
        candidates.push(match)
      }
    }
  }
  return {
    evidence: candidates.sort(compareCodeEvidence).slice(0, budget.codeTopK),
    filesScanned: selected.length,
    bytesScanned,
    truncated: selected.length < eligible.length,
  }
}

async function scanCodeEntry(
  entry: CodeScanEntry,
  query: string,
  terms: string[],
  minimumMatchedTerms: number,
  config: Config,
  signal: AbortSignal | undefined,
): Promise<CodeEvidence | null> {
  const content = await readFile(entry.absolutePath, { encoding: "utf8", signal }).catch(() => null)
  throwIfAborted(signal)
  if (content === null) {
    return null
  }
  const normalizedQuery = normalizeForMatch(query)
  let best: CodeEvidence | null = null
  for (const [index, line] of content.split(/\r?\n/u).entries()) {
    const normalizedLine = normalizeForMatch(line)
    const matchedTerms = terms.filter((term) => normalizedLine.includes(term))
    if (matchedTerms.length < minimumMatchedTerms) {
      continue
    }
    const redactedSnippet = redactText(line.trim(), config).text
    const candidate: CodeEvidence = {
      relativePath: entry.relativePath,
      lineNumber: index + 1,
      snippet: redactedSnippet.slice(0, COMPACT_SNIPPET_LENGTH),
      matchedTerms,
      score: matchedTerms.length * 100 + Number(normalizedLine.includes(normalizedQuery)) * 1_000,
    }
    if (!best || compareCodeEvidence(candidate, best) < 0) {
      best = candidate
    }
  }
  return best
}

function emptyCodeScan(): CodeScanResult {
  return { evidence: [], filesScanned: 0, bytesScanned: 0, truncated: false }
}

function compareCodeEvidence(a: CodeEvidence, b: CodeEvidence): number {
  return (
    b.score - a.score ||
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
  indexAvailable: boolean
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
  if (!input.indexAvailable) {
    gaps.push("No active index manifest is available for research.")
  }
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
