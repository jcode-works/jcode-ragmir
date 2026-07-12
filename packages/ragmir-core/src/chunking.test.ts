import { describe, expect, it } from "vitest"
import { chunkDocument, chunkSearchText } from "./chunking.js"
import type { ParsedDocument } from "./types.js"

describe("chunkDocument", () => {
  it("creates overlapping chunks without dropping text", () => {
    const doc: ParsedDocument = {
      file: {
        absolutePath: "/tmp/example.md",
        relativePath: ".ragmir/raw/example.md",
        source: "example.md",
        extension: ".md",
        bytes: 100,
        mtimeMs: 1,
        checksum: "abc",
      },
      text: "Alpha beta gamma. Delta epsilon zeta. Eta theta iota. Kappa lambda mu.",
    }

    const chunks = chunkDocument(doc, 35, 8)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0]?.relativePath).toBe(".ragmir/raw/example.md")
    expect(chunks.every((chunk) => chunk.text.length > 0)).toBe(true)
  })

  it("records character and line spans for each chunk", () => {
    const doc: ParsedDocument = {
      file: {
        absolutePath: "/tmp/example.md",
        relativePath: ".ragmir/raw/example.md",
        source: "example.md",
        extension: ".md",
        bytes: 100,
        mtimeMs: 1,
        checksum: "abc",
      },
      text: "Alpha line\n\nBeta line with evidence\nGamma line continues\n",
    }

    const chunks = chunkDocument(doc, 18, 0)

    expect(chunks[0]).toEqual(
      expect.objectContaining({
        text: "Alpha line",
        charStart: 0,
        charEnd: 10,
        lineStart: 1,
        lineEnd: 1,
      }),
    )
    expect(chunks[1]).toEqual(
      expect.objectContaining({
        lineStart: 3,
        lineEnd: 3,
      }),
    )
  })

  it("records PDF page ranges for chunks", () => {
    const doc: ParsedDocument = {
      file: {
        absolutePath: "/tmp/example.pdf",
        relativePath: ".ragmir/raw/example.pdf",
        source: "example.pdf",
        extension: ".pdf",
        bytes: 100,
        mtimeMs: 1,
        checksum: "abc",
      },
      text: "Page one evidence\n\nPage two evidence",
      pages: [
        { pageNumber: 1, charStart: 0, charEnd: 17 },
        { pageNumber: 2, charStart: 19, charEnd: 36 },
      ],
    }

    const chunks = chunkDocument(doc, 18, 0)

    expect(chunks[0]).toEqual(expect.objectContaining({ pageStart: 1, pageEnd: 1 }))
    expect(chunks[1]).toEqual(expect.objectContaining({ pageStart: 2, pageEnd: 2 }))
  })

  it("prefers CJK sentence boundaries", () => {
    const doc: ParsedDocument = {
      file: {
        absolutePath: "/tmp/example.md",
        relativePath: ".ragmir/raw/example.md",
        source: "example.md",
        extension: ".md",
        bytes: 100,
        mtimeMs: 1,
        checksum: "abc",
      },
      text: "第一段包含重要证据。第二段包含不同证据。第三段继续补充详细信息。",
    }

    const chunks = chunkDocument(doc, 24, 0)

    expect(chunks[0]?.text.endsWith("。")).toBe(true)
  })

  it("prefers line boundaries for structured text", () => {
    const doc: ParsedDocument = {
      file: {
        absolutePath: "/tmp/example.ts",
        relativePath: ".ragmir/raw/example.ts",
        source: "example.ts",
        extension: ".ts",
        bytes: 100,
        mtimeMs: 1,
        checksum: "abc",
      },
      text: "const alpha = 1\nconst beta = 2\nconst gamma = 3\n",
    }

    const chunks = chunkDocument(doc, 22, 0)

    expect(chunks[0]?.text).toBe("const alpha = 1")
    expect(chunks[1]?.text).toBe("const beta = 2")
  })

  it("should keep Markdown context separate from cited text when sections are chunked", () => {
    const doc: ParsedDocument = {
      file: {
        absolutePath: "/tmp/guide.md",
        relativePath: ".ragmir/raw/guide.md",
        source: "guide.md",
        extension: ".md",
        bytes: 200,
        mtimeMs: 1,
        checksum: "guide",
      },
      text: "# Install\nOverview text.\n\n## MCP\nBounded output details.",
    }

    const chunks = chunkDocument(doc, 40, 8)
    const mcpChunk = chunks.find((chunk) => chunk.contextPath === "Install > MCP")

    expect(mcpChunk?.text).toContain("## MCP")
    expect(mcpChunk?.text).not.toContain("Install > MCP")
    expect(mcpChunk && chunkSearchText(mcpChunk)).toContain("Install > MCP\n## MCP")
  })

  it("should avoid splitting a fenced block when the complete block fits", () => {
    const doc: ParsedDocument = {
      file: {
        absolutePath: "/tmp/code.md",
        relativePath: ".ragmir/raw/code.md",
        source: "code.md",
        extension: ".md",
        bytes: 200,
        mtimeMs: 1,
        checksum: "code",
      },
      text: [
        "# API",
        "Intro text before code.",
        "",
        "```ts",
        "const alpha = 1",
        "const beta = 2",
        "```",
        "After.",
      ].join("\n"),
    }

    const chunks = chunkDocument(doc, 52, 8)
    const codeChunk = chunks.find((chunk) => chunk.text.includes("const alpha"))

    expect(codeChunk?.text).toContain("const beta = 2")
    expect(codeChunk?.text).toContain("```ts")
    expect(codeChunk?.text).toContain("```")
  })

  it("should retain exact JSON offsets while adding JSONPath context", () => {
    const text = JSON.stringify(
      {
        primary: { owner: "alice", description: "A".repeat(50) },
        secondary: { owner: "bob", description: "B".repeat(50) },
      },
      null,
      2,
    )
    const doc: ParsedDocument = {
      file: {
        absolutePath: "/tmp/projects.json",
        relativePath: ".ragmir/raw/projects.json",
        source: "projects.json",
        extension: ".json",
        bytes: Buffer.byteLength(text),
        mtimeMs: 1,
        checksum: "json",
      },
      text,
    }

    const chunks = chunkDocument(doc, 60, 0)

    expect(chunks.some((chunk) => chunk.contextPath.startsWith("$.primary"))).toBe(true)
    expect(chunks.some((chunk) => chunk.contextPath.startsWith("$.secondary"))).toBe(true)
    expect(chunks.every((chunk) => text.slice(chunk.charStart, chunk.charEnd) === chunk.text)).toBe(
      true,
    )
  })
})
