import { describe, expect, it } from "vitest"
import { ingestionLimits } from "./limits.js"
import { testConfig } from "./test-support/config.js"

describe("ingestionLimits", () => {
  it("reports configurable per-file and fixed parser safety limits", () => {
    const report = ingestionLimits(testConfig({ maxFileBytes: 12_345_678 }))

    expect(report.maxFileBytes).toBe(12_345_678)
    expect(report.maxFiles).toBeNull()
    expect(report.maxCorpusBytes).toBeNull()
    expect(report.maxPdfPages).toBe(1_000)
    expect(report.maxPdfTextCharacters).toBe(25_000_000)
    expect(report.maxOfficeTextEntries).toBe(512)
    expect(report.notes.join(" ")).toContain("no hard file-count")
  })
})
