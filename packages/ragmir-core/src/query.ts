import { channel } from "node:diagnostics_channel"
import {
  type Connection,
  type FullTextQuery,
  MatchQuery,
  Operator,
  PhraseQuery,
} from "@lancedb/lancedb"
import { flushAccessLog, recordAccess } from "./access-log.js"
import { citationForCoordinates, stripCitationCoordinates } from "./citation.js"
import { loadConfig } from "./config.js"
import { MAX_SEARCH_TOP_K, VECTOR_DISTANCE_METRIC } from "./defaults.js"
import { embedText } from "./embeddings.js"
import { RagmirError } from "./errors.js"
import { acquireGenerationReadLease } from "./generation-retention.js"
import { indexFreshnessWarning } from "./index-diagnostics.js"
import { operationSignal, throwIfAborted } from "./operation.js"
import { sanitizeRetrievalQuery } from "./query-sanitizer.js"
import type { RankedRow } from "./ranking.js"
import {
  candidatePassesAbstention,
  queryEvidence,
  rankHybridRows,
  rankingPolicyFingerprint,
  rankingPolicyFor,
  tokensAreLexicallyRelated,
} from "./ranking.js"
import type { IndexReadSnapshot } from "./store.js"
import { closeIndexReadSnapshot, loadIndexReadSnapshot } from "./store.js"
import { tokenize } from "./text.js"
import type {
  AskResult,
  Config,
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
  source: string
  relativePath: string
  chunkIndex: number
  contextPath: string
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
  _distance?: number
  _score?: number
}

const VECTOR_CANDIDATE_POLICY: Record<
  RetrievalProfile,
  { minimum: number; multiplier: number; maxChunksPerSource: number }
> = {
  fast: { minimum: 40, multiplier: 3, maxChunksPerSource: 1 },
  balanced: { minimum: 80, multiplier: 4, maxChunksPerSource: 2 },
  quality: { minimum: 200, multiplier: 8, maxChunksPerSource: 4 },
  custom: { minimum: 80, multiplier: 4, maxChunksPerSource: 2 },
}
const LEXICAL_CANDIDATE_POLICY: Record<RetrievalProfile, { minimum: number; multiplier: number }> =
  {
    fast: { minimum: 100, multiplier: 10 },
    balanced: { minimum: 250, multiplier: 20 },
    quality: { minimum: 500, multiplier: 40 },
    custom: { minimum: 250, multiplier: 20 },
  }
const MAX_CONTEXT_RADIUS = 3
const MAX_VECTOR_CANDIDATES = 1_000
const MAX_LEXICAL_CANDIDATES = 4_000
const FULL_TEXT_INDEX_NAME = "searchText_idx"
const LEXICAL_IDENTIFIER_PATTERN = /[\p{L}\p{N}]+(?:[-_.][\p{L}\p{N}]+)+/gu
const SOURCE_PATH_QUERY_PATTERN = /^[\p{L}\p{N}_. /\\-]+\.[a-z0-9]{1,12}$/iu
export const QUERY_EXPLANATION_DIAGNOSTICS_CHANNEL = "ragmir:query-explanation"
const queryExplanationDiagnostics = channel(QUERY_EXPLANATION_DIAGNOSTICS_CHANNEL)
const SEARCH_COLUMNS = [
  "source",
  "relativePath",
  "chunkIndex",
  "contextPath",
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
}

interface LexicalCandidateOptions {
  ftsLimit: number
  fallbackLimit: number
  indexedChunkCount: number
  minimumResults: number
  pathPredicate: string | null
}

