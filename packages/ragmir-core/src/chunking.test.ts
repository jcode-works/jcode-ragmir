import { describe, expect, it } from "vitest"
import { chunkDocument } from "./chunking.js"
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
})
