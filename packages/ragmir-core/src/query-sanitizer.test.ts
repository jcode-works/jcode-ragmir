import { describe, expect, it } from "vitest"
import { sanitizeRetrievalQuery } from "./query-sanitizer.js"

describe("sanitizeRetrievalQuery", () => {
  it("should preserve concise retrieval queries", () => {
    const result = sanitizeRetrievalQuery("token rotation policy")

    expect(result.query).toBe("token rotation policy")
    expect(result.changed).toBe(false)
    expect(result.method).toBe("passthrough")
  })

  it("should preserve constraints before the final question in a long request", () => {
    const prompt = [
      "AUTH_REDIRECT_ORIGIN_X17 applies to src/auth/redirect.ts in version 2.3.1.",
      "The administrator may register an origin, but only the tenant owner can approve it. ".repeat(
        4,
      ),
      "Quelle règle dois-je appliquer ?",
    ].join("\n")

    const result = sanitizeRetrievalQuery(prompt)

    expect(result.query).toBe(prompt.replaceAll("\n", " ").replace(/\s+/gu, " "))
    expect(result.changed).toBe(true)
    expect(result.method).toBe("normalized")
  })

  it("should preserve earlier requirements when the request contains a query label", () => {
    const prompt = `${"Require signed release evidence. ".repeat(20)}\nquery: approval checksums`

    const result = sanitizeRetrievalQuery(prompt)

    expect(result.query).toContain("Require signed release evidence.")
    expect(result.query).toContain("query: approval checksums")
  })

  it("should preserve constraints at both ends of a request at the size limit", () => {
    const prompt = `START_RULE ${"x".repeat(19_980)} END_RULE`

    expect(sanitizeRetrievalQuery(prompt)).toMatchObject({
      query: prompt,
      method: "passthrough",
      changed: false,
    })
  })

  it("should reject oversized requests instead of silently dropping constraints", () => {
    expect(() => sanitizeRetrievalQuery("x".repeat(20_001))).toThrow(
      "Split the request into focused searches.",
    )
  })

  it("should remove lone surrogates and compact Unicode whitespace", () => {
    expect(sanitizeRetrievalQuery("  politique\ud800\n\tde confidentialité  ")).toMatchObject({
      query: "politique de confidentialité",
      method: "normalized",
      changed: true,
    })
  })
})
