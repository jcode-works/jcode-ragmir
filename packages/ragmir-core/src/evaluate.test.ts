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
    await cp(path.join(packageRoot, "examples", "sovereign-rag-demo"), root, {
      recursive: true,
    })

    await ingest({ cwd: root })
    const report = await evaluateGoldenQueries({
      cwd: root,
      goldenPath: "golden-queries.json",
    })

    expect(report.total).toBe(4)
    expect(report.embeddingProvider).toBe("local-hash")
    expect(report.misses).toBe(0)
    expect(report.recall).toBe(1)
    expect(report.cases.every((result) => result.hit)).toBe(true)
  })

  it("caps query topK when a caller provides a maximum", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "ragmir-evaluate-cap-"))
    tempDirs.push(parent)
    const root = path.join(parent, "example")
    await cp(path.join(packageRoot, "examples", "sovereign-rag-demo"), root, {
      recursive: true,
    })
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

  it("reports a miss when no expected path is retrieved", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "ragmir-evaluate-miss-"))
    tempDirs.push(parent)
    const root = path.join(parent, "example")
    await cp(path.join(packageRoot, "examples", "sovereign-rag-demo"), root, {
      recursive: true,
    })
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
})
