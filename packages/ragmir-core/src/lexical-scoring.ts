import { tokenize } from "./text.js"

const BM25_K1 = 1.2
const BM25_B = 0.75

export interface LexicalDocument {
  length: number
  frequencies: Map<string, number>
}

export interface LexicalCorpusStatistics {
  documentCount: number
  totalLength: number
  documentFrequencies: Map<string, number>
}

export function lexicalDocument(text: string): LexicalDocument {
  const tokens = tokenize(text)
  const frequencies = new Map<string, number>()
  for (const token of tokens) {
    frequencies.set(token, (frequencies.get(token) ?? 0) + 1)
  }
  return { length: tokens.length, frequencies }
}

export function addLexicalDocument(
  statistics: LexicalCorpusStatistics,
  document: LexicalDocument,
  queryTokens: readonly string[],
): void {
  statistics.documentCount += 1
  statistics.totalLength += document.length
  for (const token of queryTokens) {
    if (document.frequencies.has(token)) {
      statistics.documentFrequencies.set(
        token,
        (statistics.documentFrequencies.get(token) ?? 0) + 1,
      )
    }
  }
}

export function lexicalDocumentScore(
  document: LexicalDocument,
  statistics: LexicalCorpusStatistics,
  queryTokens: readonly string[],
): number {
  const averageLength = statistics.totalLength / statistics.documentCount || 1
  let score = 0
  for (const token of queryTokens) {
    const frequency = document.frequencies.get(token) ?? 0
    if (frequency === 0) continue
    const documentFrequency = statistics.documentFrequencies.get(token) ?? 0
    const inverseDocumentFrequency = Math.log(
      1 + (statistics.documentCount - documentFrequency + 0.5) / (documentFrequency + 0.5),
    )
    const denominator =
      frequency + BM25_K1 * (1 - BM25_B + BM25_B * (document.length / averageLength))
    score += inverseDocumentFrequency * ((frequency * (BM25_K1 + 1)) / denominator)
  }
  return score
}
