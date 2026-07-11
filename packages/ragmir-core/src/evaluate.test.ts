import { cp, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import { evaluateGoldenQueries } from "./evaluate.js"
import { ingest } from "./ingest.js"

const tempDirs: string[] = []
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("evaluateGoldenQueries", () => {
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
})

async function copySovereignDemo(root: string): Promise<void> {
  await cp(path.join(packageRoot, "examples", "sovereign-rag-demo"), root, {
    recursive: true,
  })
  await rm(path.join(root, ".ragmir", "storage"), { recursive: true, force: true })
}
