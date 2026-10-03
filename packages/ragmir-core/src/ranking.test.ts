import { describe, expect, it } from "vitest"
import {
  abstentionFilter,
  candidatePassesAbstention,
  fusionCandidateDepth,
  queryEvidence,
  rankHybridRows,
  rankingPolicyFor,
  tokensAreLexicallyRelated,
} from "./ranking.js"
import { tokenize } from "./text.js"

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
    const policy = rankingPolicyFor("local-hash", "balanced", 1)
    expect(policy.version).toBe(5)

    const forward = rankHybridRows("policy evidence", [beta, alpha], [alpha, beta], policy)
    const reversed = rankHybridRows("policy evidence", [alpha, beta], [beta, alpha], policy)

    expect(rankedKeys(forward)).toEqual(["alpha.md\0#0", "beta.md\0#0"])
    expect(rankedKeys(reversed)).toEqual(rankedKeys(forward))
    expect(forward.map(({ vectorRank, lexicalRank }) => ({ vectorRank, lexicalRank }))).toEqual(
      reversed.map(({ vectorRank, lexicalRank }) => ({ vectorRank, lexicalRank })),
    )
  })

  it("should require the strongest local-hash identifier evidence", () => {
    const policy = rankingPolicyFor("local-hash", "balanced", 1)
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
    const policy = rankingPolicyFor("transformers", "balanced", 1)
    const semantic = row("semantic.md", "Unrelated surface form.", { distance: 1.09 })
    const negative = row("negative.md", "Unrelated surface form.", { distance: 1.16 })
    const lexical = row("lexical.md", "The quantum-banana control is documented.", {
      distance: 1.4,
    })

    expect(candidatePassesAbstention("archive duration", semantic, policy)).toBe(true)
    expect(candidatePassesAbstention("archive duration", negative, policy)).toBe(false)
    expect(candidatePassesAbstention("quantum-banana", lexical, policy)).toBe(true)
  })

  it("should require identifier evidence even when a semantic candidate is close", () => {
    const policy = rankingPolicyFor("transformers", "balanced", 2)
    const nearby = row("old.md", "AUTH_REDIRECT_ORIGIN_X16 requires approval.", {
      distance: 0.1,
    })
    const exact = row("current.md", "AUTH_REDIRECT_ORIGIN_X17 requires the tenant owner.", {
      distance: 1.4,
    })
    expect(candidatePassesAbstention("AUTH_REDIRECT_ORIGIN_X17", nearby, policy)).toBe(false)
    expect(candidatePassesAbstention("AUTH_REDIRECT_ORIGIN_X17", exact, policy)).toBe(true)
  })

  it("should rank a dotted API identifier before a general semantic match", () => {
    const policy = rankingPolicyFor("transformers", "balanced", 2)
    const exact = row("api.md", "payments.capture.status is a terminal state.", { score: 5 })
    const other = row("overview.md", "Payment processing state machine.", {
      distance: 0.1,
      score: 10,
    })
    const ranked = rankHybridRows("payments.capture.status", [other], [other, exact], policy)
    expect(ranked[0]?.row.relativePath).toBe("api.md")
    expect(candidatePassesAbstention("payments.capture.status", other, policy)).toBe(false)
  })

  it("should reject common words as the only lexical evidence in English and French", () => {
    const policy = rankingPolicyFor("local-hash", "balanced", 1)
    const document = row(
      "permissions.md",
      "The owner can approve a refund. Le responsable valide.",
      {
        distance: 0.1,
      },
    )
    expect(candidatePassesAbstention("What is the color of penguins?", document, policy)).toBe(
      false,
    )
    expect(
      candidatePassesAbstention("Quelle est la couleur des manchots ?", document, policy),
    ).toBe(false)
    expect(candidatePassesAbstention("Who can approve a refund?", document, policy)).toBe(true)
  })

  it("should compile the same abstention decision as the per-token relation", () => {
    const policy = rankingPolicyFor("local-hash", "balanced", 1)
    const queries = [
      "approval workflow",
      "Quelle règle de remboursement ?",
      "configuration loader",
      "authentication",
      "who can approve a refund",
    ]
    const texts = [
      "The approver signs every refund.",
      "Configuring loaders requires a manifest.",
      "authentification des utilisateurs",
      "remboursements validés par le responsable",
      "Unrelated penguin colors.",
      "authentications are logged",
    ]
    for (const query of queries) {
      const evidence = queryEvidence(query)
      const compiled = abstentionFilter(evidence, policy)
      for (const text of texts) {
        const expected = evidence.tokens.some((queryToken) =>
          tokenize(text).some((textToken) => tokensAreLexicallyRelated(queryToken, textToken)),
        )
        expect(compiled({ relativePath: "a.md", chunkIndex: 0, searchText: text })).toBe(expected)
      }
    }
  })

  it("should size fusion candidates so an unseen row cannot outrank the demanded rows", () => {
    for (const demand of [1, 4, 40, 400]) {
      const depth = fusionCandidateDepth(demand)
      const unseenBest = 2 / (60 + depth + 1)
      const demandedWorst = 1 / (60 + demand)
      expect(unseenBest).toBeLessThan(demandedWorst)
    }
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
