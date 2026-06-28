import { describe, expect, it } from "vitest"
import { chunkDocument } from "./chunking.js"
import type { ParsedDocument } from "./types.js"

describe("chunkDocument", () => {
  it("creates overlapping chunks without dropping text", () => {
    const doc: ParsedDocument = {
      file: {
        absolutePath: "/tmp/example.md",
        relativePath: "private/example.md",
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
    expect(chunks[0]?.relativePath).toBe("private/example.md")
    expect(chunks.every((chunk) => chunk.text.length > 0)).toBe(true)
  })
})
