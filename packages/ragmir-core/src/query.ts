import { createHash } from "node:crypto"
import { channel } from "node:diagnostics_channel"
import { stat } from "node:fs/promises"
import path from "node:path"
import {
  BooleanQuery,
  type Connection,
  type FullTextQuery,
  MatchQuery,
  Occur,
  Operator,
  PhraseQuery,
} from "@lancedb/lancedb"
import { citationForCoordinates, stripCitationCoordinates } from "./citation.js"
import { loadConfig } from "./config.js"
import { MAX_SEARCH_TOP_K, VECTOR_DISTANCE_METRIC } from "./defaults.js"
import { embedText } from "./embeddings.js"
import { RagmirError } from "./errors.js"
import { acquireGenerationReadLease } from "./generation-retention.js"
import { indexFreshnessWarning } from "./index-diagnostics.js"
import { lexicalPolicyCurrent } from "./index-policy.js"
import { knowledgeBaseIdentity } from "./knowledge-bases.js"
import {
  addLexicalDocument,
  type LexicalCorpusStatistics,
  lexicalDocument,
  lexicalDocumentScore,
} from "./lexical-scoring.js"
import { operationSignal, throwIfAborted } from "./operation.js"
import { sanitizeRetrievalQuery } from "./query-sanitizer.js"
import type { QueryTermStatistics, RankedRow } from "./ranking.js"
import {
  abstentionFilter,
  fusionCandidateDepth,
  queryEvidence,
  queryTermCoverage,
  rankHybridRows,
  rankingPolicyFingerprint,
  rankingPolicyFor,
  tokensAreFuzzyRelated,
  tokensAreLexicallyRelated,
  weakEvidenceFilter,
} from "./ranking.js"
import { selectDiverseRows } from "./retrieval-diversity.js"
import {
  canonicalUserPath,
  isCaseInsensitiveFileSystem,
  resolveExistingPath,
  unicodePathVariants,
} from "./source-paths.js"
import { definitionBoostOf, localeDocumentKey, sourceWeightOf } from "./source-weights.js"
import type { IndexReadSnapshot } from "./store.js"
import { closeIndexReadSnapshot, loadIndexReadSnapshot } from "./store.js"
import { normalizeForMatch, tokenize } from "./text.js"
import type {
  Config,
  EvidenceVersion,
  ExpandCitationOptions,
  ExpandedCitation,
  IndexManifest,
  RetrievalProfile,
  SearchContextChunk,
  SearchOptions,
  SearchResult,
  SourceLocationKind,
  VectorIndexManifest,
} from "./types.js"
import { configureAdaptiveVectorQuery, vectorIndexManifestCompatible } from "./vector-index.js"
import { runWorkload } from "./workload.js"

type RowsTable = NonNullable<IndexReadSnapshot["table"]>

interface SearchRow {
  id: string
  checksum: string
  source: string
  relativePath: string
  chunkIndex: number
  contextPath: string
  headerChunkIndex?: number
  searchText: string
  text: string
  charStart?: number
  charEnd?: number
  lineStart?: number
  lineEnd?: number
  pageStart?: number
  pageEnd?: number
  locationKind?: SourceLocationKind
  locationStart?: number
  locationEnd?: number
  locationLabel?: string
  cellStart?: string
  cellEnd?: string
  bytes?: number
  mtimeMs?: number
  _distance?: number
  _score?: number
}

// Margin over the fusion bound from fusionCandidateDepth. Deeper pools returned the same rankings on
// real code and document corpora while multiplying native reads and JavaScript work per query.
const CANDIDATE_DEPTH_MARGIN: Record<RetrievalProfile, number> = {
  fast: 1,
  balanced: 1.25,
  quality: 1.5,
  custom: 1.25,
}
const MAX_CONTEXT_RADIUS = 3
const DIVERSITY_CANDIDATE_MULTIPLIER = 4
const MAX_VECTOR_CANDIDATES = 1_000
const MAX_LEXICAL_CANDIDATES = 4_000
const FULL_TEXT_INDEX_NAME = "searchText_idx"
// Document frequencies only weigh words: past 2% of the passages a word is common either way, and
// counting deeper only adds full-text reads (3 to 6 ms per word on a 44,000-passage index).
const TERM_FREQUENCY_SHARE = 0.02
const MIN_TERM_FREQUENCY_LIMIT = 500
const MAX_TERM_FREQUENCY_LIMIT = 5_000
const MAX_CACHED_TERM_GENERATIONS = 4
const UNSEGMENTED_SCRIPT_PATTERN =
  /[\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const termFrequencyCache = new Map<string, Map<string, number>>()
const LEXICAL_IDENTIFIER_PATTERN = /[\p{L}\p{N}]+(?:[-_.][\p{L}\p{N}]+)+/gu
const SOURCE_PATH_QUERY_PATTERN = /^[\p{L}\p{N}_. /\\-]+\.[a-z0-9]{1,12}$/iu
export const QUERY_EXPLANATION_DIAGNOSTICS_CHANNEL = "ragmir:query-explanation"
const queryExplanationDiagnostics = channel(QUERY_EXPLANATION_DIAGNOSTICS_CHANNEL)
const SEARCH_COLUMNS = [
  "id",
  "checksum",
  "source",
  "relativePath",
  "chunkIndex",
  "contextPath",
  "headerChunkIndex",
  "searchText",
  "text",
  "charStart",
  "charEnd",
  "lineStart",
  "lineEnd",
  "pageStart",
  "pageEnd",
  "locationKind",
  "locationStart",
  "locationEnd",
  "locationLabel",
  "cellStart",
  "cellEnd",
  "bytes",
  "mtimeMs",
]
const VECTOR_SEARCH_COLUMNS = [...SEARCH_COLUMNS, "_distance"]
const FTS_SEARCH_COLUMNS = [...SEARCH_COLUMNS, "_score"]

interface LexicalCandidateSet {
  rows: SearchRow[]
  exactPathMatches: Set<string>
  backend: "fts" | "fallback"
  fallbackActivated: boolean
  fallbackReason: "fts-index-unavailable" | "fts-query-failed" | null
  candidateLimit: number
  candidatesMaterialized: number
  queryVariants: number
  indexedRows: number
  unindexedRows: number
  coverage: number
  scanBatches: number
}

interface LexicalCandidateOptions {
  ftsLimit: number
  fallbackBatchSize: number
  indexedChunkCount: number
  minimumResults: number
  pathPredicate: string | null
  signal?: AbortSignal
}

export async function search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
  const config = await loadConfig(String(options.cwd ?? process.cwd()))
  const results = await searchWithConfig(query, options, config)
  return results
}

