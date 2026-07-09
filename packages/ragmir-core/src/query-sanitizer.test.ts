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
})
