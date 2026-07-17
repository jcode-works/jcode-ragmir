import type { Connection } from "@lancedb/lancedb"
import { recordAccess } from "./access-log.js"
import { citationForCoordinates, stripCitationCoordinates } from "./citation.js"
import { loadConfig } from "./config.js"
import { VECTOR_DISTANCE_METRIC } from "./defaults.js"
import { embedText } from "./embeddings.js"
import { RagmirError } from "./errors.js"
import { withActiveGenerationReadLease } from "./generation-retention.js"
import { getIndexFreshnessWarning } from "./index-diagnostics.js"
import { operationSignal, throwIfAborted } from "./operation.js"
import { sanitizeRetrievalQuery } from "./query-sanitizer.js"
import { openRowsTableByName, readIndexManifest } from "./store.js"
import { tokenize } from "./text.js"
import type {
  AskResult,
  Config,
  ExpandCitationOptions,
  ExpandedCitation,
  RetrievalProfile,
  SearchContextChunk,
  SearchOptions,
  SearchResult,
  SourceLocationKind,
  VectorIndexManifest,
} from "./types.js"
import { configureAdaptiveVectorQuery, vectorIndexManifestCompatible } from "./vector-index.js"

type RowsTable = NonNullable<Awaited<ReturnType<typeof openRowsTableByName>>>

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

interface RankedRow {
  row: SearchRow
  vectorScore: number
  lexicalScore: number
  combinedScore: number
  vectorRank: number | null
  lexicalRank: number | null
  lexicalBackendScore: number | null
  matchedTerms: string[]
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
/**
 * Reciprocal Rank Fusion (Cormack et al. 2009). Each candidate scores
 * `weight / (RRF_K + rank)` per retriever it appears in, summed across
 * retrievers. Rank-only fusion removes the score-calibration problem of
 * weighted-sum fusion: the BM25 and vector score distributions never need to
 * be normalized against each other.
 *
 * Equal weights let exact lexical evidence rescue a relevant document that is
 * absent from the bounded vector candidate pool.
 */
const RRF_K = 60
const RRF_VECTOR_WEIGHT = 1
const RRF_LEXICAL_WEIGHT = 1
const BM25_K1 = 1.2
const BM25_B = 0.75
const MAX_CONTEXT_RADIUS = 3
const MIN_FUZZY_TOKEN_LENGTH = 7
const MIN_TRIGRAM_DICE_SIMILARITY = 0.5
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

export async function search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
  const config = await loadConfig(String(options.cwd ?? process.cwd()))
  return searchWithConfig(query, options, config)
}

export async function searchWithConfig(
  query: string,
  options: SearchOptions,
  config: Config,
  connection?: Connection,
  activeSignal?: AbortSignal,
): Promise<SearchResult[]> {
  return withActiveGenerationReadLease(config, (tableName) =>
    searchWithinGeneration(query, options, config, tableName, connection, activeSignal),
  )
}

async function searchWithinGeneration(
  query: string,
  options: SearchOptions,
  config: Config,
  tableName: string,
  connection?: Connection,
  activeSignal?: AbortSignal,
): Promise<SearchResult[]> {
  const signal = activeSignal ?? operationSignal(options)
  const topK = normalizeTopK(options.topK ?? config.topK)
  const defaultContextRadius = config.retrievalProfile === "quality" ? 1 : 0
  const contextRadius = normalizeContextRadius(options.contextRadius ?? defaultContextRadius)
  throwIfAborted(signal)
  const table = await openRowsTableByName(tableName, config, connection)
  throwIfAborted(signal)
  if (!table) {
    return []
  }
  await assertIndexFreshness(config)

  const sanitized = sanitizeRetrievalQuery(query)
  const queryTokens = tokenize(sanitized.query)
  if (!sanitized.query || queryTokens.length === 0) {
    return []
  }

  const retrievalPredicate = searchPredicate(
    options.includePaths,
    options.excludePaths,
    options.contextPaths,
  )
  const [vector, textRows] = await Promise.all([
    embedText(sanitized.query, config),
    lexicalCandidateRows(table, sanitized.query, config.hybridTextScanLimit, retrievalPredicate),
  ])
  throwIfAborted(signal)
  const manifest = await assertVectorIndexCompatibility(config, vector.length)
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
  const rankedRows = rankHybridRows(sanitized.query, vectorRows, textRows)
  const relevantRows =
    config.embeddingProvider === "local-hash"
      ? rankedRows.filter((ranked) => hasLexicalOverlap(queryTokens, ranked.row.searchText))
      : rankedRows
  const rows = diversifyRows(relevantRows, topK, config.retrievalProfile)
  const contextByRow = await contextChunksByRow(table, rows, contextRadius)
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
              matchedTerms: row.matchedTerms,
            },
          }
        : {}),
    }
  })
  await recordAccess(config, {
    action: "search",
    query: sanitized.query,
    topK,
    resultCount: results.length,
  })
  return results
}