export async function search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
  const config = await loadConfig(String(options.cwd ?? process.cwd()))
  const results = await searchWithConfig(query, options, config)
  await flushAccessLog(config)
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
  const topK = normalizeTopK(options.topK ?? config.topK)
  const defaultContextRadius = config.retrievalProfile === "quality" ? 1 : 0
  const contextRadius = normalizeContextRadius(options.contextRadius ?? defaultContextRadius)
  throwIfAborted(signal)
  const table = snapshot.table
  throwIfAborted(signal)
  if (!table) {
    return []
  }
  assertIndexFreshness(config, snapshot.manifest)

  const sanitized = sanitizeRetrievalQuery(query)
  const evidence = queryEvidence(sanitized.query)
  const queryTokens = evidence.tokens
  if (!sanitized.query || queryTokens.length === 0) {
    return []
  }

  const retrievalPredicate = searchPredicate(
    options.includePaths,
    options.excludePaths,
    options.contextPaths,
  )
  let embeddingQueueMs = 0
  const [vector, lexicalCandidates] = await Promise.all([
    embedText(sanitized.query, config, signal, ({ queueTimeMs }) => {
      embeddingQueueMs = queueTimeMs
    }),
    lexicalCandidateRows(table, sanitized.query, {
      ftsLimit: lexicalCandidateLimit(topK, config.retrievalProfile),
      fallbackLimit: config.hybridTextScanLimit,
      indexedChunkCount: snapshot.manifest?.chunkCount ?? 0,
      minimumResults: topK,
      pathPredicate: retrievalPredicate,
    }),
  ])
  throwIfAborted(signal)
  const manifest = assertVectorIndexCompatibility(config, snapshot.manifest, vector.length)
  const vectorQuery = configureAdaptiveVectorQuery(
    table.vectorSearch(vector).select(VECTOR_SEARCH_COLUMNS),
    manifest.vectorIndex,
    options.vectorSearchMode === "exact",
  )
  const vectorRows = (await (retrievalPredicate
    ? vectorQuery.where(retrievalPredicate)
    : vectorQuery
  )
    .limit(vectorCandidateLimit(topK, config.retrievalProfile))
    .toArray()) as SearchRow[]
  throwIfAborted(signal)
  const rankingPolicy = rankingPolicyFor(config.embeddingProvider, config.retrievalProfile)
  const rankedRows = rankHybridRows(
    sanitized.query,
    vectorRows,
    lexicalCandidates.rows,
    rankingPolicy,
  )
  const relevantRows = rankedRows.filter(
    (ranked) =>
      lexicalCandidates.exactPathMatches.has(rowKey(ranked.row)) ||
      candidatePassesAbstention(evidence, ranked.row, rankingPolicy),
  )
  const rows = diversifyRows(
    relevantRows,
    topK,
    config.retrievalProfile,
    lexicalCandidates.exactPathMatches,
  )
  const contextByRow = await contextChunksByRow(table, rows, contextRadius, retrievalPredicate)
  throwIfAborted(signal)

  const results = rows.map((row) => {
    const vectorDistance = typeof row.row._distance === "number" ? row.row._distance : null
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
      ...(options.explain
        ? {
            score: {
              fusion: "rrf" as const,
              combinedScore: row.combinedScore,
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
              workloadQueueMs: workloadQueueMs + embeddingQueueMs,
              rankingPolicyFingerprint: rankingPolicyFingerprint(rankingPolicy),
              matchedTerms: matchedQueryTerms(config.projectRoot, queryTokens, row.row.searchText),
            },
          }
        : {}),
    }
  })
  void recordAccess(config, {
    action: "search",
    query: sanitized.query,
    topK,
    resultCount: results.length,
  })
  return results
}

function diversifyRows(
  rows: Array<RankedRow<SearchRow>>,
  topK: number,
  profile: RetrievalProfile,
  exactPathMatches: ReadonlySet<string>,
): Array<RankedRow<SearchRow>> {
  const uniqueRows: Array<RankedRow<SearchRow>> = []
  const textIndexes = new Map<string, number>()

  for (const row of rows) {
    const textKey = row.row.text.replace(/\s+/gu, " ").trim().toLowerCase()
    const existingIndex = textIndexes.get(textKey)
    if (existingIndex === undefined) {
      textIndexes.set(textKey, uniqueRows.length)
      uniqueRows.push(row)
      continue
    }
    const existing = uniqueRows[existingIndex]
    const existingIsExact = existing ? exactPathMatches.has(rowKey(existing.row)) : false
    const candidateIsExact = exactPathMatches.has(rowKey(row.row))
    if (
      existing &&
      (candidateIsExact !== existingIsExact
        ? candidateIsExact
        : preferCanonicalPath(row.row.relativePath, existing.row.relativePath))
    ) {
      uniqueRows[existingIndex] = row
    }
  }

  const selected: Array<RankedRow<SearchRow>> = []
  const selectedKeys = new Set<string>()
  const perSource = new Map<string, number>()
  const maxChunksPerSource = VECTOR_CANDIDATE_POLICY[profile].maxChunksPerSource
  const appendRow = (row: RankedRow<SearchRow>, enforceSourceCap: boolean): void => {
    const key = rowKey(row.row)
    if (selectedKeys.has(key)) {
      return
    }
    if (selected.some((candidate) => overlapsSourceSpan(candidate.row, row.row))) {
      return
    }
    const sourceCount = perSource.get(row.row.relativePath) ?? 0
    if (enforceSourceCap && sourceCount >= maxChunksPerSource) {
      return
    }
    selected.push(row)
    selectedKeys.add(key)
    perSource.set(row.row.relativePath, sourceCount + 1)
  }

  for (const row of uniqueRows) {
    appendRow(row, true)
    if (selected.length >= topK) {
      return selected
    }
  }

  for (const row of uniqueRows) {
    appendRow(row, false)
    if (selected.length >= topK) {
      break
    }
  }

  return selected
}

