import { describe, expect, it } from "vitest"
import { ingestionLimits } from "./limits.js"
import { testConfig } from "./test-support/config.js"

describe("ingestionLimits", () => {
  it("reports configurable per-file and fixed parser safety limits", () => {
    const report = ingestionLimits(testConfig({ maxFileBytes: 12_345_678 }))

    expect(report.maxFileBytes).toBe(12_345_678)
    expect(report.hardMaxFileBytes).toBe(50_000_000)
    expect(report.maxFiles).toBeNull()
    expect(report.maxCorpusBytes).toBeNull()
    expect(report.maxFileBatchSize).toBe(128)
    expect(report.maxIngestConcurrency).toBe(8)
    expect(report.maxEmbeddingBatchSize).toBe(128)
    expect(report.maxSourceWindowBytes).toBe(50_000_000)
    expect(report.maxChunkWindow).toBe(8_192)
    expect(report.maxChunksPerFile).toBe(65_536)
    expect(report.maxVectorBytesPerFile).toBe(256 * 1_024 * 1_024)
    expect(report.maxPdfPages).toBe(1_000)
    expect(report.maxPdfTextCharacters).toBe(25_000_000)
    expect(report.maxOfficeTextEntries).toBe(512)
    expect(report.notes.join(" ")).toContain("no hard file-count")
  })
})
