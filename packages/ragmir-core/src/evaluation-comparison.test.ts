import { describe, expect, it } from "vitest"
import { answerRatesAt } from "./evaluation-comparison.js"

describe("answerRatesAt", () => {
  it("counts answerable cases whose first relevant passage ranks within each depth", () => {
    const rates = answerRatesAt([
      { answerable: true, bestRank: 1 },
      { answerable: true, bestRank: 3 },
      { answerable: true, bestRank: 7 },
      { answerable: true, bestRank: null },
    ])

    expect(rates).toEqual({ 1: 0.25, 3: 0.5, 5: 0.5, 10: 0.75 })
  })

  it("ignores unanswerable cases, whose correct result is no passage", () => {
    const rates = answerRatesAt([
      { answerable: true, bestRank: 2 },
      { answerable: false, bestRank: null },
      { answerable: false, bestRank: null },
    ])

    expect(rates).toEqual({ 1: 0, 3: 1, 5: 1, 10: 1 })
  })

  it("reports zero rates without answerable cases", () => {
    expect(answerRatesAt([{ answerable: false, bestRank: null }])).toEqual({
      1: 0,
      3: 0,
      5: 0,
      10: 0,
    })
  })
})
