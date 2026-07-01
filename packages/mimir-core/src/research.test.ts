import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { ingest } from "./ingest.js"
import { initProject } from "./init.js"
import { compactResearchReport, compactSearchResults, research } from "./research.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("research", () => {
  it("rejects empty research queries", async () => {
    await expect(research("   ")).rejects.toThrow("Research query must not be empty.")
  })

  it("returns audit-backed evidence, source diagnostics, and code matches", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mimir-research-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".mimir", "raw", "raw_files"), { recursive: true })
    await mkdir(path.join(root, "src"), { recursive: true })
    await writeFile(
      path.join(root, ".mimir", "raw", "release-policy.md"),
      "The release workflow uses local approval, signed checksums, and a deployment deadline.\n",
      "utf8",
    )
    await writeFile(
      path.join(root, ".mimir", "raw", "raw_files", "release-policy-copy.md"),
      "The release workflow uses local approval, signed checksums, and a deployment deadline.\n",
      "utf8",
    )
    await writeFile(
      path.join(root, "src", "release-policy.ts"),
      "export const releaseWorkflow = 'local approval and signed checksums';\n",
      "utf8",
    )
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        dependencies: {
          "@example/release-helper": "file:../../private-release-artifacts/helper.tgz",
        },
      }),
      "utf8",
    )
    await writeFile(
      path.join(root, "package-lock.json"),
      JSON.stringify({
        packages: {
          "": {
            dependencies: {
              "@example/release-helper": "file:../../private-release-artifacts/helper.tgz",
            },
          },
        },
      }),
      "utf8",
    )

    await ingest({ cwd: root })
    const report = await research("release workflow approval checksums", { cwd: root, topK: 3 })

    expect(report.ready).toBe(true)
    expect(report.generatedQueries.length).toBeGreaterThan(1)
    expect(report.evidence.some((entry) => entry.relativePath.endsWith("release-policy.md"))).toBe(
      true,
    )
    expect(report.codeEvidence).toEqual([
      expect.objectContaining({
        relativePath: "src/release-policy.ts",
        lineNumber: 1,
      }),
    ])
    expect(report.sourceDiagnostics.duplicateCandidates.length).toBeGreaterThan(0)
    expect(report.sourceDiagnostics.mirrorCandidates).toEqual([
      expect.objectContaining({
        relativePath: ".mimir/raw/raw_files/release-policy-copy.md",
      }),
    ])

    const compact = compactResearchReport(report)
    expect(compact.evidence[0]).toHaveProperty("snippet")
    expect(compact.evidence[0]).not.toHaveProperty("text")
    expect(compactSearchResults(report.evidence)[0]?.snippet).toContain("release workflow")
  })
})