function overlapsSourceSpan(left: SearchRow, right: SearchRow): boolean {
  if (left.relativePath !== right.relativePath) {
    return false
  }
  if (
    typeof left.charStart !== "number" ||
    typeof left.charEnd !== "number" ||
    typeof right.charStart !== "number" ||
    typeof right.charEnd !== "number"
  ) {
    return false
  }
  return left.charStart < right.charEnd && right.charStart < left.charEnd
}

function preferCanonicalPath(candidate: string, current: string): boolean {
  const candidateDepth = candidate.split("/").length
  const currentDepth = current.split("/").length
  return (
    candidateDepth < currentDepth ||
    (candidateDepth === currentDepth && candidate.length < current.length)
  )
}

export function vectorCandidateLimit(topK: number, profile: RetrievalProfile = "balanced"): number {
  const policy = VECTOR_CANDIDATE_POLICY[profile]
  return Math.min(MAX_VECTOR_CANDIDATES, Math.max(policy.minimum, topK * policy.multiplier))
}

export function lexicalCandidateLimit(
  topK: number,
  profile: RetrievalProfile = "balanced",
): number {
  const policy = LEXICAL_CANDIDATE_POLICY[profile]
  return Math.min(MAX_LEXICAL_CANDIDATES, Math.max(policy.minimum, topK * policy.multiplier))
}

export async function ask(query: string, options: SearchOptions = {}): Promise<AskResult> {
  const config = await loadConfig(String(options.cwd ?? process.cwd()))
  return askWithConfig(query, options, config)
}

export async function askWithConfig(
  query: string,
  options: SearchOptions,
  config: Config,
  connection?: Connection,
  snapshot?: IndexReadSnapshot,
): Promise<AskResult> {
  const signal = operationSignal(options)
  throwIfAborted(signal)
  const sources = await searchWithConfig(query, options, config, connection, signal, snapshot)
  const staleWarning = null
  throwIfAborted(signal)

  if (sources.length === 0) {
    return {
      answer: "No relevant passages were found. Add documents and run `rgr doctor --fix` first.",
      sources,
      staleWarning,
    }
  }

  await recordAccess(config, {
    action: "ask",
    query: sanitizeRetrievalQuery(query).query,
    topK: options.topK ?? config.topK,
    resultCount: sources.length,
  })

  return {
    answer: retrievalOnlyAnswer(sources),
    sources,
    staleWarning,
  }
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
      `relativePath = ${sqlString(target.relativePath)} AND chunkIndex >= ${minimumChunkIndex} AND chunkIndex <= ${maximumChunkIndex}`,
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
  if (citationForRow(targetRow) !== requestedCitation) {
    throw new Error("Citation coordinates do not match the indexed passage.")
  }

  return {
    requestedCitation,
    found: true,
    relativePath: target.relativePath,
    chunkIndex: target.chunkIndex,
    contextRadius,
    passages: rows.sort(compareChunkRows).map(contextChunkForRow),
  }
}

function retrievalOnlyAnswer(sources: SearchResult[]): string {
  const snippets = sources
    .map((source, index) => {
      const text = answerText(source).replace(/\s+/gu, " ").trim()
      return `[${index + 1}] ${source.citation}: ${text}`
    })
    .join("\n\n")

  return [
    "Ragmir returns retrieval context only. Use these passages as grounded context for your agent or LLM:",
    "",
    snippets,
  ].join("\n")
}

