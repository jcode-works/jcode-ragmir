import { describe, expect, it } from "vitest"
import { linkResolver, markdownLinks } from "./markdown-links.js"

describe("markdownLinks", () => {
  it("reads inline, reference, and wiki links with their lines", () => {
    const text = [
      "# Payments",
      "See [retries](./retries.md#backoff) and ![chart](img/flow.png).",
      "Also [[Refund Policy|refunds]], [[ops/runbook#Rollback]], and ![[diagram.excalidraw]].",
      "",
      '[spec]: <../specs/api spec.md> "API"',
    ].join("\n")

    expect(markdownLinks(text)).toEqual([
      { line: 2, target: "./retries.md", wikilink: false },
      { line: 2, target: "img/flow.png", wikilink: false },
      { line: 3, target: "Refund Policy", wikilink: true },
      { line: 3, target: "ops/runbook", wikilink: true },
      { line: 3, target: "diagram.excalidraw", wikilink: true },
      { line: 5, target: "../specs/api spec.md", wikilink: false },
    ])
  })

  it("skips code, external targets, in-page anchors, and escaped brackets", () => {
    const text = [
      "```md",
      "[not a link](inside.md) [[nor this]]",
      "```",
      "Inline `[code](code.md)` stays text, \\[escaped\\](no.md) too.",
      "[site](https://example.com) [mail](mailto:a@b.c) [top](#intro) [proto](//cdn.example.com/x)",
      "[encoded](notes/caf%C3%A9.md?raw=1)",
    ].join("\n")

    expect(markdownLinks(text)).toEqual([{ line: 6, target: "notes/café.md", wikilink: false }])
  })
})

describe("linkResolver", () => {
  const resolve = linkResolver([
    "docs/payments.md",
    "docs/retries.md",
    "docs/refund policy.md",
    "archive/refund policy.md",
    "ops/runbook.md",
    "wiki/Diagram.md",
    "wiki/sub/diagram.md",
    "notes/a/same.md",
    "notes/b/same.md",
  ])
  const link = (target: string, wikilink = false) => ({ line: 1, target, wikilink })

  it("resolves relative links from the page, with or without .md", () => {
    expect(resolve(link("./retries.md"), "docs/payments.md")).toBe("docs/retries.md")
    expect(resolve(link("retries"), "docs/payments.md")).toBe("docs/retries.md")
    expect(resolve(link("/ops/runbook.md"), "docs/payments.md")).toBe("ops/runbook.md")
    expect(resolve(link("../ops/runbook.md"), "docs/payments.md")).toBe("ops/runbook.md")
    expect(resolve(link("../../outside.md"), "docs/payments.md")).toBeNull()
    expect(resolve(link("missing.md"), "docs/payments.md")).toBeNull()
  })

  it("resolves wikilinks by path, then by the shortest path that holds the name", () => {
    expect(resolve(link("ops/runbook", true), "docs/payments.md")).toBe("ops/runbook.md")
    expect(resolve(link("Diagram", true), "docs/payments.md")).toBe("wiki/Diagram.md")
    expect(resolve(link("diagram", true), "docs/payments.md")).toBe("wiki/Diagram.md")
    expect(resolve(link("Refund Policy", true), "ops/runbook.md")).toBeNull()
    expect(resolve(link("same", true), "docs/payments.md")).toBeNull()
  })
})