export async function searchWithConfig(
  query: string,
  options: SearchOptions,
  config: Config,
  connection?: Connection,
  activeSignal?: AbortSignal,
  suppliedSnapshot?: IndexReadSnapshot,
  generationLeaseHeld = false,
): Promise<SearchResult[]> {
  const signal = activeSignal ?? operationSignal(options)
  return runWorkload(config, "search", signal, async ({ queueTimeMs }) => {
    const ownsSnapshot = suppliedSnapshot === undefined
    const snapshot = suppliedSnapshot ?? (await loadIndexReadSnapshot(config, connection))
    let lease: Awaited<ReturnType<typeof acquireGenerationReadLease>> | undefined
    try {
      if (!generationLeaseHeld && snapshot.table) {
        lease = await acquireGenerationReadLease(snapshot.tableName, config)
      }
      return await searchWithinGeneration(query, options, config, snapshot, signal, queueTimeMs)
    } finally {
      await lease?.release().catch(() => undefined)
      if (ownsSnapshot) {
        closeIndexReadSnapshot(snapshot, config)
      }
    }
  })
}

async function searchWithinGeneration(
  query: string,
  options: SearchOptions,
  config: Config,
  snapshot: IndexReadSnapshot,
  activeSignal?: AbortSignal,
  workloadQueueMs = 0,
): Promise<SearchResult[]> {
  const signal = activeSignal ?? operationSignal(options)
  const sanitized = sanitizeRetrievalQuery(query)
  const topK = normalizeTopK(options.topK ?? config.topK)
  const maxChunksPerDocument = normalizeMaxChunksPerDocument(
    options.maxChunksPerDocument ?? config.maxChunksPerDocument,
  )
  const candidateDemand = diversityCandidateDemand(topK, maxChunksPerDocument)
  const defaultContextRadius = config.retrievalProfile === "quality" ? 1 : 0
  const contextRadius = normalizeContextRadius(options.contextRadius ?? defaultContextRadius)
  throwIfAborted(signal)
  const table = snapshot.table
  throwIfAborted(signal)
  if (!table) {
    return []
  }
  assertIndexFreshness(config, snapshot.manifest)

  const evidence = queryEvidence(sanitized.query)
  const queryTokens = evidence.tokens
  if (!sanitized.query || queryTokens.length === 0) {
    return []
  }

  const scope = resolveSearchScope(config, options.scope)
  const retrievalPredicate = searchPredicate(
    [scope?.includePaths, options.includePaths],
    [...(scope?.excludePaths ?? []), ...(options.excludePaths ?? [])],
    options.contextPaths,
  )
  let embeddingQueueMs = 0
  // Indexes built before folded keyword text cannot answer exact word frequencies reliably.
  const termFrequenciesPromise =
    snapshot.manifest && lexicalPolicyCurrent(snapshot.manifest)
      ? queryTermFrequencies(table, queryTokens, snapshot).catch(() => null)
      : Promise.resolve(null)
  const lexicalCandidatesPromise = lexicalCandidateRows(table, sanitized.query, {
    ftsLimit: lexicalCandidateLimit(candidateDemand, config.retrievalProfile),
    fallbackBatchSize: config.hybridTextScanLimit,
    indexedChunkCount: snapshot.manifest?.chunkCount ?? 0,
    minimumResults: candidateDemand,
    pathPredicate: retrievalPredicate,
    ...(signal === undefined ? {} : { signal }),
  })
  const vectorRowsPromise = embedText(sanitized.query, config, signal, ({ queueTimeMs }) => {
    embeddingQueueMs = queueTimeMs
  }).then(async (vector) => {
    throwIfAborted(signal)
    const manifest = assertVectorIndexCompatibility(config, snapshot.manifest, vector.length)
    const limit = vectorCandidateLimit(candidateDemand, config.retrievalProfile)
    const nearest = async (predicate: string | null): Promise<SearchRow[]> => {
      const vectorQuery = configureAdaptiveVectorQuery(
        table.vectorSearch(vector).select(VECTOR_SEARCH_COLUMNS),
        manifest.vectorIndex,
        options.vectorSearchMode === "exact",
      )
      return (await (predicate ? vectorQuery.where(predicate) : vectorQuery)
        .limit(limit)
        .toArray()) as SearchRow[]
    }
    const rows = await nearest(retrievalPredicate)
    const crowding = crowdingDocuments(rows, topK)
    if (crowding.length === 0) {
      return rows
    }
    // One large file (an export, a log, a spreadsheet) filled the pool with its own chunks, yet
    // shows at most maxChunksPerDocument of them; a second pass reaches the other documents.
    throwIfAborted(signal)
    const others = `NOT (${crowding.map(relativePathEquals).join(" OR ")})`
    const more = await nearest(
      retrievalPredicate ? `(${retrievalPredicate}) AND ${others}` : others,
    )
    const seen = new Set(rows.map(rowKey))
    return [...rows, ...more.filter((row) => !seen.has(rowKey(row)))]
  })
  const [vectorRowsOutcome, lexicalCandidatesOutcome] = await Promise.allSettled([
    vectorRowsPromise,
    lexicalCandidatesPromise,
  ])
  if (vectorRowsOutcome.status === "rejected") {
    throw vectorRowsOutcome.reason
  }
  if (lexicalCandidatesOutcome.status === "rejected") {
    throw lexicalCandidatesOutcome.reason
  }
  const vectorRows = vectorRowsOutcome.value
  const lexicalCandidates = lexicalCandidatesOutcome.value
  const termStatistics = withFuzzyMatches(await termFrequenciesPromise, queryTokens, [
    ...lexicalCandidates.rows,
    ...vectorRows,
  ])
  throwIfAborted(signal)
  const rankingPolicy = rankingPolicyFor(
    config.embeddingProvider,
    config.retrievalProfile,
    maxChunksPerDocument,
    config.embeddingModel,
  )
  const weightOf = sourceWeightOf(config)
  const definitionBoost = definitionBoostOf(queryTokens)
  const rankedRows = rankHybridRows(
    sanitized.query,
    vectorRows,
    lexicalCandidates.rows,
    rankingPolicy,
    (row) => weightOf(row.relativePath) * definitionBoost(row),
  )
  const isExactPathMatch = (row: SearchRow): boolean =>
    lexicalCandidates.exactPathMatches.has(rowKey(row))
  const passesAbstention = abstentionFilter(evidence, rankingPolicy, termStatistics)
  const hasWeakEvidence = weakEvidenceFilter(evidence, rankingPolicy, termStatistics)
  const coverageOf =
    options.explain && termStatistics ? queryTermCoverage(evidence, termStatistics) : null
  const orderedRows = rankedRows.sort(
    (left, right) => Number(isExactPathMatch(right.row)) - Number(isExactPathMatch(left.row)),
  )
  const diversity = selectDiverseRows(orderedRows, {
    topK,
    maxChunksPerDocument,
    isExactPathMatch,
    ...(config.collapseLocaleVariants
      ? { documentKeyOf: (row: SearchRow) => localeDocumentKey(row.relativePath) }
      : {}),
    isRelevant: (row) => isExactPathMatch(row) || passesAbstention(row),
  })
  const rows = diversity.rows
  const [contextByRow, sourceStatuses] = await Promise.all([
    contextChunksByRow(table, rows, contextRadius, retrievalPredicate),
    sourceStatusesForRows(config.projectRoot, rows),
  ])
  throwIfAborted(signal)
  const knowledgeBaseId = knowledgeBaseIdentity(config.projectRoot)?.id ?? null

  const results = rows.map((row) => {
    const vectorDistance = typeof row.row._distance === "number" ? row.row._distance : null
    const sourceStatus = sourceStatuses.get(row.row.relativePath)
    return {
      source: row.row.source,
      relativePath: row.row.relativePath,
      chunkIndex: row.row.chunkIndex,
      contextPath: row.row.contextPath,
      citation: citationForRow(row.row),
      text: row.row.text,
      distance: vectorDistance,
      charStart: nullableNumber(row.row.charStart),
      charEnd: nullableNumber(row.row.charEnd),
      lineStart: nullableLineNumber(row.row.lineStart),
      lineEnd: nullableLineNumber(row.row.lineEnd),
      pageStart: nullablePageNumber(row.row.pageStart),
      pageEnd: nullablePageNumber(row.row.pageEnd),
      context: contextByRow.get(rowKey(row.row)) ?? [],
      evidence: evidenceVersionForRow(row.row, snapshot, knowledgeBaseId),
      ...(sourceStatus === undefined ? {} : { sourceStatus }),
      ...(!isExactPathMatch(row.row) && hasWeakEvidence(row.row)
        ? { weakEvidence: true as const }
        : {}),
      ...(options.explain
        ? {
            score: {
              retrievalQuery: sanitized.query,
              queryNormalized: sanitized.changed,
              originalQueryLength: sanitized.originalLength,
              fusion: "rrf" as const,
              combinedScore: row.combinedScore,
              scoreMultiplier: row.scoreMultiplier,
              vectorContribution: row.vectorScore,
              lexicalContribution: row.lexicalScore,
              vectorRank: row.vectorRank,
              lexicalRank: row.lexicalRank,
              vectorDistance,
              lexicalBackendScore: row.lexicalBackendScore,
              lexicalBackend: lexicalCandidates.backend,
              lexicalFallbackActivated: lexicalCandidates.fallbackActivated,
              lexicalFallbackReason: lexicalCandidates.fallbackReason,
              lexicalExactPathMatch: lexicalCandidates.exactPathMatches.has(rowKey(row.row)),
              lexicalCandidateLimit: lexicalCandidates.candidateLimit,
              lexicalCandidatesMaterialized: lexicalCandidates.candidatesMaterialized,
              lexicalQueryVariants: lexicalCandidates.queryVariants,
              lexicalIndexedRows: lexicalCandidates.indexedRows,
              lexicalUnindexedRows: lexicalCandidates.unindexedRows,
              lexicalCoverage: lexicalCandidates.coverage,
              lexicalScanBatches: lexicalCandidates.scanBatches,
              diversityStrategy: "document-cap" as const,
              maxChunksPerDocument,
              diversityBackfillActivated: diversity.backfillActivated,
              workloadQueueMs: workloadQueueMs + embeddingQueueMs,
              rankingPolicyFingerprint: rankingPolicyFingerprint(rankingPolicy),
              matchedTerms: matchedQueryTerms(config.projectRoot, queryTokens, row.row.searchText),
              queryTermCoverage: coverageOf ? coverageOf(row.row.searchText) : null,
            },
          }
        : {}),
    }
  })
  return results
}

