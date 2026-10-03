import { createHash } from "node:crypto"
import {
  addLexicalDocument,
  type LexicalCorpusStatistics,
  lexicalDocument,
  lexicalDocumentScore,
} from "./lexical-scoring.js"
import { tokenize } from "./text.js"
import type { EmbeddingProvider, RetrievalProfile } from "./types.js"

export interface RankingRow {
  relativePath: string
  chunkIndex: number
  searchText: string
  _distance?: number
  _score?: number
}

export interface RankedRow<Row extends RankingRow = RankingRow> {
  row: Row
  vectorScore: number
  lexicalScore: number
  combinedScore: number
  vectorRank: number | null
  lexicalRank: number | null
  lexicalBackendScore: number | null
}

export interface RankingPolicy {
  version: 6
  embeddingProvider: EmbeddingProvider
  retrievalProfile: RetrievalProfile
  maxChunksPerDocument: number
  rrfK: number
  vectorWeight: number
  lexicalWeight: number
  maximumVectorDistance: number | null
}

export interface QueryEvidence {
  query: string
  tokens: string[]
  anchors: string[]
}

const RRF_K = 60
const RRF_SEMANTIC_VECTOR_WEIGHT = 1
// The local-hash vector is another lexical signal without inverse document frequency. At full RRF
// weight it lifted common-word matches above BM25 evidence on code and document corpora, so it only
// breaks ties and backfills rows that the full-text index did not return.
const RRF_LOCAL_HASH_VECTOR_WEIGHT = 0.01
const RRF_LEXICAL_WEIGHT = 1
const MIN_LEXICAL_PREFIX_LENGTH = 4
const MIN_FUZZY_TOKEN_LENGTH = 7
const MIN_TRIGRAM_DICE_SIMILARITY = 0.5
const TRANSFORMERS_MAXIMUM_VECTOR_DISTANCE = 1.1
const IDENTIFIER_PATTERN = /[\p{L}\p{N}]+(?:[-_./][\p{L}\p{N}]+)+/gu
const LOW_INFORMATION_WORDS = new Set(
  (
    "a about an and are as at be been by can could describe did do does for from had has have how " +
    "i if in into is it its me my of on or our should that the their them there these they this to " +
    "us was we were what when where which who why will with would you your " +
    "au aux avec ce ces cet cette dans de des du elle elles en est et eux faire il ils je la le " +
    "les leur leurs lui ma mais me mes mon ne nos notre nous on ou par pas peux peut pour quel " +
    "quelle quelles quels qui quoi sa se ses son sont sur ta te tes toi ton tu un une vos votre vous " +
    "comment dois doit"
  ).split(" "),
)

export function rankingPolicyFor(
  embeddingProvider: EmbeddingProvider,
  retrievalProfile: RetrievalProfile,
  maxChunksPerDocument: number,
): RankingPolicy {
  return {
    version: 6,
    embeddingProvider,
    retrievalProfile,
    maxChunksPerDocument,
    rrfK: RRF_K,
    vectorWeight:
      embeddingProvider === "local-hash"
        ? RRF_LOCAL_HASH_VECTOR_WEIGHT
        : RRF_SEMANTIC_VECTOR_WEIGHT,
    lexicalWeight: RRF_LEXICAL_WEIGHT,
    maximumVectorDistance:
      embeddingProvider === "transformers" ? TRANSFORMERS_MAXIMUM_VECTOR_DISTANCE : null,
  }
}

export function rankingPolicyFingerprint(policy: RankingPolicy): string {
  return createHash("sha256").update(JSON.stringify(policy)).digest("hex")
}

/**
 * Per-list depth at which reciprocal-rank fusion cannot lift a row that is absent from every
 * candidate list above the demand-th fused row: such a row scores at most
 * 2 / (RRF_K + depth + 1), while at least demand rows score 1 / (RRF_K + demand) or more.
 */
export function fusionCandidateDepth(demand: number): number {
  return RRF_K + 2 * demand
}