function diversifyRows(rows: RankedRow[], topK: number, profile: RetrievalProfile): RankedRow[] {
  const uniqueRows: RankedRow[] = []
  const textIndexes = new Map<string, number>()

  for (const row of rows) {
    const textKey = `${row.row.contextPath}\0${row.row.text.replace(/\s+/gu, " ").trim().toLowerCase()}`
    const existingIndex = textIndexes.get(textKey)
    if (existingIndex === undefined) {
      textIndexes.set(textKey, uniqueRows.length)
      uniqueRows.push(row)
      continue
    }
    const existing = uniqueRows[existingIndex]
    if (existing && preferCanonicalPath(row.row.relativePath, existing.row.relativePath)) {
      uniqueRows[existingIndex] = row
    }
  }

  const selected: RankedRow[] = []
  const perSource = new Map<string, number>()
  const maxChunksPerSource = VECTOR_CANDIDATE_POLICY[profile].maxChunksPerSource

  for (const row of uniqueRows) {
    if (selected.some((candidate) => overlapsSourceSpan(candidate.row, row.row))) {
      continue
    }
    const sourceCount = perSource.get(row.row.relativePath) ?? 0
    if (sourceCount >= maxChunksPerSource) {
      continue
    }
    selected.push(row)
    perSource.set(row.row.relativePath, sourceCount + 1)
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

function hasLexicalOverlap(queryTokens: string[], text: string): boolean {
  const textTokens = tokenize(text)
  return queryTokens.some((queryToken) =>
    textTokens.some((textToken) => tokensAreLexicallyRelated(queryToken, textToken)),
  )
}

function tokensAreLexicallyRelated(queryToken: string, textToken: string): boolean {
  if (queryToken === textToken) {
    return true
  }
  if (
    queryToken.length >= 4 &&
    textToken.length >= 4 &&
    sharedPrefixLength(queryToken, textToken) >= 4
  ) {
    return true
  }
  if (
    queryToken.length < MIN_FUZZY_TOKEN_LENGTH ||
    textToken.length < MIN_FUZZY_TOKEN_LENGTH ||
    Math.abs(queryToken.length - textToken.length) > 1 ||
    !/^[a-z0-9_-]+$/u.test(queryToken) ||
    !/^[a-z0-9_-]+$/u.test(textToken)
  ) {
    return false
  }
  return trigramDiceSimilarity(queryToken, textToken) >= MIN_TRIGRAM_DICE_SIMILARITY
}

function trigramDiceSimilarity(left: string, right: string): number {
  const leftTrigrams = tokenTrigrams(left)
  const rightTrigrams = tokenTrigrams(right)
  let shared = 0
  for (const trigram of leftTrigrams) {
    if (rightTrigrams.has(trigram)) {
      shared += 1
    }
  }
  return (2 * shared) / (leftTrigrams.size + rightTrigrams.size)
}

function tokenTrigrams(token: string): Set<string> {
  return new Set(
    Array.from({ length: token.length - 2 }, (_value, index) => token.slice(index, index + 3)),
  )
}

function sharedPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length)
  let index = 0
  while (index < limit && left[index] === right[index]) {
    index += 1
  }
  return index
}

