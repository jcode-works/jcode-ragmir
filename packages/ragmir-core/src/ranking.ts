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
  version: 5
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
const RRF_VECTOR_WEIGHT = 1
const RRF_LEXICAL_WEIGHT = 1
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
    version: 5,
    embeddingProvider,
    retrievalProfile,
    maxChunksPerDocument,
    rrfK: RRF_K,
    vectorWeight: RRF_VECTOR_WEIGHT,
    lexicalWeight: RRF_LEXICAL_WEIGHT,
    maximumVectorDistance:
      embeddingProvider === "transformers" ? TRANSFORMERS_MAXIMUM_VECTOR_DISTANCE : null,
  }
}

export function rankingPolicyFingerprint(policy: RankingPolicy): string {
  return createHash("sha256").update(JSON.stringify(policy)).digest("hex")
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
  const rows = mergeRows(vectorRows, textRows)
  const exactAnchorMatches = new Map<string, number>()
  if (evidence.anchors.length > 0) {
    const requestedAnchors = new Set(evidence.anchors)
    for (const row of rows) {
      const matches = new Set<string>()
      for (const match of normalizeAnchor(row.searchText).matchAll(IDENTIFIER_PATTERN)) {
        if (requestedAnchors.has(match[0])) matches.add(match[0])
      }
      exactAnchorMatches.set(rowKey(row), matches.size)
    }
  }
  const vectorRanked = [...vectorRows]
    .filter((row) => Number.isFinite(rowDistance(row)))
    .sort(compareVectorRows)
  const vectorRanks = new Map<string, number>()
  vectorRanked.forEach((row, index) => {
    vectorRanks.set(rowKey(row), index)
  })

  const ftsRows = textRows.filter((row) => typeof row._score === "number")
  const lexicalRanked: Array<[string, number]> =
    ftsRows.length > 0
      ? [...ftsRows].sort(compareLexicalRows).map((row) => [rowKey(row), row._score ?? 0])
      : [...bm25Scores(queryTokens, rows).entries()]
          .filter(([, score]) => score > 0)
          .sort(compareScoredKeys)
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
        (exactAnchorMatches.get(rowKey(right.row)) ?? 0) -
          (exactAnchorMatches.get(rowKey(left.row)) ?? 0) || compareRankedRows(left, right),
    )
}

export function candidatePassesAbstention(
  evidenceOrQuery: QueryEvidence | string,
  row: RankingRow,
  policy: RankingPolicy,
): boolean {
  const evidence =
    typeof evidenceOrQuery === "string" ? queryEvidence(evidenceOrQuery) : evidenceOrQuery
  const lexicalSupport = hasLexicalEvidence(evidence, row.searchText)
  if (policy.embeddingProvider === "local-hash" || evidence.anchors.length > 0) {
    return lexicalSupport
  }
  return (
    lexicalSupport ||
    (policy.maximumVectorDistance !== null && rowDistance(row) <= policy.maximumVectorDistance)
  )
}

export function tokensAreLexicallyRelated(queryToken: string, textToken: string): boolean {
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

function hasLexicalEvidence(evidence: QueryEvidence, text: string): boolean {
  if (evidence.anchors.length > 0) {
    for (const match of normalizeAnchor(text).matchAll(IDENTIFIER_PATTERN)) {
      if (evidence.anchors.some((anchor) => identifiersAreRelated(anchor, match[0]))) return true
    }
    const standaloneAnchors = evidence.anchors.filter((anchor) => !/[-_./]/u.test(anchor))
    const textTokens = standaloneAnchors.length > 0 ? tokenize(text) : []
    return standaloneAnchors.some((anchor) => textTokens.includes(anchor))
  }
  const textTokens = tokenize(text)
  return evidence.tokens.some((queryToken) =>
    textTokens.some((textToken) => tokensAreLexicallyRelated(queryToken, textToken)),
  )
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

function mergeRows<Row extends RankingRow>(vectorRows: Row[], textRows: Row[]): Row[] {
  const rows = new Map<string, Row>()
  for (const row of [...textRows].sort(compareRowKeys)) {
    rows.set(rowKey(row), row)
  }
  for (const row of [...vectorRows].sort(compareRowKeys)) {
    const existing = rows.get(rowKey(row))
    if (!existing) {
      rows.set(rowKey(row), row)
      continue
    }
    const merged = { ...existing, ...row }
    if (existing._score !== undefined) {
      merged._score = existing._score
    }
    rows.set(rowKey(row), merged)
  }
  return [...rows.values()]
}

function bm25Scores<Row extends RankingRow>(
  queryTokens: string[],
  rows: Row[],
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
      scores.set(rowKey(row), score)
    }
  }
  return scores
}

function compareVectorRows(left: RankingRow, right: RankingRow): number {
  return rowDistance(left) - rowDistance(right) || compareRowKeys(left, right)
}

function compareLexicalRows(left: RankingRow, right: RankingRow): number {
  return (right._score ?? 0) - (left._score ?? 0) || compareRowKeys(left, right)
}

function compareScoredKeys(left: [string, number], right: [string, number]): number {
  return right[1] - left[1] || left[0].localeCompare(right[0])
}

function compareRankedRows<Row extends RankingRow>(
  left: RankedRow<Row>,
  right: RankedRow<Row>,
): number {
  return (
    right.combinedScore - left.combinedScore ||
    rowDistance(left.row) - rowDistance(right.row) ||
    compareRowKeys(left.row, right.row)
  )
}

function compareRowKeys(left: RankingRow, right: RankingRow): number {
  return rowKey(left).localeCompare(rowKey(right))
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