export function queryEvidence(query: string): QueryEvidence {
  const tokens = tokenize(query).filter((token) => !LOW_INFORMATION_WORDS.has(token))
  const compoundAnchors = [...query.matchAll(IDENTIFIER_PATTERN)]
    .map((match) => match[0])
    .filter((anchor) => /\d|_|\.|\//u.test(anchor))
    .map(normalizeAnchor)
  const tokenAnchors = tokens.filter(
    (token) =>
      token.length >= 4 &&
      /\d/u.test(token) &&
      (/\p{L}/u.test(token) || /^\d{4,}$/u.test(token)) &&
      !compoundAnchors.some((anchor) => anchor.includes(token)),
  )
  return {
    query,
    tokens,
    anchors: [...new Set([...compoundAnchors, ...tokenAnchors])],
  }
}

export function rankHybridRows<Row extends RankingRow>(
  query: string,
  vectorRows: Row[],
  textRows: Row[],
  policy: RankingPolicy,
): Array<RankedRow<Row>> {
  const queryTokens = tokenize(query)
  const evidence = queryEvidence(query)
  const keys = new Map<Row, string>()
  const keyOf = (row: Row): string => {
    let key = keys.get(row)
    if (key === undefined) {
      key = rowKey(row)
      keys.set(row, key)
    }
    return key
  }
  const compareKeys = (left: Row, right: Row): number => keyOf(left).localeCompare(keyOf(right))
  const rows = mergeRows(vectorRows, textRows, keyOf, compareKeys)
  const exactAnchorMatches = new Map<string, number>()
  if (evidence.anchors.length > 0) {
    const requestedAnchors = new Set(evidence.anchors)
    for (const row of rows) {
      const matches = new Set<string>()
      for (const match of normalizeAnchor(row.searchText).matchAll(IDENTIFIER_PATTERN)) {
        if (requestedAnchors.has(match[0])) matches.add(match[0])
      }
      exactAnchorMatches.set(keyOf(row), matches.size)
    }
  }
  const vectorRanked = vectorRows
    .filter((row) => Number.isFinite(rowDistance(row)))
    .sort((left, right) => rowDistance(left) - rowDistance(right) || compareKeys(left, right))
  const vectorRanks = new Map<string, number>()
  vectorRanked.forEach((row, index) => {
    vectorRanks.set(keyOf(row), index)
  })

  const ftsRows = textRows.filter((row) => typeof row._score === "number")
  const lexicalRanked: Array<[string, number]> =
    ftsRows.length > 0
      ? ftsRows
          .sort(
            (left, right) => (right._score ?? 0) - (left._score ?? 0) || compareKeys(left, right),
          )
          .map((row) => [keyOf(row), row._score ?? 0])
      : [...bm25Scores(queryTokens, rows, keyOf).entries()]
          .filter(([, score]) => score > 0)
          .sort(compareScoredKeys)
  const lexicalRanks = new Map<string, number>()
  lexicalRanked.forEach(([key], index) => {
    lexicalRanks.set(key, index)
  })
  const lexicalScores = new Map(lexicalRanked)

  return rows
    .map((row) => {
      const key = keyOf(row)
      const vectorRank = vectorRanks.get(key)
      const lexicalRank = lexicalRanks.get(key)
      const vectorScore =
        vectorRank === undefined ? 0 : policy.vectorWeight / (policy.rrfK + vectorRank)
      const lexicalScore =
        lexicalRank === undefined ? 0 : policy.lexicalWeight / (policy.rrfK + lexicalRank)
      return {
        row,
        vectorScore,
        lexicalScore,
        combinedScore: vectorScore + lexicalScore,
        vectorRank: vectorRank === undefined ? null : vectorRank + 1,
        lexicalRank: lexicalRank === undefined ? null : lexicalRank + 1,
        lexicalBackendScore: lexicalScores.get(key) ?? null,
      }
    })
    .filter((ranked) => ranked.combinedScore > 0)
    .sort(
      (left, right) =>
        (exactAnchorMatches.get(keyOf(right.row)) ?? 0) -
          (exactAnchorMatches.get(keyOf(left.row)) ?? 0) ||
        right.combinedScore - left.combinedScore ||
        rowDistance(left.row) - rowDistance(right.row) ||
        compareKeys(left.row, right.row),
    )
}

export function candidatePassesAbstention(
  evidenceOrQuery: QueryEvidence | string,
  row: RankingRow,
  policy: RankingPolicy,
): boolean {
  const evidence =
    typeof evidenceOrQuery === "string" ? queryEvidence(evidenceOrQuery) : evidenceOrQuery
  return abstentionFilter(evidence, policy)(row)
}

/**
 * Compile the abstention rule once per query. Candidates are then checked lazily in ranked order,
 * so the query tokens, prefixes, and trigrams are not rebuilt for every candidate.
 */
export function abstentionFilter(
  evidence: QueryEvidence,
  policy: RankingPolicy,
): (row: RankingRow) => boolean {
  const hasLexicalEvidence = lexicalEvidenceMatcher(evidence)
  if (policy.embeddingProvider === "local-hash" || evidence.anchors.length > 0) {
    return (row) => hasLexicalEvidence(row.searchText)
  }
  const maximumVectorDistance = policy.maximumVectorDistance
  return (row) =>
    (maximumVectorDistance !== null && rowDistance(row) <= maximumVectorDistance) ||
    hasLexicalEvidence(row.searchText)
}

export function tokensAreLexicallyRelated(queryToken: string, textToken: string): boolean {
  if (queryToken === textToken) {
    return true
  }
  if (
    queryToken.length >= MIN_LEXICAL_PREFIX_LENGTH &&
    textToken.length >= MIN_LEXICAL_PREFIX_LENGTH &&
    sharedPrefixLength(queryToken, textToken) >= MIN_LEXICAL_PREFIX_LENGTH
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

function lexicalEvidenceMatcher(evidence: QueryEvidence): (text: string) => boolean {
  if (evidence.anchors.length > 0) {
    const standaloneAnchors = evidence.anchors.filter((anchor) => !/[-_./]/u.test(anchor))
    return (text) => {
      for (const match of normalizeAnchor(text).matchAll(IDENTIFIER_PATTERN)) {
        if (evidence.anchors.some((anchor) => identifiersAreRelated(anchor, match[0]))) return true
      }
      if (standaloneAnchors.length === 0) return false
      const textTokens = tokenize(text)
      return standaloneAnchors.some((anchor) => textTokens.includes(anchor))
    }
  }
  const queryTokens = new Set(evidence.tokens)
  if (queryTokens.size === 0) {
    return () => false
  }
  const prefixes = new Set(
    [...queryTokens]
      .filter((token) => token.length >= MIN_LEXICAL_PREFIX_LENGTH)
      .map((token) => token.slice(0, MIN_LEXICAL_PREFIX_LENGTH)),
  )
  const fuzzyTokens = [...queryTokens]
    .filter(isFuzzyComparable)
    .map((token) => ({ token, trigrams: tokenTrigrams(token) }))
  // Same relation as tokensAreLexicallyRelated, evaluated against precomputed query features.
  return (text) => {
    for (const textToken of tokenize(text)) {
      if (queryTokens.has(textToken)) return true
      if (
        textToken.length >= MIN_LEXICAL_PREFIX_LENGTH &&
        prefixes.has(textToken.slice(0, MIN_LEXICAL_PREFIX_LENGTH))
      ) {
        return true
      }
      if (fuzzyTokens.length === 0 || !isFuzzyComparable(textToken)) continue
      const textTrigrams = tokenTrigrams(textToken)
      for (const { token, trigrams } of fuzzyTokens) {
        if (
          Math.abs(token.length - textToken.length) <= 1 &&
          trigramSetDiceSimilarity(trigrams, textTrigrams) >= MIN_TRIGRAM_DICE_SIMILARITY
        ) {
          return true
        }
      }
    }
    return false
  }
}

function isFuzzyComparable(token: string): boolean {
  return token.length >= MIN_FUZZY_TOKEN_LENGTH && /^[a-z0-9_-]+$/u.test(token)
}

function identifiersAreRelated(queryAnchor: string, textAnchor: string): boolean {
  if (queryAnchor === textAnchor) {
    return true
  }
  const queryParts = queryAnchor.split(/[-_./]/u)
  const textParts = textAnchor.split(/[-_./]/u)
  if (queryParts.length !== textParts.length) {
    return false
  }
  return queryParts.every((queryPart, index) => {
    const textPart = textParts[index]
    if (textPart === undefined) {
      return false
    }
    if (/^\d+$/u.test(queryPart) && /^\d+$/u.test(textPart)) {
      return queryPart === textPart
    }
    return (
      queryPart === textPart ||
      (queryPart.length >= MIN_FUZZY_TOKEN_LENGTH &&
        textPart.length >= MIN_FUZZY_TOKEN_LENGTH &&
        Math.abs(queryPart.length - textPart.length) <= 1 &&
        isSingleEditApart(queryPart, textPart))
    )
  })
}

function isSingleEditApart(left: string, right: string): boolean {
  if (left.length === right.length) {
    let differences = 0
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) {
        differences += 1
      }
    }
    return differences === 1
  }
  const [shorter, longer] = left.length < right.length ? [left, right] : [right, left]
  let shorterIndex = 0
  let longerIndex = 0
  let skipped = false
  while (shorterIndex < shorter.length && longerIndex < longer.length) {
    if (shorter[shorterIndex] === longer[longerIndex]) {
      shorterIndex += 1
      longerIndex += 1
      continue
    }
    if (skipped) {
      return false
    }
    skipped = true
    longerIndex += 1
  }
  return true
}

function mergeRows<Row extends RankingRow>(
  vectorRows: Row[],
  textRows: Row[],
  keyOf: (row: Row) => string,
  compareKeys: (left: Row, right: Row) => number,
): Row[] {
  const rows = new Map<string, Row>()
  for (const row of [...textRows].sort(compareKeys)) {
    rows.set(keyOf(row), row)
  }
  for (const row of [...vectorRows].sort(compareKeys)) {
    const key = keyOf(row)
    const existing = rows.get(key)
    if (!existing) {
      rows.set(key, row)
      continue
    }
    const merged = { ...existing, ...row }
    if (existing._score !== undefined) {
      merged._score = existing._score
    }
    rows.set(key, merged)
  }
  return [...rows.values()]
}

function bm25Scores<Row extends RankingRow>(
  queryTokens: string[],
  rows: Row[],
  keyOf: (row: Row) => string,
): Map<string, number> {
  const scores = new Map<string, number>()
  if (queryTokens.length === 0 || rows.length === 0) {
    return scores
  }
  const uniqueQueryTokens = [...new Set(queryTokens)]
  const documents = rows.map((row) => ({ row, document: lexicalDocument(row.searchText) }))
  const statistics: LexicalCorpusStatistics = {
    documentCount: 0,
    totalLength: 0,
    documentFrequencies: new Map(),
  }
  for (const { document } of documents) addLexicalDocument(statistics, document, uniqueQueryTokens)
  for (const { row, document } of documents) {
    const score = lexicalDocumentScore(document, statistics, uniqueQueryTokens)
    if (score > 0) {
      scores.set(keyOf(row), score)
    }
  }
  return scores
}

function compareScoredKeys(left: [string, number], right: [string, number]): number {
  return right[1] - left[1] || left[0].localeCompare(right[0])
}

function rowDistance(row: RankingRow): number {
  return typeof row._distance === "number" && row._distance >= 0
    ? row._distance
    : Number.POSITIVE_INFINITY
}

function rowKey(row: RankingRow): string {
  return `${row.relativePath}\0${String(row.chunkIndex).padStart(12, "0")}`
}

function normalizeAnchor(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
}

function trigramDiceSimilarity(left: string, right: string): number {
  return trigramSetDiceSimilarity(tokenTrigrams(left), tokenTrigrams(right))
}

function trigramSetDiceSimilarity(left: Set<string>, right: Set<string>): number {
  let shared = 0
  for (const trigram of left) {
    if (right.has(trigram)) {
      shared += 1
    }
  }
  return (2 * shared) / (left.size + right.size)
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
