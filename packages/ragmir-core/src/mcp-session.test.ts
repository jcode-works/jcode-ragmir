import { describe, expect, it } from "vitest"
import { fitSearchGroups } from "./mcp-output.js"
import { applySeenResults, McpSessionMemory } from "./mcp-session.js"

function result(citation: string): { citation: string; relativePath: string; snippet: string } {
  return { citation, relativePath: citation.split("#")[0] ?? citation, snippet: "x".repeat(200) }
}

describe("MCP session memory", () => {
  it("keeps topK new passages and turns repeats into stubs, drops, or keeps them", () => {
    const memory = new McpSessionMemory()
    memory.remember(["a.md#0"])
    const results = [result("a.md#0"), result("b.md#0"), result("c.md#0"), result("d.md#0")]

    expect(applySeenResults(results, memory, "collapse", 2)).toEqual([
      { citation: "a.md#0", relativePath: "a.md", seen: true },
      result("b.md#0"),
      result("c.md#0"),
    ])
    expect(applySeenResults(results, memory, "exclude", 2)).toEqual([
      result("b.md#0"),
      result("c.md#0"),
    ])
    expect(applySeenResults(results, memory, "include", 2)).toEqual([
      result("a.md#0"),
      result("b.md#0"),
    ])
    expect(
      applySeenResults(results, memory, "exclude", 2, new Set(["b.md#0"])).map(
        (item) => item.citation,
      ),
    ).toEqual(["c.md#0", "d.md#0"])
  })

  it("trims batched groups from the largest one so every query keeps its best passage", () => {
    const groups = [
      { query: "first", results: [result("a.md#0"), result("b.md#0"), result("c.md#0")] },
      { query: "second", results: [result("d.md#0")] },
    ]

    const fitted = fitSearchGroups(groups, 900)

    expect(fitted.truncated).toBe(true)
    expect(fitted.value.map((group) => group.results.length)).toEqual([2, 1])
    expect(Buffer.byteLength(JSON.stringify(fitted.value))).toBeLessThanOrEqual(900)
  })
})