const CROWDING_MIN_CHUNKS = 4
const CROWDING_SHARE = 0.25

/** Documents holding a quarter or more of a candidate pool that reaches too few documents. */
function crowdingDocuments(rows: readonly SearchRow[], topK: number): string[] {
  if (rows.length < CROWDING_MIN_CHUNKS * 2) {
    return []
  }
  const counts = new Map<string, number>()
  for (const row of rows) {
    counts.set(row.relativePath, (counts.get(row.relativePath) ?? 0) + 1)
  }
  if (counts.size >= Math.min(rows.length, topK * 3)) {
    return []
  }
  const threshold = Math.max(CROWDING_MIN_CHUNKS, Math.ceil(rows.length * CROWDING_SHARE))
  return [...counts.entries()]
    .filter(([, count]) => count >= threshold)
    .map(([relativePath]) => relativePath)
}

/**
 * Compare each cited file with the size and modification time recorded at indexing. Agents can then
 * tell evidence that no longer matches the file on disk from current evidence, at one stat per file.
 */
async function sourceStatusesForRows(
  projectRoot: string,
  rows: Array<RankedRow<SearchRow>>,
): Promise<Map<string, "modified" | "missing">> {
  const byPath = new Map<string, SearchRow>()
  for (const { row } of rows) {
    if (!byPath.has(row.relativePath)) byPath.set(row.relativePath, row)
  }
  const statuses = new Map<string, "modified" | "missing">()
  await Promise.all(
    [...byPath.entries()].map(async ([relativePath, row]) => {
      if (typeof row.bytes !== "number" || typeof row.mtimeMs !== "number") {
        return
      }
      const absolutePath = resolveExistingPath(
        path.join(projectRoot, ...relativePath.split("/")),
        isCaseInsensitiveFileSystem(projectRoot),
      )
      const info = absolutePath === null ? null : await stat(absolutePath).catch(() => null)
      if (!info?.isFile()) {
        statuses.set(relativePath, "missing")
      } else if (info.size !== row.bytes || info.mtimeMs !== row.mtimeMs) {
        statuses.set(relativePath, "modified")
      }
    }),
  )
  return statuses
}

/**
 * Count, for each query word, the passages whose keyword text contains it, with one bounded
 * full-text query per word. Cached per index generation: words repeat across an agent's searches.
 */
