import { recordAccess } from "./access-log.js"
import { loadConfig } from "./config.js"
import { embedText } from "./embeddings.js"
import { getIndexFreshnessWarning } from "./index-diagnostics.js"
import { openRowsTable } from "./store.js"
import { tokenize } from "./text.js"
import type { AskResult, SearchOptions, SearchResult } from "./types.js"

interface SearchRow {
  source: string
  relativePath: string
  chunkIndex: number
  text: string
  _distance?: number
}

interface RankedRow {
  row: SearchRow
  vectorScore: number
  lexicalScore: number
  combinedScore: number
}

const MIN_VECTOR_CANDIDATES = 80
const VECTOR_CANDIDATE_MULTIPLIER = 4
/**
 * Reciprocal Rank Fusion (Cormack et al. 2009). Each candidate scores
 * `weight / (RRF_K + rank)` per retriever it appears in, summed across
 * retrievers. Rank-only fusion removes the score-calibration problem of
 * weighted-sum fusion: the BM25 and vector score distributions never need to
 * be normalized against each other.
 *
 * The retriever weights follow the weighted-RRF variant (as in Azure AI
 * Search). The vector retriever is weighted higher because, with the default
 * `local-hash` embeddings, vector proximity is the more discriminant signal
 * on small corpora; the lexical weight still lets exact-keyword evidence pull
 * in candidates the vector retriever missed.
 */
const RRF_K = 60
const RRF_VECTOR_WEIGHT = 0.7
const RRF_LEXICAL_WEIGHT = 0.3
const BM25_K1 = 1.2
const BM25_B = 0.75

export async function search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
  const config = await loadConfig(String(options.cwd ?? process.cwd()))
  const table = await openRowsTable(config)
  if (!table) {
    return []
  }

  const topK = options.topK ?? config.topK
  const vector = await embedText(query, config)
  const vectorRows = (await table
    .vectorSearch(vector)
    .limit(vectorCandidateLimit(topK))
    .toArray()) as SearchRow[]
  const textRows = (await table.query().limit(config.hybridTextScanLimit).toArray()) as SearchRow[]
  const rows = rankHybridRows(query, vectorRows, textRows).slice(0, topK)

  const results = rows.map((row) => ({
    source: row.row.source,
    relativePath: row.row.relativePath,
    chunkIndex: row.row.chunkIndex,
    text: row.row.text,
    distance: typeof row.row._distance === "number" ? row.row._distance : null,
  }))
  await recordAccess(config, {
    action: "search",
    query,
    topK,
    resultCount: results.length,
  })
  return results
}

export function vectorCandidateLimit(topK: number): number {
  return Math.max(MIN_VECTOR_CANDIDATES, topK * VECTOR_CANDIDATE_MULTIPLIER)
}

export async function ask(query: string, options: SearchOptions = {}): Promise<AskResult> {
  const config = await loadConfig(String(options.cwd ?? process.cwd()))
  const sources = await search(query, options)
  const staleWarning = await getIndexFreshnessWarning(config)

  if (sources.length === 0) {
    return {
      answer: "No relevant passages were found. Add documents and run `rgr doctor --fix` first.",
      sources,
      staleWarning,
    }
  }

  await recordAccess(config, {
    action: "ask",
    query,
    topK: options.topK ?? config.topK,
    resultCount: sources.length,
  })

  return {
    answer: retrievalOnlyAnswer(sources),
    sources,
    staleWarning,
  }
}

function retrievalOnlyAnswer(sources: SearchResult[]): string {
  const snippets = sources
    .map((source, index) => {
      const text = source.text.replace(/\s+/gu, " ").trim()
      return `[${index + 1}] ${source.relativePath}#${source.chunkIndex}: ${text}`
    })
    .join("\n\n")

  return [
    "Ragmir returns retrieval context only. Use these passages as grounded context for your agent or LLM:",
    "",
    snippets,
  ].join("\n")
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

  // Lexical ranks: higher BM25 score is better, so sort descending.
  const lexicalScores = bm25Scores(queryTokens, rows)
  const lexicalRanked = [...lexicalScores.entries()]
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1])
  const lexicalRanks = new Map<string, number>()
  lexicalRanked.forEach(([key, index]) => {
    lexicalRanks.set(key, index)
  })

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
      return { row, vectorScore, lexicalScore, combinedScore }
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

function mergeRows(vectorRows: SearchRow[], textRows: SearchRow[]): SearchRow[] {
  const rows = new Map<string, SearchRow>()
  for (const row of textRows) {
    rows.set(rowKey(row), row)
  }
  for (const row of vectorRows) {
    rows.set(rowKey(row), row)
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
    const tokens = tokenize(row.text)
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

function rowKey(row: SearchRow): string {
  return `${row.relativePath}\0${row.chunkIndex}`
}
