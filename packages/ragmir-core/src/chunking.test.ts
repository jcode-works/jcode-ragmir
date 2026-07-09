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
})