export function vectorCandidateLimit(topK: number, profile: RetrievalProfile = "balanced"): number {
  const policy = VECTOR_CANDIDATE_POLICY[profile]
  return Math.max(policy.minimum, topK * policy.multiplier)
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
): Promise<AskResult> {
  const signal = operationSignal(options)
  throwIfAborted(signal)
  const sources = await searchWithConfig(query, options, config, connection, signal)
  const staleWarning = await getIndexFreshnessWarning(config)
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
): Promise<ExpandedCitation> {
  return withActiveGenerationReadLease(config, (tableName) =>
    expandCitationWithinGeneration(citation, options, config, tableName, connection),
  )
}

async function expandCitationWithinGeneration(
  citation: string,
  options: ExpandCitationOptions,
  config: Config,
  tableName: string,
  connection?: Connection,
): Promise<ExpandedCitation> {
  const signal = operationSignal(options)
  throwIfAborted(signal)
  const requestedCitation = citation.trim()
  const target = parseCitationTarget(requestedCitation)
  const contextRadius = normalizeContextRadius(options.contextRadius)
  const table = await openRowsTableByName(tableName, config, connection)
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

  const manifest = await readIndexManifest(config)
  if (!manifest) {
    throw new Error(
      "Index manifest is missing. Rebuild with `rgr ingest --rebuild` before expanding citations.",
    )
  }
  const freshnessWarning = await getIndexFreshnessWarning(config)
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
  limit: number,
  pathPredicate: string | null,
): Promise<SearchRow[]> {
  const ftsQuery = lexicalQuery(query)
  if (ftsQuery) {
    try {
      const searchQuery = table.search(ftsQuery, "fts", "searchText").select(FTS_SEARCH_COLUMNS)
      return (await (pathPredicate ? searchQuery.where(pathPredicate) : searchQuery)
        .limit(limit)
        .toArray()) as SearchRow[]
    } catch {
      // Older indexes may not have the FTS index yet. Keep retrieval usable and
      // let doctor/index freshness tell the operator to rebuild.
    }
  }
  const fallbackQuery = table.query().select(SEARCH_COLUMNS)
  return (await (pathPredicate ? fallbackQuery.where(pathPredicate) : fallbackQuery)
    .limit(limit)
    .toArray()) as SearchRow[]
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
  rows: RankedRow[],
  requestedRadius: number,
): Promise<Map<string, SearchContextChunk[]>> {
  const radius = Math.min(MAX_CONTEXT_RADIUS, Math.max(0, requestedRadius))
  if (radius === 0 || rows.length === 0) {
    return new Map()
  }

  const predicates = rows.map(({ row }) => {
    const minChunk = Math.max(0, row.chunkIndex - radius)
    const maxChunk = row.chunkIndex + radius
    return `(relativePath = ${sqlString(row.relativePath)} AND chunkIndex >= ${minChunk} AND chunkIndex <= ${maxChunk})`
  })
  const allContextRows = (await table
    .query()
    .select(SEARCH_COLUMNS)
    .where(predicates.join(" OR "))
    .toArray()) as SearchRow[]
  const contexts = new Map<string, SearchContextChunk[]>()
  for (const { row } of rows) {
    const minChunk = Math.max(0, row.chunkIndex - radius)
    const maxChunk = row.chunkIndex + radius
    const contextRows = allContextRows.filter(
      (candidate) =>
        candidate.relativePath === row.relativePath &&
        candidate.chunkIndex >= minChunk &&
        candidate.chunkIndex <= maxChunk,
    )
    contexts.set(rowKey(row), contextRows.sort(compareChunkRows).map(contextChunkForRow))
  }
  return contexts
}

