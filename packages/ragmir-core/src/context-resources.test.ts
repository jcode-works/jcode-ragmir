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
  it("should stop context diagnostics when the signal is already aborted", async () => {
    const controller = new AbortController()
    controller.abort("cancelled by caller")

    await expect(
      getKnowledgeBaseContext(process.cwd(), { signal: controller.signal }),
    ).rejects.toMatchObject({ code: "ABORTED", retryable: true })
  })

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
    expect(context.corpusFingerprint).toMatch(/^[0-9a-f]{64}$/u)
    expect(context.coverage.indexedFiles).toBe(1)
    expect(context.coverage.chunksIndexed).toBeGreaterThan(0)
    expect(context.routing.discoverCommand).toBe("rgr bases --json")
    expect(context.tools).toContain("ragmir_search")
    expect(context.resources).toEqual(["ragmir://context", "ragmir://sources"])
  })

  it("should match corpus fingerprints across independent roots with identical files", async () => {
    const firstRoot = await mkdtemp(path.join(os.tmpdir(), "ragmir-corpus-first-"))
    const secondRoot = await mkdtemp(path.join(os.tmpdir(), "ragmir-corpus-second-"))
    tempDirs.push(firstRoot, secondRoot)
    await Promise.all([initProject(firstRoot), initProject(secondRoot)])
    const firstPath = path.join(".ragmir", "raw", "a-policy.md")
    const secondPath = path.join(".ragmir", "raw", "z-decision.md")
    await writeFile(path.join(firstRoot, firstPath), "Shared local policy.\n", "utf8")
    await writeFile(path.join(firstRoot, secondPath), "Shared local decision.\n", "utf8")
    await writeFile(path.join(secondRoot, secondPath), "Shared local decision.\n", "utf8")
    await writeFile(path.join(secondRoot, firstPath), "Shared local policy.\n", "utf8")
    await Promise.all([ingest({ cwd: firstRoot }), ingest({ cwd: secondRoot })])

    const first = await getKnowledgeBaseContext(firstRoot)
    const second = await getKnowledgeBaseContext(secondRoot)

    expect(first.ready).toBe(true)
    expect(second.ready).toBe(true)
    expect(second.corpusFingerprint).toBe(first.corpusFingerprint)

    await writeFile(path.join(secondRoot, secondPath), "Different local decision.\n", "utf8")
    await ingest({ cwd: secondRoot })

    expect((await getKnowledgeBaseContext(secondRoot)).corpusFingerprint).not.toBe(
      first.corpusFingerprint,
    )
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
    expect(catalog.page).toEqual({ offset: 0, limit: 50, nextOffset: 50 })

    const secondPage = await getKnowledgeBaseSourceCatalog(root, { offset: 50, limit: 10 })
    expect(secondPage.indexedFiles).toHaveLength(5)
    expect(secondPage.indexedFiles[0]?.source).toBe(".ragmir/raw/source-50.md")
    expect(secondPage.page).toEqual({ offset: 50, limit: 10, nextOffset: null })
  })
})
