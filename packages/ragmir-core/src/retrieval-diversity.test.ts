import { describe, expect, it } from "vitest"
import type { RankedRow } from "./ranking.js"
import { selectDiverseRows } from "./retrieval-diversity.js"

interface FixtureRow {
  relativePath: string
  chunkIndex: number
  searchText: string
  text: string
  charStart: number
  charEnd: number
}

function rankedRow(relativePath: string, chunkIndex: number, score: number): RankedRow<FixtureRow> {
  return {
    row: {
      relativePath,
      chunkIndex,
      searchText: `${relativePath} evidence ${chunkIndex}`,
      text: `${relativePath} evidence ${chunkIndex}`,
      charStart: chunkIndex * 100,
      charEnd: chunkIndex * 100 + 80,
    },
    vectorScore: score,
    lexicalScore: 0,
    combinedScore: score,
    vectorRank: chunkIndex + 1,
    lexicalRank: null,
    lexicalBackendScore: null,
  }
}

describe("selectDiverseRows", () => {
  it("should promote lower-ranked documents when one document owns the best chunks", () => {
    const rows = [
      rankedRow("a.md", 0, 1),
      rankedRow("a.md", 1, 0.9),
      rankedRow("a.md", 2, 0.8),
      rankedRow("a.md", 3, 0.7),
      rankedRow("b.md", 0, 0.6),
      rankedRow("c.md", 0, 0.5),
      rankedRow("d.md", 0, 0.4),
    ]

    const result = selectDiverseRows(rows, { topK: 4, maxChunksPerDocument: 1 })

    expect(result.rows.map(({ row }) => row.relativePath)).toEqual(["a.md", "b.md", "c.md", "d.md"])
    expect(result.backfillActivated).toBe(false)
  })

  it("should honor a configurable document cap without reordering first occurrences", () => {
    const rows = [
      rankedRow("a.md", 0, 1),
      rankedRow("a.md", 1, 0.9),
      rankedRow("a.md", 2, 0.8),
      rankedRow("b.md", 0, 0.7),
      rankedRow("c.md", 0, 0.6),
    ]

    const result = selectDiverseRows(rows, { topK: 4, maxChunksPerDocument: 2 })

    expect(result.rows.map(({ row }) => `${row.relativePath}#${row.chunkIndex}`)).toEqual([
      "a.md#0",
      "a.md#1",
      "b.md#0",
      "c.md#0",
    ])
    expect(result.backfillActivated).toBe(false)
  })

  it("should backfill ranked chunks when the corpus cannot satisfy the document cap", () => {
    const rows = Array.from({ length: 5 }, (_value, index) =>
      rankedRow("only.md", index, 1 - index / 10),
    )

    const result = selectDiverseRows(rows, { topK: 4, maxChunksPerDocument: 1 })

    expect(result.rows.map(({ row }) => row.chunkIndex)).toEqual([0, 1, 2, 3])
    expect(result.backfillActivated).toBe(true)
  })
})