async function queryTermFrequencies(
  table: RowsTable,
  tokens: readonly string[],
  snapshot: IndexReadSnapshot,
): Promise<QueryTermStatistics | null> {
  const stats = await table.indexStats(FULL_TEXT_INDEX_NAME).catch(() => undefined)
  if (!stats || stats.numUnindexedRows > 0) {
    return null
  }
  const cacheKey = `${snapshot.tableName}\0${snapshot.manifestFingerprint ?? ""}`
  let cache = termFrequencyCache.get(cacheKey)
  if (!cache) {
    cache = new Map()
    termFrequencyCache.set(cacheKey, cache)
    while (termFrequencyCache.size > MAX_CACHED_TERM_GENERATIONS) {
      const oldest = termFrequencyCache.keys().next().value
      if (oldest === undefined) break
      termFrequencyCache.delete(oldest)
    }
  }
  const generationCache = cache
  const frequencyLimit = Math.min(
    MAX_TERM_FREQUENCY_LIMIT,
    Math.max(MIN_TERM_FREQUENCY_LIMIT, Math.ceil(stats.numIndexedRows * TERM_FREQUENCY_SHARE)),
  )
  const unique = [...new Set(tokens)]
  const unmeasuredTerms = new Set(unique.filter((token) => UNSEGMENTED_SCRIPT_PATTERN.test(token)))
  const measured = unique.filter((token) => !unmeasuredTerms.has(token))
  if (measured.length === 0) {
    return null
  }
  await Promise.all(
    measured
      .filter((token) => !generationCache.has(token))
      .map(async (token) => {
        const rows = await table
          .search(new MatchQuery(token, "searchText"), "fts", "searchText")
          .select(["id"])
          .limit(frequencyLimit)
          .toArray()
        generationCache.set(token, rows.length)
      }),
  )
  return {
    documentCount: stats.numIndexedRows,
    documentFrequencies: new Map(measured.map((token) => [token, generationCache.get(token) ?? 0])),
    ...(unmeasuredTerms.size > 0 ? { unmeasuredTerms } : {}),
  }
}

/** Mark absent words that a candidate still matches fuzzily, so typos are not treated as noise. */
function withFuzzyMatches(
  statistics: QueryTermStatistics | null,
  tokens: readonly string[],
  candidateRows: readonly SearchRow[],
): QueryTermStatistics | null {
  if (!statistics) {
    return null
  }
  const measured = [...new Set(tokens)].filter((token) => !statistics.unmeasuredTerms?.has(token))
  // Fuzzy matches only decide whether no query word is known at all; skip the scan otherwise.
  if (measured.some((token) => (statistics.documentFrequencies.get(token) ?? 0) > 0)) {
    return statistics
  }
  const absent = measured.filter((token) => token.length >= 7)
  if (absent.length === 0 || candidateRows.length === 0) {
    return statistics
  }
  const fuzzyMatchedTerms = new Set<string>()
  for (const row of candidateRows) {
    for (const textToken of tokenize(row.searchText)) {
      for (const token of absent) {
        if (!fuzzyMatchedTerms.has(token) && tokensAreFuzzyRelated(token, textToken)) {
          fuzzyMatchedTerms.add(token)
        }
      }
    }
    if (fuzzyMatchedTerms.size === absent.length) break
  }
  return { ...statistics, fuzzyMatchedTerms }
}

export function vectorCandidateLimit(
  candidateDemand: number,
  profile: RetrievalProfile = "balanced",
): number {
  return Math.min(MAX_VECTOR_CANDIDATES, candidateDepth(candidateDemand, profile))
}

export function lexicalCandidateLimit(
  candidateDemand: number,
  profile: RetrievalProfile = "balanced",
): number {
  return Math.min(MAX_LEXICAL_CANDIDATES, candidateDepth(candidateDemand, profile))
}

function candidateDepth(candidateDemand: number, profile: RetrievalProfile): number {
  return Math.ceil(fusionCandidateDepth(candidateDemand) * CANDIDATE_DEPTH_MARGIN[profile])
}

export async function expandCitation(
  citation: string,
  options: ExpandCitationOptions = {},
): Promise<ExpandedCitation> {
  const config = await loadConfig(String(options.cwd ?? process.cwd()))
  return expandCitationWithConfig(citation, options, config)
}

export async function expandCitationWithConfig(
  citation: string,
  options: ExpandCitationOptions,
  config: Config,
  connection?: Connection,
  suppliedSnapshot?: IndexReadSnapshot,
): Promise<ExpandedCitation> {
  const ownsSnapshot = suppliedSnapshot === undefined
  const snapshot = suppliedSnapshot ?? (await loadIndexReadSnapshot(config, connection))
  let lease: Awaited<ReturnType<typeof acquireGenerationReadLease>> | undefined
  try {
    if (snapshot.table) {
      lease = await acquireGenerationReadLease(snapshot.tableName, config)
    }
    return await expandCitationWithinGeneration(citation, options, config, snapshot)
  } finally {
    await lease?.release().catch(() => undefined)
    if (ownsSnapshot) {
      closeIndexReadSnapshot(snapshot, config)
    }
  }
}

async function expandCitationWithinGeneration(
  citation: string,
  options: ExpandCitationOptions,
  config: Config,
  snapshot: IndexReadSnapshot,
): Promise<ExpandedCitation> {
  const signal = operationSignal(options)
  throwIfAborted(signal)
  const requestedCitation = citation.trim()
  const target = parseCitationTarget(requestedCitation)
  const contextRadius = normalizeContextRadius(options.contextRadius)
  if (
    options.expectedEvidenceId !== undefined &&
    !/^[a-f0-9]{64}$/u.test(options.expectedEvidenceId)
  ) {
    throw new RagmirError(
      "INVALID_ARGUMENT",
      "expectedEvidenceId must be a SHA-256 identifier from search.",
    )
  }
  const table = snapshot.table
  throwIfAborted(signal)
  if (!table) {
    return {
      requestedCitation,
      found: false,
      relativePath: target.relativePath,
      chunkIndex: target.chunkIndex,
      contextRadius,
      passages: [],
    }
  }

  if (!snapshot.manifest) {
    throw new Error("Index manifest is missing. Run `rgr upgrade` before expanding citations.")
  }
  const freshnessWarning = indexFreshnessWarning(config, snapshot.manifest)
  if (freshnessWarning) {
    throw new Error(freshnessWarning)
  }

  const minimumChunkIndex = Math.max(0, target.chunkIndex - contextRadius)
  const maximumChunkIndex = target.chunkIndex + contextRadius
  const rows = (await table
    .query()
    .select(SEARCH_COLUMNS)
    .where(
      `${relativePathEquals(target.relativePath)} AND chunkIndex >= ${minimumChunkIndex} AND chunkIndex <= ${maximumChunkIndex}`,
    )
    .toArray()) as SearchRow[]
  throwIfAborted(signal)
  const targetRow = rows.find((row) => row.chunkIndex === target.chunkIndex)
  if (!targetRow) {
    return {
      requestedCitation,
      found: false,
      relativePath: target.relativePath,
      chunkIndex: target.chunkIndex,
      contextRadius,
      passages: [],
    }
  }
  if (canonicalUserPath(citationForRow(targetRow)) !== canonicalUserPath(requestedCitation)) {
    throw new Error("Citation coordinates do not match the indexed passage.")
  }
  const evidence = evidenceVersionForRow(
    targetRow,
    snapshot,
    knowledgeBaseIdentity(config.projectRoot)?.id ?? null,
  )
  if (options.expectedEvidenceId !== undefined && options.expectedEvidenceId !== evidence.id) {
    throw new RagmirError(
      "EVIDENCE_CHANGED",
      "The indexed evidence has changed. Search again before expanding this citation.",
    )
  }
  if (
    targetRow.headerChunkIndex !== undefined &&
    targetRow.headerChunkIndex >= 0 &&
    !rows.some((row) => row.chunkIndex === targetRow.headerChunkIndex)
  ) {
    const headers = (await table
      .query()
      .select(SEARCH_COLUMNS)
      .where(
        `${relativePathEquals(target.relativePath)} AND chunkIndex = ${targetRow.headerChunkIndex}`,
      )
      .limit(1)
      .toArray()) as SearchRow[]
    throwIfAborted(signal)
    rows.push(...headers)
  }

  return {
    requestedCitation,
    found: true,
    relativePath: target.relativePath,
    chunkIndex: target.chunkIndex,
    contextRadius,
    evidence,
    passages: rows.sort(compareChunkRows).map(contextChunkForRow),
  }
}

