import { describe, expect, it } from "vitest"
import { summarizeIndexedCorpus } from "./quality-report.js"

describe("summarizeIndexedCorpus", () => {
  it("should remain stable when only local file metadata changes", () => {
    const first = summarizeIndexedCorpus([
      {
        relativePath: ".ragmir/raw/a.md",
        checksum: "a".repeat(64),
        chunkCount: 1,
        bytes: 10,
        mtimeMs: 1,
      },
      {
        relativePath: ".ragmir/raw/b.md",
        checksum: "b".repeat(64),
        chunkCount: 2,
        bytes: 20,
        mtimeMs: 2,
      },
    ])
    const second = summarizeIndexedCorpus([
      {
        relativePath: ".ragmir/raw/a.md",
        checksum: "a".repeat(64),
        chunkCount: 9,
        bytes: 999,
        mtimeMs: 999,
      },
      {
        relativePath: ".ragmir/raw/b.md",
        checksum: "b".repeat(64),
        chunkCount: 8,
        bytes: 888,
        mtimeMs: 888,
      },
    ])

    expect(first).toMatchObject({ fileCount: 2, chunkCount: 3 })
    expect(first.corpusFingerprint).toMatch(/^[0-9a-f]{64}$/u)
    expect(second.corpusFingerprint).toBe(first.corpusFingerprint)
  })

  it("should change when an indexed path or file checksum changes", () => {
    const baseline = summarizeIndexedCorpus([
      { relativePath: ".ragmir/raw/a.md", checksum: "a".repeat(64), chunkCount: 1 },
    ]).corpusFingerprint

    expect(
      summarizeIndexedCorpus([
        { relativePath: ".ragmir/raw/renamed.md", checksum: "a".repeat(64), chunkCount: 1 },
      ]).corpusFingerprint,
    ).not.toBe(baseline)
    expect(
      summarizeIndexedCorpus([
        { relativePath: ".ragmir/raw/a.md", checksum: "b".repeat(64), chunkCount: 1 },
      ]).corpusFingerprint,
    ).not.toBe(baseline)
  })
})
