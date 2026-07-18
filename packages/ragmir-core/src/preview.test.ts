import { existsSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { initProject } from "./init.js"
import { previewChunks } from "./preview.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("previewChunks", () => {
  it("should preview redacted structured chunks without writing an index", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-preview-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw", "guides"), { recursive: true })
    await writeFile(
      path.join(root, ".ragmir", "config.json"),
      JSON.stringify({ chunkSize: 80, chunkOverlap: 10 }),
      "utf8",
    )
    await writeFile(
      path.join(root, ".ragmir", "raw", "guides", "operations.md"),
      [
        "# Operations",
        "",
        "## Release evidence",
        "Contact owner@example.com before the signed release is promoted to production.",
        "",
        "A second paragraph makes the section large enough to produce another exact chunk.",
      ].join("\n"),
      "utf8",
    )

    const report = await previewChunks({
      cwd: root,
      paths: [".ragmir/raw/guides"],
      maxChunksPerFile: 1,
    })

    expect(report.matchedFiles).toBe(1)
    expect(report.unmatchedPaths).toEqual([])
    expect(report.files[0]?.redactions).toBe(1)
    expect(report.files[0]?.chunkStats.count).toBeGreaterThan(1)
    expect(report.files[0]?.chunkStats.contextualRatio).toBe(1)
    expect(report.files[0]?.chunks).toHaveLength(1)
    expect(report.files[0]?.chunks[0]?.contextPath).toContain("Operations")
    expect(report.files[0]?.chunks[0]?.citation).toContain(":L1-L1#0")
    expect(report.files[0]?.chunks[0]?.lineStart).toBe(1)
    expect(report.files[0]?.chunks[0]?.lineEnd).toBe(1)
    expect(report.files[0]?.chunks[0]?.text).not.toContain("owner@example.com")
    expect(report.files[0]?.omittedChunks).toBeGreaterThan(0)
    expect(existsSync(path.join(root, ".ragmir", "storage"))).toBe(false)
  })

  it("should report unmatched source prefixes without parsing unrelated files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-preview-unmatched-"))
    tempDirs.push(root)
    await initProject(root)

    const report = await previewChunks({ cwd: root, paths: ["missing"] })

    expect(report.matchedFiles).toBe(0)
    expect(report.unmatchedPaths).toEqual(["missing"])
    expect(report.files).toEqual([])
  })

  it("should reject invalid limits at the library boundary", async () => {
    await expect(previewChunks({ maxFiles: 0 })).rejects.toThrow("maxFiles")
    await expect(previewChunks({ maxChunksPerFile: 1.5 })).rejects.toThrow("maxChunksPerFile")
  })
})
