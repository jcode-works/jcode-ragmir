import { describe, expect, it } from "vitest"
import { markdownFenceSpans, structuralSpans } from "./document-structure.js"

describe("structuralSpans", () => {
  it("should preserve nested heading paths when Markdown sections are detected", () => {
    const text = [
      "Preamble.",
      "",
      "# Install",
      "Install overview.",
      "",
      "## MCP",
      "MCP details.",
      "",
      "### Codex",
      "Codex details.",
    ].join("\n")

    const spans = structuralSpans(text, ".md", 1_200)

    expect(spans.map((span) => span.contextPath)).toEqual([
      "",
      "Install",
      "Install > MCP",
      "Install > MCP > Codex",
    ])
    expect(spans.map((span) => text.slice(span.charStart, span.charEnd))).toEqual([
      "Preamble.\n\n",
      "# Install\nInstall overview.\n\n",
      "## MCP\nMCP details.\n\n",
      "### Codex\nCodex details.",
    ])
  })

  it("should recognize Setext headings and ignore heading markers inside fences", () => {
    const text = [
      "Guide",
      "=====",
      "",
      "```md",
      "# Not a heading",
      "```",
      "",
      "Usage",
      "-----",
      "Use it.",
    ].join("\n")

    const spans = structuralSpans(text, ".md", 1_200)

    expect(spans.map((span) => span.contextPath)).toEqual(["Guide", "Guide > Usage"])
    expect(markdownFenceSpans(text)).toHaveLength(1)
  })

  it("should expose exact JSON ranges with JSONPath context", () => {
    const text = JSON.stringify(
      {
        projects: [
          { owner: "alice", status: "ready" },
          { owner: "bob", status: "blocked" },
        ],
        policy: { retentionDays: 30 },
      },
      null,
      2,
    )

    const spans = structuralSpans(text, ".json", 70)

    expect(spans.length).toBeGreaterThan(1)
    expect(spans.some((span) => span.contextPath.includes("$.projects"))).toBe(true)
    expect(spans.some((span) => span.contextPath.includes("$.policy"))).toBe(true)
    expect(spans.every((span) => text.slice(span.charStart, span.charEnd).length > 0)).toBe(true)
    expect(spans.every((span) => span.charStart >= 0 && span.charEnd <= text.length)).toBe(true)
  })

  it("should keep repeated JSON keys distinct through their parent paths", () => {
    const text = JSON.stringify(
      {
        primary: { owner: "alice", description: "A".repeat(50) },
        secondary: { owner: "bob", description: "B".repeat(50) },
      },
      null,
      2,
    )

    const spans = structuralSpans(text, ".json", 55)
    const paths = spans.map((span) => span.contextPath)

    expect(paths.some((value) => value.startsWith("$.primary"))).toBe(true)
    expect(paths.some((value) => value.startsWith("$.secondary"))).toBe(true)
  })

  it("should group valid JSONL entries without changing their source ranges", () => {
    const text = ['{"id":1,"state":"ready"}', '{"id":2,"state":"blocked"}'].join("\n")

    const spans = structuralSpans(text, ".jsonl", 35)

    expect(spans).toHaveLength(2)
    expect(spans[0]?.contextPath).toBe("$[1]")
    expect(text.slice(spans[1]?.charStart, spans[1]?.charEnd)).toBe('{"id":2,"state":"blocked"}')
  })

  it("should fall back when JSON content is invalid", () => {
    expect(structuralSpans('{"broken":', ".json", 100)).toEqual([])
    expect(structuralSpans('{"valid":true}\nnot-json', ".jsonl", 100)).toEqual([])
  })
})
