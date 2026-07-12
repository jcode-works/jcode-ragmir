import { describe, expect, it } from "vitest"
import type { McpAskPayload, McpResearchPayload, McpSearchPayload } from "./mcp-output.js"
import {
  budgetMcpJson,
  fitAskPayload,
  fitExpandedCitation,
  fitResearchPayload,
  fitSearchPayload,
  resolveMcpOutputBudget,
} from "./mcp-output.js"
import type { ExpandedCitation, SearchResult } from "./types.js"

describe("MCP output budgeting", () => {
  it("should preserve the JSON root when the response exceeds the UTF-8 byte budget", () => {
    const full = [searchResult("évidence ".repeat(600))]
    const compact: McpSearchPayload = [
      {
        source: "policy.md",
        relativePath: "raw/policy.md",
        chunkIndex: 0,
        citation: "raw/policy.md:L1-L2#0",
        snippet: "évidence concise",
        distance: 0.1,
        lineStart: 1,
        lineEnd: 2,
        pageStart: null,
        pageEnd: null,
      },
    ]

    const bounded = budgetMcpJson({
      tool: "ragmir_search",
      maxBytes: 1_024,
      fullValue: full,
      preferredValue: full,
      compactValue: compact,
      compacted: false,
      reduce: fitSearchPayload,
    })

    expect(Array.isArray(JSON.parse(bounded.result.content[0].text))).toBe(true)
    expect(Buffer.byteLength(bounded.result.content[0].text, "utf8")).toBeLessThanOrEqual(1_024)
    expect(bounded.metadata.compacted).toBe(true)
    expect(bounded.metadata.retrievedBytes).toBeGreaterThan(bounded.metadata.returnedBytes)
  })

  it("should keep the payload unchanged when it already fits", () => {
    const value = [searchResult("short evidence")]

    const bounded = budgetMcpJson({
      tool: "ragmir_search",
      maxBytes: 32_768,
      fullValue: value,
      preferredValue: value,
      compacted: false,
      reduce: fitSearchPayload,
    })

    expect(bounded.result.content).toEqual([{ type: "text", text: JSON.stringify(value) }])
    expect(bounded.metadata.truncated).toBe(false)
    expect(bounded.metadata.returnedBytes).toBe(bounded.metadata.retrievedBytes)
  })

  it("should clamp requested budgets to the configured maximum", () => {
    expect(resolveMcpOutputBudget(8_192, 20_000)).toBe(8_192)
    expect(resolveMcpOutputBudget(8_192, 1_024)).toBe(1_024)
  })

  it("should retain an ask object when sources must be omitted", () => {
    const value: McpAskPayload = {
      answer: "answer ".repeat(400),
      sources: [searchResult("source ".repeat(400))],
      staleWarning: null,
    }

    const fitted = fitAskPayload(value, 1_024)

    expect(Array.isArray(fitted.value.sources)).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(fitted.value), "utf8")).toBeLessThanOrEqual(1_024)
    expect(fitted.truncated).toBe(true)
  })

  it("should trim research detail while preserving its report shape", () => {
    const value = researchPayload("diagnostic ".repeat(300))
    value.query = "é".repeat(3_000)

    const fitted = fitResearchPayload(value, 1_024)

    expect(fitted.value.audit.totalChunks).toBe(4)
    expect(fitted.value.sourceDiagnostics).toEqual({
      duplicateCandidates: [],
      archiveCandidates: [],
      mirrorCandidates: [],
    })
    expect(Buffer.byteLength(JSON.stringify(fitted.value), "utf8")).toBeLessThanOrEqual(1_024)
  })

  it("should prioritize the requested passage when expansion must be truncated", () => {
    const value: ExpandedCitation = {
      requestedCitation: "raw/policy.md:L2-L3#1",
      found: true,
      relativePath: "raw/policy.md",
      chunkIndex: 1,
      contextRadius: 1,
      passages: [
        contextPassage(0, "short before"),
        contextPassage(1, "target évidence ".repeat(300)),
        contextPassage(2, "short after"),
      ],
    }

    const fitted = fitExpandedCitation(value, 1_024)

    expect(fitted.value.passages[0]?.chunkIndex).toBe(1)
    expect(Buffer.byteLength(JSON.stringify(fitted.value), "utf8")).toBeLessThanOrEqual(1_024)
    expect(fitted.truncated).toBe(true)
  })

  it("should fit long Unicode citation metadata when the minimum budget is active", () => {
    const relativePath = `raw/${"資料".repeat(900)}.md`
    const value: ExpandedCitation = {
      requestedCitation: `${relativePath}:L1-L2#0`,
      found: false,
      relativePath,
      chunkIndex: 0,
      contextRadius: 0,
      passages: [],
    }

    const bounded = budgetMcpJson({
      tool: "ragmir_expand",
      maxBytes: 1_024,
      fullValue: value,
      preferredValue: value,
      compacted: false,
      reduce: fitExpandedCitation,
    })

    expect(Buffer.byteLength(bounded.result.content[0].text, "utf8")).toBeLessThanOrEqual(1_024)
    expect(JSON.parse(bounded.result.content[0].text)).toMatchObject({
      found: false,
      passages: [],
    })
    expect(bounded.metadata.truncated).toBe(true)
  })
})

function searchResult(text: string): SearchResult {
  return {
    source: "policy.md",
    relativePath: "raw/policy.md",
    chunkIndex: 0,
    citation: "raw/policy.md:L1-L2#0",
    text,
    distance: 0.1,
    charStart: 0,
    charEnd: text.length,
    lineStart: 1,
    lineEnd: 2,
    pageStart: null,
    pageEnd: null,
    context: [],
  }
}

function researchPayload(detail: string): McpResearchPayload {
  return {
    query: "release evidence",
    generatedQueries: [detail, detail],
    ready: true,
    audit: {
      supportedFiles: 1,
      supportedBytes: 100,
      largestFileBytes: 100,
      skippedFiles: 0,
      unsupportedFiles: 0,
      oversizedFiles: 0,
      indexedFiles: 1,
      totalChunks: 4,
      missingFromIndex: 0,
      staleInIndex: 0,
      emptyTextFiles: 0,
    },
    securityWarnings: [detail],
    sourceDiagnostics: {
      duplicateCandidates: [{ key: "duplicate", files: [detail] }],
      archiveCandidates: [{ relativePath: detail, reason: "archive" }],
      mirrorCandidates: [{ relativePath: detail, reason: "mirror" }],
    },
    evidence: [],
    codeEvidence: [],
    gaps: [detail],
    nextSteps: [detail],
  }
}

function contextPassage(chunkIndex: number, text: string) {
  return {
    chunkIndex,
    text,
    charStart: chunkIndex * 10,
    charEnd: chunkIndex * 10 + text.length,
    lineStart: chunkIndex + 1,
    lineEnd: chunkIndex + 1,
    pageStart: null,
    pageEnd: null,
    citation: `raw/policy.md:L${chunkIndex + 1}-L${chunkIndex + 1}#${chunkIndex}`,
  }
}
