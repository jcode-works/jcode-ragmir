import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { getKnowledgeBaseContext, getKnowledgeBaseSourceCatalog } from "./context-resources.js"
import { ingest } from "./ingest.js"
import { initProject } from "./init.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("context resources", () => {
  it("should return a bounded agent context with readiness and routing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-context-resource-"))
    tempDirs.push(root)
    await initProject(root)
    await writeFile(
      path.join(root, ".ragmir", "raw", "policy.md"),
      "Verified local retrieval policy.\n",
      "utf8",
    )
    await ingest({ cwd: root })

    const context = await getKnowledgeBaseContext(root)

    expect(context.knowledgeBaseId).toBe(".")
    expect(context.ready).toBe(true)
    expect(context.coverage.indexedFiles).toBe(1)
    expect(context.coverage.chunksIndexed).toBeGreaterThan(0)
    expect(context.routing.discoverCommand).toBe("rgr bases --json")
    expect(context.tools).toContain("ragmir_search")
    expect(context.resources).toEqual(["ragmir://context", "ragmir://sources"])
  })

  it("should cap source details while preserving complete totals", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-source-resource-"))
    tempDirs.push(root)
    await initProject(root)
    const rawDir = path.join(root, ".ragmir", "raw")
    await mkdir(rawDir, { recursive: true })
    await Promise.all(
      Array.from({ length: 55 }, (_value, index) =>
        writeFile(
          path.join(rawDir, `source-${index.toString().padStart(2, "0")}.md`),
          `Indexed source evidence ${index}.\n`,
          "utf8",
        ),
      ),
    )
    await ingest({ cwd: root })

    const catalog = await getKnowledgeBaseSourceCatalog(root)

    expect(catalog.totals.indexedFiles).toBe(55)
    expect(catalog.indexedFiles).toHaveLength(50)
    expect(catalog.omitted.indexedFiles).toBe(5)
    expect(catalog.totals.chunks).toBeGreaterThanOrEqual(55)
  })
})