function evidenceVersionForRow(
  row: SearchRow,
  snapshot: IndexReadSnapshot,
  knowledgeBaseId: string | null,
): EvidenceVersion {
  return {
    id: createHash("sha256")
      .update(JSON.stringify([row.relativePath, row.checksum, row.id, citationForRow(row)]))
      .digest("hex"),
    sourceChecksum: row.checksum,
    indexGeneration: snapshot.tableName,
    indexedAt: snapshot.manifest?.createdAt ?? null,
    knowledgeBaseId,
  }
}

async function lexicalCandidateRows(
  table: RowsTable,
  query: string,
  options: LexicalCandidateOptions,
): Promise<LexicalCandidateSet> {
  throwIfAborted(options.signal)
  const ftsQueries = lexicalQuery(query)
  const stats = await table.indexStats(FULL_TEXT_INDEX_NAME).catch(() => undefined)
  const sourcePathQuery = sourcePathPredicateForQuery(query)
  throwIfAborted(options.signal)
  let fallbackReason: LexicalCandidateSet["fallbackReason"] = "fts-index-unavailable"
  if (ftsQueries && stats) {
    try {
      const sourcePathRows = sourcePathQuery
        ? await executeSourcePathQuery(
            table,
            sourcePathQuery,
            options.ftsLimit,
            options.pathPredicate,
          )
        : []
      const primaryRows = await executeFullTextQuery(
        table,
        ftsQueries.primary,
        options.ftsLimit,
        options.pathPredicate,
      )
      throwIfAborted(options.signal)
      const rows: SearchRow[] = []
      const initialRows = [...sourcePathRows, ...primaryRows]
      const seenRows = new Set<string>()
      for (const row of initialRows) {
        const key = rowKey(row)
        if (!seenRows.has(key)) {
          seenRows.add(key)
          rows.push(row)
        }
      }
      let executedVariants = 1 + Number(sourcePathQuery !== null)
      if (rows.length < options.minimumResults) {
        for (const supplementalQuery of ftsQueries.supplemental) {
          throwIfAborted(options.signal)
          const supplementalRows = await executeFullTextQuery(
            table,
            supplementalQuery,
            options.ftsLimit,
            options.pathPredicate,
          ).catch(() => [])
          throwIfAborted(options.signal)
          executedVariants += 1
          for (const row of supplementalRows) {
            const key = rowKey(row)
            if (seenRows.has(key)) {
              continue
            }
            seenRows.add(key)
            rows.push(row)
            if (rows.length >= options.ftsLimit) {
              break
            }
          }
          if (rows.length >= options.minimumResults || rows.length >= options.ftsLimit) {
            break
          }
        }
      }
      const indexedRows = stats.numIndexedRows
      const unindexedRows = stats.numUnindexedRows
      const coveredRows = indexedRows + unindexedRows
      const exactPathMatches = new Set(
        sourcePathQuery
          ? sourcePathRows
              .filter(
                (row) =>
                  sourcePathQuery.exactRelativePath === null ||
                  row.relativePath.normalize("NFC") === sourcePathQuery.exactRelativePath,
              )
              .map(rowKey)
          : [],
      )
      return {
        rows,
        exactPathMatches,
        backend: "fts",
        fallbackActivated: false,
        fallbackReason: null,
        candidateLimit: options.ftsLimit,
        candidatesMaterialized: rows.length,
        queryVariants: executedVariants,
        indexedRows,
        unindexedRows,
        coverage: coveredRows === 0 ? 1 : indexedRows / coveredRows,
        scanBatches: 0,
      }
    } catch {
      fallbackReason = "fts-query-failed"
      // The fallback reads the complete snapshot in two passes with bounded candidates.
    }
  }
  const fallback = await scanFallbackRows(
    table,
    query,
    options.ftsLimit,
    options.fallbackBatchSize,
    options.pathPredicate,
    options.signal,
  )
  const sourcePathRows = sourcePathQuery
    ? await executeSourcePathQuery(table, sourcePathQuery, options.ftsLimit, options.pathPredicate)
    : []
  throwIfAborted(options.signal)
  const rowsByKey = new Map(fallback.rows.map((row) => [rowKey(row), row]))
  for (const row of sourcePathRows) {
    rowsByKey.set(rowKey(row), row)
  }
  const rows = [...rowsByKey.values()].sort(compareFallbackRows).slice(0, options.ftsLimit)
  const exactPathMatches = new Set(
    sourcePathQuery
      ? sourcePathRows
          .filter(
            (row) =>
              sourcePathQuery.exactRelativePath === null ||
              row.relativePath.normalize("NFC") === sourcePathQuery.exactRelativePath,
          )
          .map(rowKey)
      : [],
  )
  return {
    rows,
    exactPathMatches,
    backend: "fallback",
    fallbackActivated: true,
    fallbackReason,
    candidateLimit: options.ftsLimit,
    candidatesMaterialized: rows.length,
    queryVariants: 0,
    indexedRows: 0,
    unindexedRows: options.indexedChunkCount,
    coverage: 1,
    scanBatches: fallback.batches,
  }
}

