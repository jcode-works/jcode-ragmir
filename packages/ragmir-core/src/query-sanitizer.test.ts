import { describe, expect, it } from "vitest"
import { sanitizeRetrievalQuery } from "./query-sanitizer.js"

describe("sanitizeRetrievalQuery", () => {
  it("passes through concise retrieval queries", () => {
    const result = sanitizeRetrievalQuery("token rotation policy")

    expect(result.query).toBe("token rotation policy")
    expect(result.changed).toBe(false)
    expect(result.method).toBe("passthrough")
  })

  it("extracts the final user question from a long prompt", () => {
    const prompt = [
      "System: You are an agent. Follow all repository rules. ".repeat(20),
      "The context above is not the retrieval query.",
      "What document proves offline text-to-speech is required?",
    ].join("\n")

    const result = sanitizeRetrievalQuery(prompt)

    expect(result.query).toBe("What document proves offline text-to-speech is required?")
    expect(result.changed).toBe(true)
    expect(result.method).toBe("question")
  })

  it("falls back to labeled query tails before truncating", () => {
    const prompt = `${"developer instructions ".repeat(40)}\nquery: release workflow approval checksums`

    const result = sanitizeRetrievalQuery(prompt)

    expect(result.query).toBe("release workflow approval checksums")
    expect(result.method).toBe("labeled-tail")
  })

  it("should extract the final useful sentence when a long prompt has no question", () => {
    const prompt = `${"Background context without retrieval value. ".repeat(20)}The final release evidence is in the signed deployment checklist.`

    expect(sanitizeRetrievalQuery(prompt)).toMatchObject({
      query: "The final release evidence is in the signed deployment checklist",
      method: "tail-sentence",
      changed: true,
    })
  })

  it("should keep a bounded tail when no sentence or label is usable", () => {
    const prompt = `label: no ${"x".repeat(400)}`

    const result = sanitizeRetrievalQuery(prompt)

    expect(result.method).toBe("tail")
    expect(result.query).toHaveLength(200)
    expect(result.query).toBe("x".repeat(200))
  })

  it("should remove lone surrogates and compact Unicode whitespace", () => {
    expect(sanitizeRetrievalQuery("  politique\ud800\n\tde confidentialité  ")).toMatchObject({
      query: "politique de confidentialité",
      method: "passthrough",
      changed: true,
    })
  })
})
