import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import { loadConfig } from "./config.js"
import { doctor } from "./doctor.js"
import {
  evaluateGoldenQueries,
  MAX_GOLDEN_CASES,
  MAX_GOLDEN_EXPECTED_VALUE_CHARACTERS,
  MAX_GOLDEN_EXPECTED_VALUES,
  MAX_GOLDEN_FILE_BYTES,
  MAX_GOLDEN_QUERY_CHARACTERS,
} from "./evaluate.js"
import { ingest } from "./ingest.js"
import { initProject } from "./init.js"
import { search } from "./query.js"
import { readIndexManifest, writeIndexManifest } from "./store.js"

const tempDirs: string[] = []
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("evaluateGoldenQueries", () => {
  it("should stop before reading a golden file when the signal is already aborted", async () => {
    const controller = new AbortController()
    controller.abort("cancelled by caller")

    await expect(
      evaluateGoldenQueries({
        cwd: process.cwd(),
        goldenPath: "missing-golden.json",
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "ABORTED", retryable: true })
  })

  it("should reject a golden file when it exceeds the byte limit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-evaluate-file-limit-"))
    tempDirs.push(root)
    const goldenPath = path.join(root, "oversized-golden.json")
    await writeFile(goldenPath, Buffer.alloc(MAX_GOLDEN_FILE_BYTES + 1))

    await expect(evaluateGoldenQueries({ cwd: root, goldenPath })).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    })
  })

  it("should reject a golden file when it declares too many cases", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-evaluate-case-limit-"))
    tempDirs.push(root)
    const goldenPath = path.join(root, "too-many-cases.json")
    const goldenCase = { query: "bounded query", expectedPaths: ["raw/source.md"] }
    await writeFile(
      goldenPath,
      JSON.stringify(Array(MAX_GOLDEN_CASES + 1).fill(goldenCase)),
      "utf8",
    )

    await expect(evaluateGoldenQueries({ cwd: root, goldenPath })).rejects.toThrow()
  })

  it("should reject a wrapped golden file when it declares too many cases", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-evaluate-wrapped-case-limit-"))
    tempDirs.push(root)
    const goldenPath = path.join(root, "too-many-wrapped-cases.json")
    const goldenCase = { query: "bounded query", expectedPaths: ["raw/source.md"] }
    await writeFile(
      goldenPath,
      JSON.stringify({ queries: Array(MAX_GOLDEN_CASES + 1).fill(goldenCase) }),
      "utf8",
    )

    await expect(evaluateGoldenQueries({ cwd: root, goldenPath })).rejects.toThrow()
  })

  it("should reject a golden case when its query exceeds the character limit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-evaluate-query-limit-"))
    tempDirs.push(root)
    const goldenPath = path.join(root, "oversized-query.json")
    await writeFile(
      goldenPath,
      JSON.stringify([
        {
          query: "q".repeat(MAX_GOLDEN_QUERY_CHARACTERS + 1),
          expectedPaths: ["raw/source.md"],
        },
      ]),
      "utf8",
    )

    await expect(evaluateGoldenQueries({ cwd: root, goldenPath })).rejects.toThrow()
  })

  it("should reject a golden case when it declares too many expected values", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-evaluate-expected-count-limit-"))
    tempDirs.push(root)
    const goldenPath = path.join(root, "too-many-expected-values.json")
    await writeFile(
      goldenPath,
      JSON.stringify([
        {
          query: "bounded query",
          expectedPaths: Array.from(
            { length: MAX_GOLDEN_EXPECTED_VALUES + 1 },
            (_value, index) => `raw/source-${index}.md`,
          ),
        },
      ]),
      "utf8",
    )

    await expect(evaluateGoldenQueries({ cwd: root, goldenPath })).rejects.toThrow()
  })

  it("should reject a golden case when it declares too many expected citations", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-evaluate-citation-count-limit-"))
    tempDirs.push(root)
    const goldenPath = path.join(root, "too-many-expected-citations.json")
    await writeFile(
      goldenPath,
      JSON.stringify([
        {
          query: "bounded query",
          expectedPaths: ["raw/source.md"],
          expectedCitations: Array.from(
            { length: MAX_GOLDEN_EXPECTED_VALUES + 1 },
            (_value, index) => `raw/source.md:L${index + 1}-L${index + 1}#0`,
          ),
        },
      ]),
      "utf8",
    )

    await expect(evaluateGoldenQueries({ cwd: root, goldenPath })).rejects.toThrow()
  })

  it("should reject a golden case when an expected value exceeds the character limit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-evaluate-expected-length-limit-"))
    tempDirs.push(root)
    const goldenPath = path.join(root, "oversized-expected-value.json")
    await writeFile(
      goldenPath,
      JSON.stringify([
        {
          query: "bounded query",
          expectedPaths: ["p".repeat(MAX_GOLDEN_EXPECTED_VALUE_CHARACTERS + 1)],
        },
      ]),
      "utf8",
    )

    await expect(evaluateGoldenQueries({ cwd: root, goldenPath })).rejects.toThrow()
  })

  it("measures recall against the sovereign RAG demo golden file", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "ragmir-evaluate-"))
    tempDirs.push(parent)
    const root = path.join(parent, "example")
    await copySovereignDemo(root)

    await ingest({ cwd: root })
    const report = await evaluateGoldenQueries({
      cwd: root,
      goldenPath: "golden-queries.json",
    })

    expect(report.total).toBe(4)
    expect(report.embeddingProvider).toBe("local-hash")
    expect(report.misses).toBe(0)
    expect(report.hitRate).toBe(1)
    expect(report.recall).toBeGreaterThan(0)
    expect(report.recall).toBeLessThanOrEqual(1)
    expect(report.precision).toBeGreaterThan(0)
    expect(report.p95LatencyMs).toBeGreaterThanOrEqual(report.p50LatencyMs)
    expect(report.meanReciprocalRank).toBeGreaterThan(0)
    expect(report.ndcg).toBeGreaterThan(0)
    expect(report.cases.every((result) => result.hit)).toBe(true)
    expect(report.cases.every((result) => result.reciprocalRank > 0)).toBe(true)
    expect(report.cases.every((result) => result.ndcg > 0)).toBe(true)
  })

  it("caps query topK when a caller provides a maximum", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "ragmir-evaluate-cap-"))
    tempDirs.push(parent)
    const root = path.join(parent, "example")
    await copySovereignDemo(root)
    await writeFile(
      path.join(root, "large-top-k-golden.json"),
      `${JSON.stringify(
        {
          topK: 50,
          queries: [
            {
              id: "large-top-k",
              query: "Which dataset was rejected for confidential tests?",
              expectedPaths: ["raw/dataset-inventory.csv"],
              topK: 50,
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    )

    await ingest({ cwd: root })
    const report = await evaluateGoldenQueries({
      cwd: root,
      goldenPath: "large-top-k-golden.json",
      maxTopK: 3,
    })

    expect(report.topK).toBe(3)
    expect(report.cases[0]?.topK).toBe(3)
  })

  it("measures recall against exact expected citations when provided", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "ragmir-evaluate-citation-"))
    tempDirs.push(parent)
    const root = path.join(parent, "example")
    await copySovereignDemo(root)
    await writeFile(
      path.join(root, "citation-golden.json"),
      `${JSON.stringify(
        {
          queries: [
            {
              id: "exact-citation",
              query: "Which dataset was rejected for confidential tests?",
              expectedPaths: ["raw/dataset-inventory.csv"],
              expectedCitations: ["raw/dataset-inventory.csv:L1-L5#0"],
              topK: 3,
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    )

    await ingest({ cwd: root })
    const report = await evaluateGoldenQueries({
      cwd: root,
      goldenPath: "citation-golden.json",
    })

    expect(report.hits).toBe(1)
    expect(report.recall).toBe(1)
    expect(report.hitRate).toBe(1)
    expect(report.precision).toBeGreaterThan(0)
    expect(report.meanReciprocalRank).toBe(1)
    expect(report.ndcg).toBe(1)
    expect(report.cases[0]?.matchedPaths).toContain("raw/dataset-inventory.csv")
    expect(report.cases[0]?.matchedCitations).toEqual(["raw/dataset-inventory.csv:L1-L5#0"])
  })

  it("keeps nDCG bounded when duplicate chunks match one relevant path", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "ragmir-evaluate-duplicates-"))
    tempDirs.push(parent)
    const root = path.join(parent, "example")
    await copySovereignDemo(root)
    await writeFile(
      path.join(root, "duplicate-golden.json"),
      JSON.stringify([
        {
          query: "confidential dataset rejected",
          expectedPaths: ["raw/dataset-inventory.csv"],
          topK: 8,
        },
      ]),
    )

    await ingest({ cwd: root })
    const report = await evaluateGoldenQueries({ cwd: root, goldenPath: "duplicate-golden.json" })

    expect(report.ndcg).toBeLessThanOrEqual(1)
    expect(report.cases[0]?.ndcg).toBeLessThanOrEqual(1)
  })

  it("applies source filters declared by each golden query", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "ragmir-evaluate-filter-"))
    tempDirs.push(parent)
    const root = path.join(parent, "example")
    await copySovereignDemo(root)
    await writeFile(
      path.join(root, "filtered-golden.json"),
      `${JSON.stringify(
        {
          queries: [
            {
              id: "primary-source-only",
              query: "Which dataset was rejected for confidential tests?",
              expectedPaths: ["raw/dataset-inventory.csv"],
              includePaths: ["raw"],
              excludePaths: ["raw/security-policy.yaml"],
              topK: 5,
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    )

    await ingest({ cwd: root })
    const report = await evaluateGoldenQueries({
      cwd: root,
      goldenPath: "filtered-golden.json",
    })

    const result = report.cases[0]
    expect(result?.hit).toBe(true)
    expect(result?.includePaths).toEqual(["raw"])
    expect(result?.excludePaths).toEqual(["raw/security-policy.yaml"])
    expect(result?.returnedPaths.every((relativePath) => relativePath.startsWith("raw/"))).toBe(
      true,
    )
    expect(result?.returnedPaths).not.toContain("raw/security-policy.yaml")
  })

  it("applies structural context filters declared by each golden query", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-evaluate-context-filter-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await writeFile(
      path.join(root, ".ragmir", "raw", "runbook.md"),
      [
        "# Operations",
        "",
        "## Current",
        "Verified approval evidence for the current workflow.",
        "",
        "## Archive",
        "Verified approval evidence for the archived workflow.",
      ].join("\n"),
      "utf8",
    )
    await writeFile(
      path.join(root, "context-golden.json"),
      JSON.stringify([
        {
          query: "verified approval evidence",
          expectedPaths: [".ragmir/raw/runbook.md"],
          contextPaths: ["Operations > Archive"],
          topK: 3,
        },
      ]),
      "utf8",
    )
    await ingest({ cwd: root })

    const report = await evaluateGoldenQueries({
      cwd: root,
      goldenPath: "context-golden.json",
    })

    expect(report.cases[0]?.hit).toBe(true)
    expect(report.cases[0]?.contextPaths).toEqual(["Operations > Archive"])
    expect(report.cases[0]?.returnedPaths).toEqual([".ragmir/raw/runbook.md"])
  })

  it("reports a miss when no expected path is retrieved", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "ragmir-evaluate-miss-"))
    tempDirs.push(parent)
    const root = path.join(parent, "example")
    await copySovereignDemo(root)
    await writeFile(
      path.join(root, "miss-golden.json"),
      `${JSON.stringify(
        {
          queries: [
            {
              id: "unreachable",
              query: "Which dataset was rejected for confidential tests?",
              // An expected path that will never be returned.
              expectedPaths: ["raw/does-not-exist.md"],
              topK: 3,
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    )

    await ingest({ cwd: root })
    const report = await evaluateGoldenQueries({
      cwd: root,
      goldenPath: "miss-golden.json",
    })

    expect(report.misses).toBe(1)
    expect(report.hits).toBe(0)
    expect(report.recall).toBe(0)
    const caseResult = report.cases[0]
    expect(caseResult?.hit).toBe(false)
    expect(caseResult?.bestRank).toBeNull()
  })

  it("reports a miss when only the expected path matches an exact citation query", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "ragmir-evaluate-citation-miss-"))
    tempDirs.push(parent)
    const root = path.join(parent, "example")
    await copySovereignDemo(root)
    await writeFile(
      path.join(root, "citation-miss-golden.json"),
      `${JSON.stringify(
        {
          queries: [
            {
              id: "wrong-citation",
              query: "Which dataset was rejected for confidential tests?",
              expectedPaths: ["raw/dataset-inventory.csv"],
              expectedCitations: ["raw/dataset-inventory.csv#99"],
              topK: 3,
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    )

    await ingest({ cwd: root })
    const report = await evaluateGoldenQueries({
      cwd: root,
      goldenPath: "citation-miss-golden.json",
    })

    expect(report.misses).toBe(1)
    expect(report.recall).toBe(0)
    const caseResult = report.cases[0]
    expect(caseResult?.matchedPaths).toContain("raw/dataset-inventory.csv")
    expect(caseResult?.matchedCitations).toEqual([])
    expect(caseResult?.hit).toBe(false)
    expect(caseResult?.bestRank).toBeNull()
    expect(caseResult?.reciprocalRank).toBe(0)
    expect(caseResult?.ndcg).toBe(0)
  })

  it("should persist a compatible graded quality report and invalidate it when golden data changes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-evaluate-quality-report-"))
    tempDirs.push(root)
    await initProject(root)
    const evidencePath = path.join(root, ".ragmir", "raw", "evidence.md")
    await writeFile(evidencePath, "Retention policy requires seven years.\n", "utf8")
    const goldenPath = path.join(root, "quality-golden.json")
    const golden = {
      topK: 5,
      minimumCasesForVerification: 3,
      thresholds: {
        recallAt1: 1,
        recallAt3: 1,
        recallAt5: 1,
        recallAt10: 1,
        precisionAt5: 0.2,
        meanReciprocalRankAt10: 1,
        ndcgAt10: 1,
        exactCitationRate: 1,
        maximumFalsePositiveRate: 0,
      },
      queries: [
        {
          id: "graded-path",
          query: "retention policy seven years",
          expectedPaths: [".ragmir/raw/evidence.md"],
          category: "exact-term",
          locale: "en",
          relevanceJudgments: [{ kind: "path", value: ".ragmir/raw/evidence.md", relevance: 3 }],
        },
        {
          id: "exact-citation",
          query: "retention policy seven years",
          expectedPaths: [".ragmir/raw/evidence.md"],
          expectedCitations: [".ragmir/raw/evidence.md:L1-L1#0"],
          category: "citation",
          locale: "en",
        },
        {
          id: "hard-negative",
          query: "quantum banana volcano",
          expectedPaths: [],
          answerable: false,
          category: "hard-negative",
          locale: "en",
        },
      ],
    }
    await writeFile(goldenPath, `${JSON.stringify(golden, null, 2)}\n`, "utf8")
    await ingest({ cwd: root })

    const report = await evaluateGoldenQueries({ cwd: root, goldenPath })

    expect(report.passed).toBe(true)
    expect(report.verificationEligible).toBe(true)
    expect(report.reportStored).toBe(true)
    expect(report.recallAt).toEqual({ 1: 1, 3: 1, 5: 1, 10: 1 })
    expect(report.precisionAt5).toBe(0.2)
    expect(report.exactCitationRate).toBe(1)
    expect(report.falsePositiveRate).toBe(0)
    expect(report.groups.categories["hard-negative"]?.falsePositiveRate).toBe(0)
    const config = await loadConfig(root)
    expect((await readIndexManifest(config))?.qualityReport).toMatchObject({
      schemaVersion: 3,
      qualityReportFingerprint: report.qualityReportFingerprint,
      rankingPolicyFingerprint: report.rankingPolicyFingerprint,
    })
    expect((await doctor(root, { deep: true })).readiness.retrievalQualityVerified).toBe(true)

    const manifest = await readIndexManifest(config)
    if (!manifest) {
      throw new Error("Expected an index manifest after quality evaluation.")
    }
    await writeIndexManifest(
      {
        ...manifest,
        staleFiles: [
          {
            relativePath: ".ragmir/raw/evidence.md",
            currentChecksum: "b".repeat(64),
            lastGoodChecksum: manifest.indexedFiles?.[0]?.checksum ?? "a".repeat(64),
            chunkCount: manifest.chunkCount,
            error: "simulated parse failure",
          },
        ],
      },
      config,
    )

    const staleReport = await evaluateGoldenQueries({ cwd: root, goldenPath })
    expect(staleReport.passed).toBe(true)
    expect(staleReport.verificationEligible).toBe(false)
    expect(staleReport.reportStored).toBe(false)
    expect((await doctor(root)).readiness.retrievalQualityVerified).toBe(false)

    await writeFile(goldenPath, `${JSON.stringify(golden, null, 2)}\n\n`, "utf8")

    expect((await doctor(root)).readiness.retrievalQualityVerified).toBe(false)
    await expect(search("retention policy", { cwd: root })).resolves.not.toEqual([])
  })

  it("should report independent quality gates", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "ragmir-evaluate-gates-"))
    tempDirs.push(parent)
    const root = path.join(parent, "example")
    await copySovereignDemo(root)
    await ingest({ cwd: root })

    const report = await evaluateGoldenQueries({
      cwd: root,
      goldenPath: "golden-queries.json",
      thresholds: { recallAt1: 0, precisionAt5: 1 },
    })

    expect(report.gates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metric: "recallAt1", passed: true }),
        expect.objectContaining({ metric: "precisionAt5", passed: false }),
      ]),
    )
    expect(report.passed).toBe(false)
  })
})

async function copySovereignDemo(root: string): Promise<void> {
  await cp(path.join(packageRoot, "examples", "sovereign-rag-demo"), root, {
    recursive: true,
  })
  await rm(path.join(root, ".ragmir", "storage"), { recursive: true, force: true })
}
