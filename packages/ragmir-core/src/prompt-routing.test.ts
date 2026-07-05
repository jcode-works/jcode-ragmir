import { describe, expect, it } from "vitest"
import { routePrompt } from "./prompt-routing.js"

describe("routePrompt", () => {
  it("routes local architecture prompts to Ragmir research", () => {
    const decision = routePrompt(
      "Audit this repository architecture before we change packages/ragmir-core/src/mcp.ts.",
    )

    expect(decision.shouldUseRagmir).toBe(true)
    expect(decision.tool).toBe("ragmir_research")
    expect(decision.confidence).toBeGreaterThanOrEqual(0.55)
    expect(decision.query).toContain("packages/ragmir-core/src/mcp.ts")
    expect(decision.matchedSignals).toContain("current repository context")
  })

  it("routes exact citation prompts to Ragmir search", () => {
    const decision = routePrompt("Find the source passage that explains MCP helper generation.")

    expect(decision.shouldUseRagmir).toBe(true)
    expect(decision.tool).toBe("ragmir_search")
    expect(decision.query).toBe("Find the source passage that explains MCP helper generation.")
  })

  it("routes direct questions about local documents to Ragmir ask", () => {
    const decision = routePrompt("What do the local documents say about offline TTS?")

    expect(decision.shouldUseRagmir).toBe(true)
    expect(decision.tool).toBe("ragmir_ask")
  })

  it("routes setup readiness prompts to Ragmir status", () => {
    const decision = routePrompt("Use Ragmir to check whether the local index is ready.")

    expect(decision.shouldUseRagmir).toBe(true)
    expect(decision.tool).toBe("ragmir_status")
  })

  it("does not route self-contained language edits", () => {
    const decision = routePrompt("Translate this sentence to English: bonjour tout le monde")

    expect(decision.shouldUseRagmir).toBe(false)
    expect(decision.tool).toBe("none")
    expect(decision.query).toBeNull()
    expect(decision.matchedSignals).toContain("negative: simple language rewrite")
  })

  it("does not treat generic MCP questions as local Ragmir context", () => {
    const decision = routePrompt("What is MCP?")

    expect(decision.shouldUseRagmir).toBe(false)
    expect(decision.tool).toBe("none")
  })

  it("keeps the router local and explainable", () => {
    const decision = routePrompt("Use Ragmir to review the release readiness docs.")

    expect(decision.shouldUseRagmir).toBe(true)
    expect(decision.confidence).toBeLessThanOrEqual(0.95)
    expect(decision.safeguards).toContain("No prompt text is stored by this router.")
  })
})
