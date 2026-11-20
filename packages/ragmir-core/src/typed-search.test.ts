import { describe, expect, it } from "vitest"
import {
  exclusionMatcher,
  formulationKeywords,
  holdsRequiredPhrases,
  parseLexFormulation,
  prepareFormulations,
} from "./typed-search.js"

describe("parseLexFormulation", () => {
  it("splits ranking words, required phrases, and exclusions", () => {
    expect(parseLexFormulation('"rate limit" Throttling -deprecated -"old api"')).toEqual({
      type: "lex",
      text: '"rate limit" Throttling -deprecated -"old api"',
      words: ["throttling"],
      phrases: ["rate limit"],
      excludedWords: ["deprecated"],
      excludedPhrases: ["old api"],
    })
  })

  it("keeps a hyphen inside a word, and excludes a word of several parts as a phrase", () => {
    const lex = parseLexFormulation("real-time DEC-0054 -dead-letter")
    expect(lex.words).toEqual(["real", "time", "dec", "0054"])
    expect(lex.excludedWords).toEqual([])
    expect(lex.excludedPhrases).toEqual(["dead-letter"])
  })

  it("drops phrases without a word", () => {
    expect(parseLexFormulation('"" "  " cache').phrases).toEqual([])
  })
})

describe("prepareFormulations", () => {
  it("returns nothing without formulations and trims each one", () => {
    expect(prepareFormulations(undefined)).toEqual([])
    expect(prepareFormulations([{ type: "vec", query: "  how requests are throttled  " }])).toEqual(
      [{ type: "vec", text: "how requests are throttled" }],
    )
  })

  it("rejects malformed formulations with a message naming the field", () => {
    const invalid: Array<[unknown, string]> = [
      [
        Array.from({ length: 6 }, () => ({ type: "vec", query: "q" })),
        "searches must hold at most 5 formulations.",
      ],
      [[{ type: "sql", query: "q" }], "searches[0].type must be lex, vec, or hyde."],
      [[{ type: "vec", query: "   " }], "searches[0].query must not be empty."],
      [
        [{ type: "hyde", query: "x".repeat(2_001) }],
        "searches[0].query must contain at most 2000 characters.",
      ],
      [
        [{ type: "lex", query: "rate\nlimit" }],
        "searches[0].query must be one line: send one lex search per line.",
      ],
      [
        [
          { type: "vec", query: "q" },
          { type: "lex", query: '"rate limit' },
        ],
        'searches[1].query leaves a quote open: close every "phrase".',
      ],
      [
        [{ type: "lex", query: "-deprecated" }],
        "searches[0].query only excludes: add a word or a quoted phrase to find.",
      ],
      [
        [{ type: "vec", query: "q", extra: true }],
        "searches[0] must be an object with only type and query.",
      ],
    ]
    for (const [searches, message] of invalid) {
      expect(() =>
        prepareFormulations(searches as Parameters<typeof prepareFormulations>[0]),
      ).toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT", message }))
    }
  })
})

describe("formulationKeywords", () => {
  it("keeps the words and phrases of a lex search and the text of the others", () => {
    const [lex, hyde] = prepareFormulations([
      { type: "lex", query: '"rate limit" quota -deprecated' },
      { type: "hyde", query: "Requests above the quota receive HTTP 429." },
    ])
    expect(lex && formulationKeywords(lex)).toBe("quota rate limit")
    expect(hyde && formulationKeywords(hyde)).toBe("Requests above the quota receive HTTP 429.")
  })
})

describe("holdsRequiredPhrases", () => {
  it("matches whole folded words in order", () => {
    const lex = parseLexFormulation('"rate limit"')
    expect(holdsRequiredPhrases(lex, "The Rate-Limit applies per key.")).toBe(true)
    expect(holdsRequiredPhrases(lex, "We generate limit reports.")).toBe(false)
    expect(holdsRequiredPhrases(lex, "A limit on the rate.")).toBe(false)
  })
})

describe("exclusionMatcher", () => {
  it("returns null when no lex search excludes anything", () => {
    expect(exclusionMatcher(prepareFormulations([{ type: "lex", query: "cache" }]))).toBeNull()
  })

  it("excludes a word with its stem variants, identifier parts, and excluded phrases", () => {
    const excluded = exclusionMatcher(
      prepareFormulations([
        { type: "lex", query: "cache -permission" },
        { type: "lex", query: 'eviction -"legacy mode"' },
      ]),
    )
    expect(excluded?.("Grant the permissions first.")).toBe(true)
    expect(excluded?.("Call checkPermission before writing.")).toBe(true)
    expect(excluded?.("Disable Legacy Mode in production.")).toBe(true)
    expect(excluded?.("The cache keeps legacy entries in a separate mode.")).toBe(false)
  })
})