async function scanFallbackRows(
  table: RowsTable,
  query: string,
  candidateLimit: number,
  batchSize: number,
  pathPredicate: string | null,
  signal?: AbortSignal,
): Promise<{ rows: SearchRow[]; batches: number }> {
  const queryTokens = [...new Set(tokenize(query))]
  const statistics: LexicalCorpusStatistics = {
    documentCount: 0,
    totalLength: 0,
    documentFrequencies: new Map(),
  }
  let batches = 0
  for await (const batch of fallbackRowBatches(table, batchSize, pathPredicate, signal)) {
    batches += 1
    for (const row of batch) {
      addLexicalDocument(statistics, lexicalDocument(row.searchText), queryTokens)
    }
  }
  const rows: SearchRow[] = []
  for await (const batch of fallbackRowBatches(table, batchSize, pathPredicate, signal)) {
    batches += 1
    for (const row of batch) {
      const score = lexicalDocumentScore(lexicalDocument(row.searchText), statistics, queryTokens)
      if (score > 0) rows.push({ ...row, _score: score })
    }
    rows.sort(compareFallbackRows)
    rows.length = Math.min(rows.length, candidateLimit)
  }
  return { rows, batches }
}

function compareFallbackRows(left: SearchRow, right: SearchRow): number {
  return (
    (right._score ?? 0) - (left._score ?? 0) ||
    left.relativePath.localeCompare(right.relativePath) ||
    left.chunkIndex - right.chunkIndex
  )
}

async function* fallbackRowBatches(
  table: RowsTable,
  batchSize: number,
  pathPredicate: string | null,
  signal?: AbortSignal,
): AsyncGenerator<SearchRow[]> {
  let offset = 0

  while (true) {
    throwIfAborted(signal)
    const query = table.query().select(SEARCH_COLUMNS)
    const batch = (await (pathPredicate ? query.where(pathPredicate) : query)
      .offset(offset)
      .limit(batchSize)
      .toArray()) as SearchRow[]
    throwIfAborted(signal)
    if (batch.length === 0) {
      break
    }
    yield batch
    offset += batch.length
    if (batch.length < batchSize) {
      break
    }
  }
}

async function executeFullTextQuery(
  table: RowsTable,
  query: FullTextQuery,
  limit: number,
  pathPredicate: string | null,
): Promise<SearchRow[]> {
  const searchQuery = table.search(query, "fts", "searchText").select(FTS_SEARCH_COLUMNS)
  return (await (pathPredicate ? searchQuery.where(pathPredicate) : searchQuery)
    .limit(limit)
    .toArray()) as SearchRow[]
}

async function executeSourcePathQuery(
  table: RowsTable,
  sourcePathQuery: { predicate: string; exactRelativePath: string | null },
  limit: number,
  retrievalPredicate: string | null,
): Promise<SearchRow[]> {
  const predicate = retrievalPredicate
    ? `(${sourcePathQuery.predicate}) AND (${retrievalPredicate})`
    : sourcePathQuery.predicate
  return (await table.query().select(SEARCH_COLUMNS).where(predicate).limit(limit).toArray()).map(
    (row) => ({
      ...(row as SearchRow),
      _score:
        sourcePathQuery.exactRelativePath === (row as SearchRow).relativePath.normalize("NFC")
          ? Number.MAX_SAFE_INTEGER
          : Number.MAX_SAFE_INTEGER - 1,
    }),
  )
}

function resolveSearchScope(
  config: Config,
  scopeName: string | undefined,
): Config["scopes"][string] | null {
  if (scopeName === undefined) {
    return null
  }
  const scope = config.scopes[scopeName]
  if (!scope) {
    const names = Object.keys(config.scopes)
    throw new RagmirError(
      "INVALID_ARGUMENT",
      names.length === 0
        ? `Unknown scope "${scopeName}": this knowledge base defines no scopes.`
        : `Unknown scope "${scopeName}". Configured scopes: ${names.join(", ")}.`,
    )
  }
  return scope
}

/** Each include group narrows the search (AND); paths inside one group are alternatives (OR). */
function searchPredicate(
  includeGroups: Array<string[] | undefined>,
  excludePaths: string[] | undefined,
  contextPaths: string[] | undefined,
): string | null {
  const excludes = normalizePathPrefixes(excludePaths)
  const contexts = normalizeContextPaths(contextPaths)
  const clauses: string[] = []

  for (const includePaths of includeGroups) {
    const includes = normalizePathPrefixes(includePaths)
    if (includes.length > 0) {
      clauses.push(`(${includes.map(pathPrefixPredicate).join(" OR ")})`)
    }
  }
  if (excludes.length > 0) {
    clauses.push(`NOT (${excludes.map(pathPrefixPredicate).join(" OR ")})`)
  }
  if (contexts.length > 0) {
    clauses.push(`(${contexts.map(contextPathPredicate).join(" OR ")})`)
  }
  return clauses.length === 0 ? null : clauses.join(" AND ")
}

function normalizePathPrefixes(prefixes: string[] | undefined): string[] {
  return [...new Set((prefixes ?? []).map(canonicalUserPath).filter(Boolean))]
}

/** Match the canonical path and its decomposed form, which indexes built before 6.2 may hold. */
function pathPrefixPredicate(prefix: string): string {
  return unicodePathVariants(prefix)
    .map(
      (variant) =>
        `(relativePath = ${sqlString(variant)} OR starts_with(relativePath, ${sqlString(`${variant}/`)}))`,
    )
    .join(" OR ")
}

function relativePathEquals(relativePath: string): string {
  const variants = unicodePathVariants(relativePath)
  return variants.length === 1
    ? `relativePath = ${sqlString(relativePath)}`
    : `relativePath IN (${variants.map(sqlString).join(", ")})`
}

function normalizeContextPaths(contextPaths: string[] | undefined): string[] {
  return [...new Set((contextPaths ?? []).map((value) => value.trim()).filter(Boolean))]
}

