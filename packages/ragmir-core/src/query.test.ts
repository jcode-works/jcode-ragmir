import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import { ingest } from "./ingest.js"
import { initProject } from "./init.js"
import { search, vectorCandidateLimit } from "./query.js"

const tempDirs: string[] = []
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("search", () => {
  it("keeps a broad vector candidate pool for small result sets", () => {
    expect(vectorCandidateLimit(1)).toBe(80)
    expect(vectorCandidateLimit(5)).toBe(80)
    expect(vectorCandidateLimit(25)).toBe(100)
  })

  it("uses lexical evidence in addition to vector candidates", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-query-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await writeFile(
      path.join(root, ".ragmir", "raw", "security-policy.md"),
      "Access tokens must be rotated every 30 days and stored outside source control.\n",
      "utf8",
    )
    await writeFile(
      path.join(root, ".ragmir", "raw", "operations.md"),
      "The weekly operations review covers facilities, staffing, and maintenance windows.\n",
      "utf8",
    )

    await ingest({ cwd: root })
    const results = await search("token rotation source control", { cwd: root, topK: 1 })

    expect(results).toHaveLength(1)
    expect(results[0]?.relativePath).toBe(".ragmir/raw/security-policy.md")
  })

  it("retrieves expected evidence from the sovereign RAG demo golden set", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "ragmir-golden-"))
    tempDirs.push(parent)
    const root = path.join(parent, "example")
    await cp(path.join(packageRoot, "examples", "sovereign-rag-demo"), root, {
      recursive: true,
    })

    await ingest({ cwd: root })

    await expectTopResult(root, "Which dataset was rejected for confidential tests?", [
      "raw/dataset-inventory.csv",
    ])
    await expectAnyResult(root, "What proves offline text-to-speech is required?", [
      "raw/incident-timeline.jsonl",
      "raw/review-notes.evidence",
    ])
    await expectAnyResult(root, "Who owns the usage review?", [
      "raw/operations-brief.md",
      "raw/security-policy.yaml",
      "raw/review-notes.evidence",
    ])
  })
})

async function expectTopResult(cwd: string, query: string, expectedPaths: string[]): Promise<void> {
  const results = await search(query, { cwd, topK: 3 })
  expect(expectedPaths).toContain(results[0]?.relativePath)
}

async function expectAnyResult(cwd: string, query: string, expectedPaths: string[]): Promise<void> {
  const results = await search(query, { cwd, topK: 3 })
  expect(results.some((result) => expectedPaths.includes(result.relativePath))).toBe(true)
}
