import { describe, expect, it } from "vitest"
import { compactSearchResults } from "./search-output.js"
import type { SearchResult } from "./types.js"

function result(text: string, overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    source: "docs/guide.md",
    relativePath: "docs/guide.md",
    chunkIndex: 0,
    contextPath: "Guide",
    citation: "docs/guide.md:L10-L20#0",
    text,
    distance: null,
    charStart: 0,
    charEnd: text.length,
    lineStart: 10,
    lineEnd: 20,
    pageStart: null,
    pageEnd: null,
    context: [],
    ...overrides,
  }
}

const passage = [
  "# Deployment guide",
  "This guide walks through every environment the team maintains.",
  "Staging mirrors production with smaller machines.",
  "Rollbacks restore the previous release within five minutes.",
  "Contact the platform team for access.",
].join("\n")

describe("compactSearchResults", () => {
  it("starts the excerpt at the line holding the question's words, with its source line", () => {
    const [compact] = compactSearchResults([result(passage)], 260, {
      query: "How long does a rollback take?",
    })

    expect(compact?.snippet).toBe(
      "...Rollbacks restore the previous release within five minutes. Contact the platform team for access.",
    )
    expect(compact?.excerptLine).toBe(13)
  })

  it("keeps the opening when no line holds a question word, as with a semantic match", () => {
    const [compact] = compactSearchResults([result(passage)], 60, {
      query: "What protects users when a launch fails?",
    })

    expect(compact?.snippet).toBe("# Deployment guide This guide walks through every environ...")
    expect(compact?.excerptLine).toBeUndefined()
  })

  it("lets background words break a tie between lines that match the question equally", () => {
    const text = [
      "Release staging checks run nightly.",
      "Release production checks run hourly.",
    ].join("\n")
    const [plain] = compactSearchResults([result(text)], 260, { query: "release checks" })
    const [focused] = compactSearchResults([result(text)], 260, {
      query: "release checks",
      intent: "production monitoring",
    })

    expect(plain?.excerptLine).toBe(10)
    expect(focused?.excerptLine).toBe(11)
  })

  it("centers a long line on its first question word", () => {
    const longLine = `${"Background detail. ".repeat(30)}The quota resets every Monday at midnight UTC.`
    const [compact] = compactSearchResults([result(`Intro line\n${longLine}`)], 120, {
      query: "When does the quota reset?",
    })

    expect(compact?.snippet.startsWith("...")).toBe(true)
    expect(compact?.snippet).toContain("quota resets every Monday")
    expect(compact?.snippet.length).toBeLessThanOrEqual(120)
  })

  it("matches camelCase identifier parts and carries the path context", () => {
    const text = "Overview of the module.\nconst retryBudget = loadRetryBudget(config)"
    const [compact] = compactSearchResults(
      [result(text, { lineStart: null, pathContext: "Service code" })],
      260,
      { query: "retry budget" },
    )

    expect(compact?.snippet).toBe("...const retryBudget = loadRetryBudget(config)")
    expect(compact?.excerptLine).toBeUndefined()
    expect(compact?.pathContext).toBe("Service code")
  })
})