function contextPathPredicate(prefix: string): string {
  return [
    `contextPath = ${sqlString(prefix)}`,
    `starts_with(contextPath, ${sqlString(`${prefix} > `)})`,
    `starts_with(contextPath, ${sqlString(`${prefix}.`)})`,
    `starts_with(contextPath, ${sqlString(`${prefix}[`)})`,
  ].join(" OR ")
}

async function contextChunksByRow(
  table: RowsTable,
  rows: Array<RankedRow<SearchRow>>,
  requestedRadius: number,
  retrievalPredicate: string | null,
): Promise<Map<string, SearchContextChunk[]>> {
  const radius = Math.min(MAX_CONTEXT_RADIUS, Math.max(0, requestedRadius))
  if (
    rows.length === 0 ||
    (radius === 0 && !rows.some(({ row }) => (row.headerChunkIndex ?? -1) >= 0))
  ) {
    return new Map()
  }

  const ranges = contextRangesByPath(rows, radius)
  const predicates = [...ranges.entries()].flatMap(([relativePath, pathRanges]) =>
    pathRanges.map(
      ({ minimum, maximum }) =>
        `(relativePath = ${sqlString(relativePath)} AND chunkIndex >= ${minimum} AND chunkIndex <= ${maximum})`,
    ),
  )
  for (const { row } of rows) {
    if (row.headerChunkIndex !== undefined && row.headerChunkIndex >= 0) {
      predicates.push(
        `(relativePath = ${sqlString(row.relativePath)} AND chunkIndex = ${row.headerChunkIndex})`,
      )
    }
  }
  const rangePredicate = predicates.join(" OR ")
  const hydrationPredicate = retrievalPredicate
    ? `(${rangePredicate}) AND (${retrievalPredicate})`
    : rangePredicate
  const allContextRows = (await table
    .query()
    .select(SEARCH_COLUMNS)
    .where(hydrationPredicate)
    .toArray()) as SearchRow[]
  const contextRowsByPath = new Map<string, SearchRow[]>()
  for (const contextRow of allContextRows) {
    const pathRows = contextRowsByPath.get(contextRow.relativePath) ?? []
    pathRows.push(contextRow)
    contextRowsByPath.set(contextRow.relativePath, pathRows)
  }
  const contexts = new Map<string, SearchContextChunk[]>()
  for (const { row } of rows) {
    const minChunk = Math.max(0, row.chunkIndex - radius)
    const maxChunk = row.chunkIndex + radius
    const contextRows = (contextRowsByPath.get(row.relativePath) ?? []).filter(
      (candidate) =>
        (radius > 0 && candidate.chunkIndex >= minChunk && candidate.chunkIndex <= maxChunk) ||
        candidate.chunkIndex === row.headerChunkIndex,
    )
    contexts.set(rowKey(row), contextRows.sort(compareChunkRows).map(contextChunkForRow))
  }
  return contexts
}

function contextRangesByPath(
  rows: Array<RankedRow<SearchRow>>,
  radius: number,
): Map<string, Array<{ minimum: number; maximum: number }>> {
  const rangesByPath = new Map<string, Array<RankedRow<SearchRow>>>()
  for (const rankedRow of rows) {
    const pathRows = rangesByPath.get(rankedRow.row.relativePath) ?? []
    pathRows.push(rankedRow)
    rangesByPath.set(rankedRow.row.relativePath, pathRows)
  }
  return new Map(
    [...rangesByPath.entries()].map(([relativePath, pathRows]) => {
      const ranges = pathRows
        .map(({ row }) => ({
          minimum: Math.max(0, row.chunkIndex - radius),
          maximum: row.chunkIndex + radius,
        }))
        .sort((left, right) => left.minimum - right.minimum)
      const merged: Array<{ minimum: number; maximum: number }> = []
      for (const range of ranges) {
        const previous = merged.at(-1)
        if (!previous || range.minimum > previous.maximum + 1) {
          merged.push({ ...range })
        } else {
          previous.maximum = Math.max(previous.maximum, range.maximum)
        }
      }
      return [relativePath, merged]
    }),
  )
}

function assertVectorIndexCompatibility(
  config: Awaited<ReturnType<typeof loadConfig>>,
  manifest: IndexManifest | null,
  vectorDimension: number,
): IndexManifestWithVectorIndex {
  if (!manifest) {
    throw new Error("Index manifest is missing. Run `rgr upgrade` before searching.")
  }
  if (manifest.vectorDimension !== undefined && manifest.vectorDimension !== vectorDimension) {
    throw new Error(
      `Index vector dimension is ${manifest.vectorDimension} but the active embedding produced ${vectorDimension}. Run \`rgr upgrade\` to rebuild safely.`,
    )
  }
  if (
    manifest.vectorDistanceMetric !== undefined &&
    manifest.vectorDistanceMetric !== VECTOR_DISTANCE_METRIC
  ) {
    throw new Error(
      `Index vector distance metric is ${manifest.vectorDistanceMetric} but Ragmir expects ${VECTOR_DISTANCE_METRIC}. Run \`rgr upgrade\` to rebuild safely.`,
    )
  }
  if (!manifest.vectorIndex) {
    throw new Error(
      "Index vector strategy metadata is missing. Run `rgr upgrade` to rebuild safely.",
    )
  }
  if (!vectorIndexManifestCompatible(manifest.vectorIndex, config, vectorDimension)) {
    throw new Error(
      "Index vector strategy is incompatible or incomplete. Run `rgr upgrade` to rebuild safely, or repair incomplete coverage with `rgr storage optimize`.",
    )
  }
  return { ...manifest, vectorIndex: manifest.vectorIndex }
}

type IndexManifestWithVectorIndex = IndexManifest & {
  vectorIndex: VectorIndexManifest
}

function contextChunkForRow(row: SearchRow): SearchContextChunk {
  return {
    chunkIndex: row.chunkIndex,
    contextPath: row.contextPath,
    text: row.text,
    charStart: nullableNumber(row.charStart),
    charEnd: nullableNumber(row.charEnd),
    lineStart: nullableLineNumber(row.lineStart),
    lineEnd: nullableLineNumber(row.lineEnd),
    pageStart: nullablePageNumber(row.pageStart),
    pageEnd: nullablePageNumber(row.pageEnd),
    citation: citationForRow(row),
  }
}

function matchedQueryTerms(projectRoot: string, queryTokens: string[], text: string): string[] {
  if (queryExplanationDiagnostics.hasSubscribers) {
    queryExplanationDiagnostics.publish({ projectRoot })
  }
  const textTokens = tokenize(text)
  return [...new Set(queryTokens)].filter((queryToken) =>
    textTokens.some((textToken) => tokensAreLexicallyRelated(queryToken, textToken)),
  )
}

function assertIndexFreshness(
  config: Awaited<ReturnType<typeof loadConfig>>,
  manifest: IndexManifest | null,
): void {
  if (!manifest) {
    throw new Error("Index manifest is missing. Run `rgr upgrade` before searching.")
  }
  const freshnessWarning = indexFreshnessWarning(config, manifest)
  if (freshnessWarning) {
    throw new Error(freshnessWarning)
  }
}

function rowKey(row: SearchRow): string {
  return `${row.relativePath}\0${row.chunkIndex}`
}

function parseCitationTarget(citation: string): { relativePath: string; chunkIndex: number } {
  const match = /#(\d+)$/u.exec(citation)
  const chunkIndexText = match?.[1]
  if (!match || chunkIndexText === undefined) {
    throw new Error("Citation must end with a Ragmir chunk suffix such as `#3`.")
  }

  const chunkIndex = Number.parseInt(chunkIndexText, 10)
  let relativePath = canonicalUserPath(citation.slice(0, match.index))
  relativePath = stripCitationCoordinates(relativePath)
  if (!relativePath) {
    throw new Error("Citation must include a source path before its chunk suffix.")
  }
  return { relativePath, chunkIndex }
}

function normalizeContextRadius(contextRadius: number | undefined): number {
  if (contextRadius === undefined) {
    return 0
  }
  if (!Number.isInteger(contextRadius) || contextRadius < 0) {
    throw new RagmirError("INVALID_ARGUMENT", "contextRadius must be a non-negative integer.")
  }
  return Math.min(contextRadius, MAX_CONTEXT_RADIUS)
}

function normalizeTopK(topK: number): number {
  if (!Number.isSafeInteger(topK) || topK <= 0) {
    throw new RagmirError("INVALID_ARGUMENT", "topK must be a positive integer.")
  }
  if (topK > MAX_SEARCH_TOP_K) {
    throw new RagmirError("INVALID_ARGUMENT", `topK must be at most ${MAX_SEARCH_TOP_K}.`)
  }
  return topK
}

function normalizeMaxChunksPerDocument(maxChunksPerDocument: number): number {
  if (!Number.isSafeInteger(maxChunksPerDocument) || maxChunksPerDocument <= 0) {
    throw new RagmirError("INVALID_ARGUMENT", "maxChunksPerDocument must be a positive integer.")
  }
  if (maxChunksPerDocument > MAX_SEARCH_TOP_K) {
    throw new RagmirError(
      "INVALID_ARGUMENT",
      `maxChunksPerDocument must be at most ${MAX_SEARCH_TOP_K}.`,
    )
  }
  return maxChunksPerDocument
}

function diversityCandidateDemand(topK: number, maxChunksPerDocument: number): number {
  const multiplier = Math.max(1, Math.ceil(DIVERSITY_CANDIDATE_MULTIPLIER / maxChunksPerDocument))
  return topK * multiplier
}

function citationForRow(row: SearchRow): string {
  return citationForCoordinates(row)
}

function lexicalQuery(
  query: string,
): { primary: FullTextQuery; supplemental: FullTextQuery[] } | null {
  const tokens = [...new Set(tokenize(query))]
  if (tokens.length === 0) {
    return null
  }
  const joined = tokens.join(" ")
  const broadQuery = new MatchQuery(joined, "searchText", { operator: Operator.Or })
  const supplemental: FullTextQuery[] = []
  const identifierTerms = [...normalizeForMatch(query).matchAll(LEXICAL_IDENTIFIER_PATTERN)]
    .map((match) => match[0])
    .filter(Boolean)
  const identifiers = [...new Set(identifierTerms)]
  // Only identifiers with a digit, underscore, or dot must match exactly. Hyphenated words such as
  // "t-score" or the French "est-elle" boost the passages that contain them without excluding others.
  const exactIdentifiers = identifiers.filter((identifier) => /[\d_.]/u.test(identifier))
  const hyphenatedWords = identifiers.filter((identifier) => !/[\d_.]/u.test(identifier))
  const rankedQuery: FullTextQuery =
    hyphenatedWords.length === 0
      ? broadQuery
      : new BooleanQuery([
          [Occur.Should, broadQuery],
          ...hyphenatedWords.map((word): [Occur, FullTextQuery] => [
            Occur.Should,
            new PhraseQuery(word, "searchText"),
          ]),
        ])
  const firstIdentifier = exactIdentifiers[0]
  if (firstIdentifier !== undefined) {
    const firstExactIdentifierQuery = new PhraseQuery(firstIdentifier, "searchText")
    const exactIdentifierQueries = [
      firstExactIdentifierQuery,
      ...exactIdentifiers.slice(1).map((identifier) => new PhraseQuery(identifier, "searchText")),
    ]
    const exactIdentifierQuery: FullTextQuery =
      exactIdentifierQueries.length === 1
        ? firstExactIdentifierQuery
        : new BooleanQuery(
            exactIdentifierQueries.map((item): [Occur, FullTextQuery] => [Occur.Should, item]),
          )
    const fuzzyIdentifierQuery = new BooleanQuery(
      exactIdentifiers.map((identifier): [Occur, FullTextQuery] => [
        Occur.Should,
        new MatchQuery(identifier, "searchText", {
          boost: 2,
          fuzziness: 1,
          operator: Operator.And,
          prefixLength: 3,
        }),
      ]),
    )
    supplemental.push(fuzzyIdentifierQuery, rankedQuery)
    return {
      primary: new BooleanQuery([
        [Occur.Must, exactIdentifierQuery],
        [Occur.Should, rankedQuery],
      ]),
      supplemental,
    }
  }
  if (tokens.length > 1) {
    supplemental.push(new PhraseQuery(joined, "searchText"))
  }
  const rareTerms = tokens
    .filter(isFuzzyLexicalTerm)
    .sort((left, right) => right.length - left.length || left.localeCompare(right))
    .slice(0, 3)
  for (const term of rareTerms) {
    supplemental.push(
      new MatchQuery(term, "searchText", {
        boost: 1.25,
        fuzziness: 1,
        prefixLength: 3,
      }),
    )
  }
  return {
    primary: rankedQuery,
    supplemental,
  }
}

function isFuzzyLexicalTerm(term: string): boolean {
  return term.length >= 7 && /^[a-z0-9_.-]+$/u.test(term)
}

function sourcePathPredicateForQuery(
  query: string,
): { predicate: string; exactRelativePath: string | null } | null {
  const normalized = canonicalUserPath(query)
  if (!SOURCE_PATH_QUERY_PATTERN.test(normalized)) {
    return null
  }
  const fileName = normalized.split("/").at(-1)
  if (!fileName) {
    return null
  }
  const clauses = new Set<string>(
    [normalized, fileName].flatMap((value) => [
      relativePathEquals(value),
      ...unicodePathVariants(fileName).map(
        (variant) => `ends_with(relativePath, ${sqlString(`/${variant}`)})`,
      ),
    ]),
  )
  return {
    predicate: `(${[...clauses].join(" OR ")})`,
    exactRelativePath: normalized.includes("/") ? normalized : null,
  }
}

function compareChunkRows(a: SearchRow, b: SearchRow): number {
  return a.chunkIndex - b.chunkIndex
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function nullableLineNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null
}

function nullablePageNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}
