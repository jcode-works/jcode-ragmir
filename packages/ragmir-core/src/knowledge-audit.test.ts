import { describe, expect, it } from "vitest"
import { auditKnowledge, type KnowledgePage, writtenCitations } from "./knowledge-audit.js"

function page(path: string, text: string, contextPath = ""): KnowledgePage {
  return {
    path,
    passages: [
      {
        relativePath: path,
        chunkIndex: 0,
        text,
        lineStart: 1,
        charStart: 0,
        contextPath,
        citation: `${path}:L1-L9#0`,
      },
    ],
  }
}

const pages = [
  page(
    "wiki/index.md",
    "# Index\n- [Retries](retries.md)\n- [Old](old/retries-v1.md)\n- [[Incident 42]] and [[Incident 42]]\n",
    "Index",
  ),
  page(
    "wiki/retries.md",
    [
      "---",
      "title: Payment retries",
      "sources:",
      "  - path: raw/incident.md",
      "    sha256: old-checksum",
      "  - citation: raw/notes.md:L1-L2#0",
      "    evidence: stale-evidence",
      "---",
      "Retries back off, per `raw/notes.md:L1-L2#0` and raw/gone.md:L3-L4#1.",
      "See [[index]] and [archive](../archive/retries-v1.md).",
    ].join("\n"),
    "Payment retries",
  ),
  page(
    "wiki/orphan.md",
    "# Payment retries\nA second page with the same title.\n",
    "Payment retries",
  ),
  page(
    "wiki/derived.md",
    "---\nsources:\n  - raw/removed.md\n---\n# Derived\nWritten from a removed source.\n",
    "Derived",
  ),
]
const index = {
  checksums: new Map([
    ["wiki/index.md", "a"],
    ["wiki/retries.md", "b"],
    ["wiki/orphan.md", "c"],
    ["wiki/derived.md", "d"],
    ["archive/retries-v1.md", "e"],
    ["raw/incident.md", "new-checksum"],
    ["raw/notes.md", "f"],
  ]),
  passages: new Map([
    ["raw/notes.md#0", { citation: "raw/notes.md:L1-L2#0", evidence: "current" }],
  ]),
}

describe("auditKnowledge", () => {
  it("reports each finding once, with lines, suggestions, and counts", () => {
    const report = auditKnowledge(pages, index, { previewLimit: 10 })

    expect(report).toMatchObject({ pages: 4, links: 6, citations: 2 })
    expect(report.findings.brokenLinks.items).toEqual([
      {
        source: "wiki/index.md",
        line: 3,
        target: "old/retries-v1.md",
        citation: "wiki/index.md:L1-L9#0",
        suggestion: "archive/retries-v1.md",
      },
    ])
    expect(report.findings.missingPages.items).toEqual([
      { target: "Incident 42", references: 2, sources: ["wiki/index.md"] },
    ])
    expect(report.findings.unlinkedPages.items).toEqual([
      { path: "wiki/orphan.md" },
      { path: "wiki/derived.md" },
    ])
    expect(report.findings.duplicateTitles.items).toEqual([
      { title: "Payment retries", paths: ["wiki/retries.md", "wiki/orphan.md"] },
    ])
    expect(report.findings.brokenCitations.items).toEqual([
      { source: "wiki/retries.md", line: 6, citation: "raw/notes.md:L1-L2#0", status: "changed" },
      { source: "wiki/retries.md", line: 9, citation: "raw/gone.md:L3-L4#1", status: "missing" },
    ])
    expect(report.findings.stalePages.items).toEqual([
      { path: "wiki/retries.md", changedSources: ["raw/incident.md"] },
    ])
    expect(report.findings.lostSources.items).toEqual([{ path: "wiki/derived.md" }])
  })

  it("bounds the listed items and reports what removing a page would break", () => {
    const report = auditKnowledge(pages, index, {
      previewLimit: 1,
      assumeRemoved: ["wiki/retries.md"],
    })

    expect(report.findings.unlinkedPages).toEqual({ count: 2, items: [{ path: "wiki/orphan.md" }] })
    expect(report.assumeRemoved).toEqual({
      paths: ["wiki/retries.md"],
      brokenLinks: {
        count: 1,
        items: [
          {
            source: "wiki/index.md",
            line: 2,
            target: "retries.md",
            citation: "wiki/index.md:L1-L9#0",
          },
        ],
      },
      unlinkedPages: { count: 1, items: [{ path: "wiki/index.md" }] },
    })
  })
})

describe("writtenCitations", () => {
  it("reads citations in prose and code, and front matter citations with their evidence", () => {
    expect(writtenCitations(pages[1] as KnowledgePage)).toEqual([
      {
        citation: "raw/notes.md:L1-L2#0",
        key: "raw/notes.md#0",
        line: 6,
        evidence: "stale-evidence",
      },
      { citation: "raw/gone.md:L3-L4#1", key: "raw/gone.md#1", line: 9 },
    ])
    expect(writtenCitations(page("a.md", "Version 2.1#3 and issue#12 are not citations."))).toEqual(
      [],
    )
  })
})
