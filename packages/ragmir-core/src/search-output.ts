import type { CompactSearchResult, SearchResult } from "./types.js"

const COMPACT_SNIPPET_LENGTH = 260

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
    ...(result.evidence === undefined ? {} : { evidence: result.evidence }),
    ...(result.score === undefined ? {} : { score: result.score }),
  }))
}

function compactText(text: string, maxLength = COMPACT_SNIPPET_LENGTH): string {
  const normalized = text.replace(/\s+/gu, " ").trim()
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}