async function lexicalCandidateRows(
  table: RowsTable,
  query: string,
  options: LexicalCandidateOptions,
): Promise<LexicalCandidateSet> {
  const ftsQueries = lexicalQuery(query)
  const stats = await table.indexStats(FULL_TEXT_INDEX_NAME).catch(() => undefined)
  let fallbackReason: LexicalCandidateSet["fallbackReason"] = "fts-index-unavailable"
  if (ftsQueries && stats) {
    try {
      const sourcePathQuery = sourcePathPredicateForQuery(query)
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
          const supplementalRows = await executeFullTextQuery(
            table,
            supplementalQuery,
            options.ftsLimit,
            options.pathPredicate,
          ).catch(() => [])
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
        sourcePathQuery?.exactRelativePath
          ? sourcePathRows
              .filter((row) => row.relativePath === sourcePathQuery.exactRelativePath)
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
      }
    } catch {
      fallbackReason = "fts-query-failed"
      // A complete bounded scan remains safe for small or explicitly bounded corpora.
    }
  }
  if (options.fallbackLimit < options.indexedChunkCount) {
    throw new RagmirError(
      "INDEX_UNAVAILABLE",
      `Full-text search is unavailable and the fallback limit would scan only ${options.fallbackLimit} of ${options.indexedChunkCount} chunks. Run \`rgr storage optimize\` or rebuild the index before searching.`,
      { retryable: true },
    )
  }
  const fallbackQuery = table.query().select(SEARCH_COLUMNS)
  const rows = (await (options.pathPredicate
    ? fallbackQuery.where(options.pathPredicate)
    : fallbackQuery
  )
    .limit(options.fallbackLimit)
    .toArray()) as SearchRow[]
  return {
    rows,
    exactPathMatches: new Set(),
    backend: "fallback",
    fallbackActivated: true,
    fallbackReason,
    candidateLimit: options.fallbackLimit,
    candidatesMaterialized: rows.length,
    queryVariants: 0,
    indexedRows: 0,
    unindexedRows: options.indexedChunkCount,
    coverage:
      options.indexedChunkCount === 0 ? 1 : Math.min(1, rows.length / options.indexedChunkCount),
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
        sourcePathQuery.exactRelativePath === (row as SearchRow).relativePath
          ? Number.MAX_SAFE_INTEGER
          : Number.MAX_SAFE_INTEGER - 1,
    }),
  )
}

function searchPredicate(
  includePaths: string[] | undefined,
  excludePaths: string[] | undefined,
  contextPaths: string[] | undefined,
): string | null {
  const includes = normalizePathPrefixes(includePaths)
  const excludes = normalizePathPrefixes(excludePaths)
  const contexts = normalizeContextPaths(contextPaths)
  const clauses: string[] = []

  if (includes.length > 0) {
    clauses.push(`(${includes.map(pathPrefixPredicate).join(" OR ")})`)
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
  return [
    ...new Set(
      (prefixes ?? [])
        .map((prefix) => prefix.trim().replaceAll("\\", "/").replace(/^\.\//u, ""))
        .map((prefix) => prefix.replace(/\/+$/u, ""))
        .filter(Boolean),
    ),
  ]
}

function pathPrefixPredicate(prefix: string): string {
  return `(relativePath = ${sqlString(prefix)} OR starts_with(relativePath, ${sqlString(`${prefix}/`)}))`
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
  if (radius === 0 || rows.length === 0) {
    return new Map()
  }

  const ranges = contextRangesByPath(rows, radius)
  const predicates = [...ranges.entries()].flatMap(([relativePath, pathRanges]) =>
    pathRanges.map(
      ({ minimum, maximum }) =>
        `(relativePath = ${sqlString(relativePath)} AND chunkIndex >= ${minimum} AND chunkIndex <= ${maximum})`,
    ),
  )
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
      (candidate) => candidate.chunkIndex >= minChunk && candidate.chunkIndex <= maxChunk,
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

function answerText(source: SearchResult): string {
  if (source.context.length === 0) {
    return source.text
  }
  return source.context.map((chunk) => `[${chunk.citation}] ${chunk.text}`).join("\n\n")
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
  let relativePath = citation.slice(0, match.index)
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
  const supplemental: FullTextQuery[] = []
  if (tokens.length > 1) {
    supplemental.push(new PhraseQuery(joined, "searchText"))
  }
  const identifierTerms = [...query.matchAll(LEXICAL_IDENTIFIER_PATTERN)]
    .map((match) => match[0])
    .filter(Boolean)
  for (const identifier of [...new Set(identifierTerms)]) {
    supplemental.push(
      new MatchQuery(identifier, "searchText", {
        boost: 2,
        ...(isFuzzyLexicalTerm(identifier) ? { fuzziness: 1, prefixLength: 3 } : {}),
      }),
    )
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
    primary: new MatchQuery(joined, "searchText", { operator: Operator.Or }),
    supplemental,
  }
}

function isFuzzyLexicalTerm(term: string): boolean {
  return term.length >= 7 && /^[a-z0-9_.-]+$/u.test(term)
}

function sourcePathPredicateForQuery(
  query: string,
): { predicate: string; exactRelativePath: string | null } | null {
  const normalized = query.trim().replaceAll("\\", "/").replace(/^\.\//u, "")
  if (!SOURCE_PATH_QUERY_PATTERN.test(normalized)) {
    return null
  }
  const fileName = normalized.split("/").at(-1)
  if (!fileName) {
    return null
  }
  const clauses = new Set<string>([
    `relativePath = ${sqlString(normalized)}`,
    `relativePath = ${sqlString(fileName)}`,
    `ends_with(relativePath, ${sqlString(`/${fileName}`)})`,
  ])
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
