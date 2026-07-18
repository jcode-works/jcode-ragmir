import { describe, expect, it } from "vitest"
import { candidatePassesAbstention, rankHybridRows, rankingPolicyFor } from "./ranking.js"

interface FixtureRow {
  relativePath: string
  chunkIndex: number
  searchText: string
  _distance?: number
  _score?: number
}

describe("hybrid ranking", () => {
  it("should keep ranks invariant when tied candidates arrive in a different order", () => {
    const alpha = row("alpha.md", "Shared policy evidence.", { distance: 0.5, score: 3 })
    const beta = row("beta.md", "Shared policy evidence.", { distance: 0.5, score: 3 })
    const policy = rankingPolicyFor("local-hash", "balanced")

    const forward = rankHybridRows("policy evidence", [beta, alpha], [alpha, beta], policy)
    const reversed = rankHybridRows("policy evidence", [alpha, beta], [beta, alpha], policy)

    expect(rankedKeys(forward)).toEqual(["alpha.md\0#0", "beta.md\0#0"])
    expect(rankedKeys(reversed)).toEqual(rankedKeys(forward))
    expect(forward.map(({ vectorRank, lexicalRank }) => ({ vectorRank, lexicalRank }))).toEqual(
      reversed.map(({ vectorRank, lexicalRank }) => ({ vectorRank, lexicalRank })),
    )
  })

  it("should require the strongest local-hash identifier evidence", () => {
    const policy = rankingPolicyFor("local-hash", "balanced")
    const exact = row("exact.md", "Group identifier BENCH-GROUP-04.", { distance: 1.2 })
    const section = row("section.md", "BENCH-GROUP-09 section 04 evidence.", { distance: 0.2 })
    const typo = row("typo.md", "Evidence identifier BENCH-DOC-0000053-ahajfbuv.", {
      distance: 1.2,
    })

    expect(candidatePassesAbstention("Find evidence for BENCH-GROUP-04", exact, policy)).toBe(true)
    expect(candidatePassesAbstention("Find evidence for BENCH-GROUP-04", section, policy)).toBe(
      false,
    )
    expect(
      candidatePassesAbstention("Find evidence BENCH-DOC-000x053-ahajfbuv", typo, policy),
    ).toBe(true)
  })

  it("should calibrate Transformers abstention from lexical support and normalized distance", () => {
    const policy = rankingPolicyFor("transformers", "balanced")
    const semantic = row("semantic.md", "Unrelated surface form.", { distance: 1.09 })
    const negative = row("negative.md", "Unrelated surface form.", { distance: 1.16 })
    const lexical = row("lexical.md", "The quantum-banana control is documented.", {
      distance: 1.4,
    })

    expect(candidatePassesAbstention("archive duration", semantic, policy)).toBe(true)
    expect(candidatePassesAbstention("archive duration", negative, policy)).toBe(false)
    expect(candidatePassesAbstention("quantum-banana", lexical, policy)).toBe(true)
  })
})

function row(
  relativePath: string,
  searchText: string,
  scores: { distance?: number; score?: number },
): FixtureRow {
  return {
    relativePath,
    chunkIndex: 0,
    searchText,
    ...(scores.distance === undefined ? {} : { _distance: scores.distance }),
    ...(scores.score === undefined ? {} : { _score: scores.score }),
  }
}

function rankedKeys(rows: Array<{ row: FixtureRow }>): string[] {
  return rows.map(({ row: value }) => `${value.relativePath}\0#${value.chunkIndex}`)
}