async function assertVectorIndexCompatibility(
  config: Awaited<ReturnType<typeof loadConfig>>,
  vectorDimension: number,
): Promise<IndexManifestWithVectorIndex> {
  const manifest = await readIndexManifest(config)
  if (!manifest) {
    throw new Error(
      "Index manifest is missing. Rebuild with `rgr ingest --rebuild` before searching.",
    )
  }
  const freshnessWarning = await getIndexFreshnessWarning(config)
  if (freshnessWarning) {
    throw new Error(freshnessWarning)
  }
  if (manifest.vectorDimension !== undefined && manifest.vectorDimension !== vectorDimension) {
    throw new Error(
      `Index vector dimension is ${manifest.vectorDimension} but the active embedding produced ${vectorDimension}. Rebuild with \`rgr ingest --rebuild\`.`,
    )
  }
  if (
    manifest.vectorDistanceMetric !== undefined &&
    manifest.vectorDistanceMetric !== VECTOR_DISTANCE_METRIC
  ) {
    throw new Error(
      `Index vector distance metric is ${manifest.vectorDistanceMetric} but Ragmir expects ${VECTOR_DISTANCE_METRIC}. Rebuild with \`rgr ingest --rebuild\`.`,
    )
  }
  if (!manifest.vectorIndex) {
    throw new Error(
      "Index vector strategy metadata is missing. Rebuild with `rgr ingest --rebuild`.",
    )
  }
  if (!vectorIndexManifestCompatible(manifest.vectorIndex, config, vectorDimension)) {
    throw new Error(
      "Index vector strategy is incompatible or incomplete. Rebuild with `rgr ingest --rebuild` or repair coverage with `rgr storage optimize`.",
    )
  }
  return { ...manifest, vectorIndex: manifest.vectorIndex }
}

