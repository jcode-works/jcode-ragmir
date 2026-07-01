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
    const parent = await mkdtemp(path.join(os.tmpdir(), "mimir-evaluate-"))
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
    const parent = await mkdtemp(path.join(os.tmpdir(), "mimir-evaluate-cap-"))
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
})
