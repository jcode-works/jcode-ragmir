import type { ChunkStats } from "./types.js"

interface ChunkShape {
  contextPath: string
  text: string
}

export function summarizeChunkStats(chunks: readonly ChunkShape[]): ChunkStats {
  if (chunks.length === 0) {
    return {
      count: 0,
      minChars: 0,
      averageChars: 0,
      p50Chars: 0,
      p95Chars: 0,
      maxChars: 0,
      contextualChunks: 0,
      contextualRatio: 0,
    }
  }

  const lengths = chunks.map((chunk) => chunk.text.length).sort((left, right) => left - right)
  const contextualChunks = chunks.filter((chunk) => chunk.contextPath.trim().length > 0).length

  return {
    count: chunks.length,
    minChars: lengths[0] ?? 0,
    averageChars: lengths.reduce((sum, length) => sum + length, 0) / lengths.length,
    p50Chars: percentile(lengths, 0.5),
    p95Chars: percentile(lengths, 0.95),
    maxChars: lengths.at(-1) ?? 0,
    contextualChunks,
    contextualRatio: contextualChunks / chunks.length,
  }
}

function percentile(sortedValues: number[], quantile: number): number {
  const index = Math.ceil(quantile * sortedValues.length) - 1
  return sortedValues[Math.max(0, index)] ?? 0
}
