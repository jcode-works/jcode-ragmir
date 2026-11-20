import { describe, expect, it } from "vitest"
import { markdownFenceSpans, markdownFrontmatter, structuralSpans } from "./document-structure.js"

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

  it("should keep YAML front matter whole and root a page without H1 at its title", () => {
    const text = [
      "---",
      "title: Payment retries",
      "description: How failed payments are retried.",
      "sources: [raw/incident-42.md]",
      "---",
      "Retries follow the policy below.",
      "",
      "## Backoff",
      "Wait 2, 4, then 8 minutes.",
    ].join("\n")

    const spans = structuralSpans(text, ".md", 1_200)

    expect(spans.map((span) => span.contextPath)).toEqual([
      "Payment retries",
      "Payment retries",
      "Payment retries > Backoff",
    ])
    expect(text.slice(spans[0]?.charStart, spans[0]?.charEnd)).toBe(
      "---\ntitle: Payment retries\ndescription: How failed payments are retried.\nsources: [raw/incident-42.md]\n---\n",
    )
    expect(markdownFrontmatter(text)).toEqual({
      end: spans[0]?.charEnd,
      title: "Payment retries",
      description: "How failed payments are retried.",
      sources: [{ path: "raw/incident-42.md" }],
    })
  })

  it("should keep a page's own H1 as the root and read TOML front matter as a block", () => {
    const yaml = ["---", "title: Front title", "---", "# Page title", "Body."].join("\n")
    const toml = ["+++", 'title = "Hugo page"', "+++", "## Setup", "Steps."].join("\n")

    expect(structuralSpans(yaml, ".md", 1_200).map((span) => span.contextPath)).toEqual([
      "Front title",
      "Page title",
    ])
    expect(structuralSpans(toml, ".md", 1_200).map((span) => span.contextPath)).toEqual([
      "",
      "Setup",
    ])
    expect(markdownFrontmatter(toml)?.title).toBeUndefined()
  })

  it("should not mistake thematic breaks or malformed YAML for a title", () => {
    const breaks = ["---", "Just prose between rules.", "---", "More prose."].join("\n")
    const malformed = ["---", "title: [unclosed", "---", "Body."].join("\n")

    expect(markdownFrontmatter(breaks)).toBeNull()
    expect(structuralSpans(breaks, ".md", 1_200).map((span) => span.contextPath)).toEqual([
      "",
      "Just prose between rules.",
    ])
    expect(markdownFrontmatter(malformed)).toEqual({ end: 25 })
    expect(structuralSpans(malformed, ".md", 1_200).map((span) => span.contextPath)).toEqual([
      "",
      "",
    ])
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
