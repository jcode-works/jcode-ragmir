import { describe, expect, it } from "vitest"
import { summarizeChunkStats } from "./chunk-stats.js"

describe("summarizeChunkStats", () => {
  it("should return zeroed metadata when no chunks exist", () => {
    expect(summarizeChunkStats([])).toEqual({
      count: 0,
      minChars: 0,
      averageChars: 0,
      p50Chars: 0,
      p95Chars: 0,
      maxChars: 0,
      contextualChunks: 0,
      contextualRatio: 0,
    })
  })

  it("should summarize chunk lengths and structural-context coverage", () => {
    const result = summarizeChunkStats([
      { text: "a".repeat(10), contextPath: "" },
      { text: "b".repeat(20), contextPath: "Guide" },
      { text: "c".repeat(40), contextPath: "Guide > MCP" },
    ])

    expect(result).toEqual({
      count: 3,
      minChars: 10,
      averageChars: 70 / 3,
      p50Chars: 20,
      p95Chars: 40,
      maxChars: 40,
      contextualChunks: 2,
      contextualRatio: 2 / 3,
    })
  })
})
