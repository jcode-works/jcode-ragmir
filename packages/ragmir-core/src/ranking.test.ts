import { describe, expect, it } from "vitest"
import {
  absentShareOf,
  abstentionFilter,
  candidatePassesAbstention,
  effectiveVectorDistances,
  fusionCandidateDepth,
  fuzzyMatchPrefilter,
  isWeakAnswer,
  type QueryTermStatistics,
  queryEvidence,
  queryTermCoverage,
  rankHybridRows,
  rankingPolicyFor,
  tokensAreFuzzyRelated,
  tokensAreLexicallyRelated,
  weakEvidenceFilter,
} from "./ranking.js"
import { identifierParts, normalizeForMatch, tokenize } from "./text.js"

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
    expect(policy.version).toBe(9)

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

  it("should let BM25 evidence lead when the local-hash vector disagrees", () => {
    const lexicalLeader = row("lexical.md", "Refund approval owner.", { distance: 0.3, score: 9 })
    const vectorLeader = row("vector.md", "Refund approval.", { distance: 0.1, score: 8 })
    const filler = row("filler.md", "Refund.", { distance: 0.2 })
    const vectorRows = [vectorLeader, filler, lexicalLeader]
    const lexicalRows = [lexicalLeader, vectorLeader]

    const hashed = rankHybridRows(
      "refund approval owner",
      vectorRows,
      lexicalRows,
      rankingPolicyFor("local-hash", "balanced", 1),
    )
    const semantic = rankHybridRows(
      "refund approval owner",
      vectorRows,
      lexicalRows,
      rankingPolicyFor("transformers", "balanced", 1),
    )

    expect(hashed.map(({ row: value }) => value.relativePath)).toEqual([
      "lexical.md",
      "vector.md",
      "filler.md",
    ])
    expect(semantic[0]?.row.relativePath).toBe("vector.md")
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

describe("keyword evidence prefilters", () => {
  it("should give the same coverage as a full word comparison", () => {
    const evidence = queryEvidence("How are permission checks enforced for événements and ΛΟΓΟΣ?")
    const terms: QueryTermStatistics = {
      documentCount: 1_000,
      documentFrequencies: new Map([
        ["permission", 40],
        ["checks", 300],
        ["enforced", 12],
        ["evenements", 5],
        ["λογος", 2],
      ]),
    }
    const coverage = queryTermCoverage(evidence, terms)
    const texts = [
      "The weather stays mild all week.",
      "PermissionService grants access after checking roles.",
      "Les Événements sont vérifiés chaque jour.",
      "Permissions are checked and enforced for every evenement.",
      "enforcement of permissionsChecks",
      "Permis de construire",
      "ΛΟΓΟΣService λόγος",
      "",
    ]

    for (const text of texts) {
      expect(coverage(text), text).toBe(fullCoverage(evidence, terms, text))
    }
    expect(coverage(texts[0] ?? "")).toBe(0)
    expect(coverage(texts[3] ?? "")).toBeGreaterThan(0.5)
  })

  it("should never reject a text that holds a fuzzy match", () => {
    let related = 0
    for (const word of ["security", "permission", "checklist", "deployment", "workspace"]) {
      const possible = fuzzyMatchPrefilter(word)
      for (const variant of typoVariants(word)) {
        if (tokensAreFuzzyRelated(word, variant)) {
          related += 1
          expect(possible(normalizeForMatch(`Notes about ${variant} today.`)), variant).toBe(true)
        }
      }
    }
    expect(related).toBeGreaterThan(100)
    expect(fuzzyMatchPrefilter("sceurity")(normalizeForMatch("The security review"))).toBe(true)
    expect(
      fuzzyMatchPrefilter("sceurity")(normalizeForMatch("Weather forecast for tomorrow")),
    ).toBe(false)
    expect(fuzzyMatchPrefilter("événement")("evenement")).toBe(false)
  })
})

/** Coverage computed against every word of the text, without the stem-prefix shortcut. */
function fullCoverage(
  evidence: ReturnType<typeof queryEvidence>,
  terms: QueryTermStatistics,
  text: string,
): number {
  const tokens = [...new Set(evidence.tokens)]
  const weights = tokens.map((token) => {
    const frequency = terms.documentFrequencies.get(token) ?? 0
    return Math.log(1 + (terms.documentCount - frequency + 0.5) / (frequency + 0.5))
  })
  const textTokens = [...tokenize(text), ...identifierParts(text)]
  const sameStem = (query: string, word: string): boolean => {
    const shorter = query.length <= word.length ? query : word
    const longer = shorter === query ? word : query
    return (
      query === word ||
      (shorter.length >= 5 && longer.length - shorter.length <= 4 && longer.startsWith(shorter))
    )
  }
  const matched = tokens.reduce(
    (sum, token, index) =>
      textTokens.some((word) => sameStem(token, word)) ? sum + (weights[index] ?? 0) : sum,
    0,
  )
  return matched / weights.reduce((sum, weight) => sum + weight, 0)
}

/** Every single deletion, insertion, substitution, and adjacent swap of a word. */
function typoVariants(word: string): Set<string> {
  const variants = new Set<string>()
  for (let cut = 0; cut <= word.length; cut += 1) {
    const head = word.slice(0, cut)
    const tail = word.slice(cut)
    for (const letter of "aeirstxz") {
      variants.add(`${head}${letter}${tail}`)
      if (tail.length > 0) {
        variants.add(`${head}${letter}${tail.slice(1)}`)
      }
    }
    if (tail.length > 0) {
      variants.add(`${head}${tail.slice(1)}`)
    }
    if (tail.length > 1) {
      variants.add(`${head}${tail.slice(1, 2)}${tail.slice(0, 1)}${tail.slice(2)}`)
    }
  }
  variants.delete(word)
  return variants
}

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

describe("noise floor abstention", () => {
  const e5 = rankingPolicyFor("transformers", "quality", 2, "intfloat/multilingual-e5-small")
  const uncalibrated = rankingPolicyFor(
    "transformers",
    "quality",
    2,
    "intfloat/multilingual-e5-base",
  )
  const terms: QueryTermStatistics = {
    documentCount: 100,
    documentFrequencies: new Map([
      ["weather", 1],
      ["forecast", 0],
      ["tomorrow", 3],
    ]),
  }

  it("should cap strong and vocabulary-free distances with the index noise floor", () => {
    expect(effectiveVectorDistances(e5, 0.27)).toEqual({
      maximumVectorDistance: 0.4,
      strongVectorDistance: 0.27,
      vocabularyFreeDistance: 0.24,
    })
    expect(effectiveVectorDistances(uncalibrated, 0.31)).toEqual({
      maximumVectorDistance: 1.1,
      strongVectorDistance: 0.31,
      vocabularyFreeDistance: 0.31,
    })
    expect(effectiveVectorDistances(e5, null)).toMatchObject({ maximumVectorDistance: 0.4 })
    const localHash = rankingPolicyFor("local-hash", "balanced", 1)
    expect(effectiveVectorDistances(localHash, 0.2)).toMatchObject({ maximumVectorDistance: null })
  })

  it("should require a passage nearer than any off-topic question when no word is known", () => {
    const nonsense = queryEvidence("flimbo grastic wuvvle")
    const unknown: QueryTermStatistics = { documentCount: 100, documentFrequencies: new Map() }
    const near = row("near.md", "Release notes.", { distance: 0.28 })
    const noise = row("noise.md", "Release notes.", { distance: 0.6 })
    const passes = abstentionFilter(nonsense, uncalibrated, unknown, 0.31)

    expect(passes(near)).toBe(true)
    expect(passes(noise)).toBe(false)
    expect(abstentionFilter(nonsense, uncalibrated, unknown)(noise)).toBe(true)
  })

  it("should keep the policy admission distance for questions with known words", () => {
    const evidence = queryEvidence("weather forecast tomorrow")
    const semantic = row("semantic.md", "Unrelated release notes.", { distance: 0.33 })

    expect(abstentionFilter(evidence, e5, terms, 0.3)(semantic)).toBe(true)
  })

  it("should treat a passage nearer than the floor as strong evidence", () => {
    const evidence = queryEvidence("weather forecast tomorrow")
    const weak = weakEvidenceFilter(evidence, uncalibrated, terms, 0.32)

    expect(weak(row("close.md", "Daily operations.", { distance: 0.2 }))).toBe(false)
    expect(weak(row("far.md", "Daily operations.", { distance: 0.4 }))).toBe(true)
  })

  it("should need half of the question's weight for a passage that only keywords returned", () => {
    const evidence = queryEvidence("weather forecast tomorrow")
    const weak = weakEvidenceFilter(evidence, uncalibrated, terms, 0.32)
    const localHash = rankingPolicyFor("local-hash", "balanced", 1)

    expect(uncalibrated.lexicalOnlyEvidenceCoverage).toBe(0.5)
    expect(weak(row("keyword.md", "Weather station notes.", {}))).toBe(true)
    expect(weak(row("vector.md", "Weather station notes.", { distance: 0.4 }))).toBe(false)
    expect(weak(row("both.md", "Weather forecast notes.", {}))).toBe(false)
    expect(localHash.lexicalOnlyEvidenceCoverage).toBe(localHash.weakEvidenceCoverage)
    expect(
      weakEvidenceFilter(
        evidence,
        localHash,
        terms,
      )(row("keyword.md", "Weather station notes.", {})),
    ).toBe(false)
  })

  it("should credit fuzzy keyword matches and the parts of joined words", () => {
    const typo = queryEvidence("sceurity")
    const typoTerms: QueryTermStatistics = {
      documentCount: 10,
      documentFrequencies: new Map([["sceurity", 0]]),
      fuzzyMatchedTerms: new Set(["sceurity"]),
    }
    const joined = queryEvidence("compliance abstention")
    const joinedTerms: QueryTermStatistics = {
      documentCount: 10,
      documentFrequencies: new Map([
        ["compliance", 1],
        ["abstention", 1],
      ]),
    }

    expect(queryTermCoverage(typo, typoTerms)("Security controls require signed evidence.")).toBe(1)
    expect(queryTermCoverage(typo, typoTerms)("The secretary signs.")).toBe(0)
    expect(
      queryTermCoverage(joined, joinedTerms)("$.compliance.description: règles de l'abstention"),
    ).toBe(1)
  })

  it("should share one memoized coverage function per query and term statistics", () => {
    const evidence = queryEvidence("weather forecast tomorrow")
    const coverage = queryTermCoverage(evidence, terms)

    expect(queryTermCoverage(evidence, terms)).toBe(coverage)
    expect(queryTermCoverage(queryEvidence("weather forecast tomorrow"), terms)).not.toBe(coverage)
    expect(coverage("Weather forecast notes.")).toBe(coverage("Weather forecast notes."))
  })

  it("should refuse local-hash answers when the question's focus is absent from the corpus", () => {
    const evidence = queryEvidence("pinecone sync index")
    const absentFocus: QueryTermStatistics = {
      documentCount: 100,
      documentFrequencies: new Map([
        ["pinecone", 0],
        ["sync", 5],
        ["index", 40],
      ]),
    }
    const knownFocus: QueryTermStatistics = {
      ...absentFocus,
      documentFrequencies: new Map([...absentFocus.documentFrequencies, ["pinecone", 3]]),
    }
    const passage = row("notes.md", "Index sync notes.", { distance: 0.5 })
    const localHash = rankingPolicyFor("local-hash", "balanced", 1)

    expect(absentShareOf(evidence.tokens, absentFocus)).toBeGreaterThan(0.5)
    expect(abstentionFilter(evidence, localHash, absentFocus)(passage)).toBe(false)
    expect(abstentionFilter(evidence, localHash, knownFocus)(passage)).toBe(true)
    // A semantic model keeps its vector evidence unless every word of the question is absent.
    expect(abstentionFilter(evidence, uncalibrated, absentFocus, 0.31)(passage)).toBe(true)
    expect(
      absentShareOf(evidence.tokens, { ...absentFocus, fuzzyMatchedTerms: new Set(["pinecone"]) }),
    ).toBe(0)
  })

  it("should not let one unseen word outweigh the rest of a question on a small index", () => {
    const evidence = queryEvidence("What proves offline text-to-speech is required?")
    const smallIndex: QueryTermStatistics = {
      documentCount: 5,
      documentFrequencies: new Map([
        ["proves", 0],
        ["offline", 4],
        ["text", 2],
        ["speech", 2],
        ["required", 4],
      ]),
    }

    expect(absentShareOf(evidence.tokens, smallIndex)).toBeCloseTo(0.373, 3)
  })

  it("should refuse an answer only when every leading result is weak", () => {
    const flags = (values: boolean[]) => values.map((weak, index) => ({ index, weak }))
    const isWeak = (entry: { weak: boolean }) => entry.weak

    expect(isWeakAnswer(flags([true, true, true, true, true, false]), isWeak)).toBe(true)
    expect(isWeakAnswer(flags([true, false, true]), isWeak)).toBe(false)
    expect(isWeakAnswer([], isWeak)).toBe(false)
    expect(isWeakAnswer(flags([true, true]), isWeak)).toBe(true)
  })
})

function rankedKeys(rows: Array<{ row: FixtureRow }>): string[] {
  return rows.map(({ row: value }) => `${value.relativePath}\0#${value.chunkIndex}`)
}