type IndexManifestWithVectorIndex = NonNullable<Awaited<ReturnType<typeof readIndexManifest>>> & {
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

/**
 * Reciprocal Rank Fusion of vector and lexical retrievers. Rank-only: each
 * candidate scores `1/(RRF_K + rank)` per retriever it appears in, summed.
 * This removes the score-calibration problem of weighted-sum fusion (the BM25
 * and vector score distributions have nothing in common) and is the standard
 * hybrid retrieval approach.
 *
 * Ranks are 0-based internally; a candidate absent from a retriever contributes
 * nothing from that retriever. Tie-breaks keep the result deterministic.
 */
function rankHybridRows(
  query: string,
  vectorRows: SearchRow[],
  textRows: SearchRow[],
): RankedRow[] {
  const queryTokens = tokenize(query)
  const rows = mergeRows(vectorRows, textRows)

  // Vector ranks: lower _distance is better, so sort ascending then assign rank 0..
  const vectorRanked = [...vectorRows]
    .filter((row) => Number.isFinite(rowDistance(row)))
    .sort((a, b) => rowDistance(a) - rowDistance(b))
  const vectorRanks = new Map<string, number>()
  vectorRanked.forEach((row, index) => {
    vectorRanks.set(rowKey(row), index)
  })

  // LanceDB FTS already returns BM25-ranked rows. The fallback scan computes
  // BM25 locally when an older index has no text index.
  const ftsRows = textRows.filter((row) => typeof row._score === "number")
  const lexicalRanked: Array<[string, number]> =
    ftsRows.length > 0
      ? ftsRows
          .sort((a, b) => (b._score ?? 0) - (a._score ?? 0))
          .map((row) => [rowKey(row), row._score ?? 0])
      : [...bm25Scores(queryTokens, rows).entries()]
          .filter(([, score]) => score > 0)
          .sort((a, b) => b[1] - a[1])
  const lexicalRanks = new Map<string, number>()
  lexicalRanked.forEach(([key], index) => {
    lexicalRanks.set(key, index)
  })
  const lexicalScores = new Map(lexicalRanked)

  return rows
    .map((row) => {
      const key = rowKey(row)
      const vectorRank = vectorRanks.get(key)
      const lexicalRank = lexicalRanks.get(key)
      let combinedScore = 0
      let vectorScore = 0
      let lexicalScore = 0
      if (vectorRank !== undefined) {
        vectorScore = RRF_VECTOR_WEIGHT / (RRF_K + vectorRank)
        combinedScore += vectorScore
      }
      if (lexicalRank !== undefined) {
        lexicalScore = RRF_LEXICAL_WEIGHT / (RRF_K + lexicalRank)
        combinedScore += lexicalScore
      }
      return {
        row,
        vectorScore,
        lexicalScore,
        combinedScore,
        vectorRank: vectorRank === undefined ? null : vectorRank + 1,
        lexicalRank: lexicalRank === undefined ? null : lexicalRank + 1,
        lexicalBackendScore: lexicalScores.get(key) ?? null,
        matchedTerms: matchedQueryTerms(queryTokens, row.searchText),
      }
    })
    .filter((ranked) => ranked.combinedScore > 0)
    .sort((a, b) => {
      const scoreDelta = b.combinedScore - a.combinedScore
      if (scoreDelta !== 0) {
        return scoreDelta
      }
      const distanceDelta = rowDistance(a.row) - rowDistance(b.row)
      if (Number.isFinite(distanceDelta) && distanceDelta !== 0) {
        return distanceDelta
      }
      return (
        a.row.relativePath.localeCompare(b.row.relativePath) || a.row.chunkIndex - b.row.chunkIndex
      )
    })
}

function matchedQueryTerms(queryTokens: string[], text: string): string[] {
  const textTokens = tokenize(text)
  return [...new Set(queryTokens)].filter((queryToken) =>
    textTokens.some((textToken) => tokensAreLexicallyRelated(queryToken, textToken)),
  )
}

function mergeRows(vectorRows: SearchRow[], textRows: SearchRow[]): SearchRow[] {
  const rows = new Map<string, SearchRow>()
  for (const row of textRows) {
    rows.set(rowKey(row), row)
  }
  for (const row of vectorRows) {
    const existing = rows.get(rowKey(row))
    if (!existing) {
      rows.set(rowKey(row), row)
      continue
    }
    const merged: SearchRow = { ...existing, ...row }
    if (existing._score !== undefined) {
      merged._score = existing._score
    }
    rows.set(rowKey(row), merged)
  }
  return [...rows.values()]
}

function bm25Scores(queryTokens: string[], rows: SearchRow[]): Map<string, number> {
  const scores = new Map<string, number>()
  if (queryTokens.length === 0 || rows.length === 0) {
    return scores
  }

  const uniqueQueryTokens = [...new Set(queryTokens)]
  const documents = rows.map((row) => {
    const tokens = tokenize(row.searchText)
    const frequencies = new Map<string, number>()
    for (const token of tokens) {
      frequencies.set(token, (frequencies.get(token) ?? 0) + 1)
    }
    return { row, tokens, frequencies }
  })
  const averageLength =
    documents.reduce((sum, document) => sum + document.tokens.length, 0) / documents.length || 1
  const documentFrequencies = new Map<string, number>()

  for (const token of uniqueQueryTokens) {
    documentFrequencies.set(
      token,
      documents.filter((document) => document.frequencies.has(token)).length,
    )
  }

  for (const document of documents) {
    let score = 0
    for (const token of uniqueQueryTokens) {
      const frequency = document.frequencies.get(token) ?? 0
      if (frequency === 0) {
        continue
      }
      const documentFrequency = documentFrequencies.get(token) ?? 0
      const inverseDocumentFrequency = Math.log(
        1 + (documents.length - documentFrequency + 0.5) / (documentFrequency + 0.5),
      )
      const denominator =
        frequency + BM25_K1 * (1 - BM25_B + BM25_B * (document.tokens.length / averageLength))
      score += inverseDocumentFrequency * ((frequency * (BM25_K1 + 1)) / denominator)
    }
    if (score > 0) {
      scores.set(rowKey(document.row), score)
    }
  }

  return scores
}

function rowDistance(row: SearchRow): number {
  return typeof row._distance === "number" && row._distance >= 0
    ? row._distance
    : Number.POSITIVE_INFINITY
}

async function assertIndexFreshness(config: Awaited<ReturnType<typeof loadConfig>>): Promise<void> {
  const manifest = await readIndexManifest(config)
  if (!manifest) {
    throw new Error(
      "Index manifest is missing. Rebuild with `rgr ingest --rebuild` before searching.",
    )
  }
  const freshnessWarning = await getIndexFreshnessWarning(config)
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
  return topK
}

function citationForRow(row: SearchRow): string {
  return citationForCoordinates(row)
}

function lexicalQuery(query: string): string {
  return [...new Set(tokenize(query))].join(" ")
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
