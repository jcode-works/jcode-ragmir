import { subscribe, unsubscribe } from "node:diagnostics_channel"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { ingest } from "./ingest.js"
import { initProject } from "./init.js"
import { search } from "./query.js"
import {
  compactResearchReport,
  compactSearchResults,
  rankResearchEvidence,
  research,
} from "./research.js"
import type { SearchResult } from "./types.js"

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
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-research-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw", "raw_files"), { recursive: true })
    await mkdir(path.join(root, "src"), { recursive: true })
    await writeFile(
      path.join(root, ".ragmir", "raw", "release-policy.md"),
      "The release workflow uses local approval, signed checksums, and a deployment deadline.\n",
      "utf8",
    )
    await writeFile(
      path.join(root, ".ragmir", "raw", "raw_files", "release-policy-copy.md"),
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
    const report = await research("release workflow approval checksums", {
      cwd: root,
      topK: 3,
      fullAudit: true,
    })

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
        relativePath: ".ragmir/raw/raw_files/release-policy-copy.md",
      }),
    ])

    const compact = compactResearchReport(report)
    expect(compact.evidence[0]).toHaveProperty("snippet")
    expect(compact.evidence[0]).not.toHaveProperty("text")
    expect(compactSearchResults(report.evidence)[0]?.snippet).toContain("release workflow")
  })

  it("should keep evidence order stable when expansion results arrive in a different order", () => {
    const primaryQuery = "release approval"
    const primary = {
      query: primaryQuery,
      results: [searchResult("beta.md", 0), searchResult("alpha.md", 0)],
    }
    const expansion = {
      query: "release approval validation",
      results: [searchResult("alpha.md", 0)],
    }

    const forward = rankResearchEvidence([primary, expansion], primaryQuery)
    const reversed = rankResearchEvidence([expansion, primary], primaryQuery)

    expect(forward.map((evidence) => evidence.relativePath)).toEqual(["alpha.md", "beta.md"])
    expect(reversed).toEqual(forward)
  })

  it("should preserve direct multilingual retrieval when research expands the query", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-research-multilingual-"))
    tempDirs.push(root)
    await initProject(root)
    await writeFile(
      path.join(root, ".ragmir", "raw", "retention-fr.md"),
      "La politique de conservation exige une durée de sept ans.\n",
    )
    await writeFile(
      path.join(root, ".ragmir", "raw", "retention-ja.md"),
      "保存方針では記録を七年間保持します。\n",
    )
    await ingest({ cwd: root })

    for (const query of ["politique conservation sept ans", "保存方針 七年間"]) {
      const direct = await search(query, { cwd: root, topK: 1 })
      const report = await research(query, { cwd: root, topK: 1, includeCode: false })

      expect(report.evidence[0]?.relativePath).toBe(direct[0]?.relativePath)
      expect(report.generatedQueries.join(" ")).not.toContain("scope requirements")
    }
  })

  it("should rank the best code hit when its path sorts after one hundred weaker matches", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-research-code-rank-"))
    tempDirs.push(root)
    await initProject(root)
    await writeFile(
      path.join(root, ".ragmir", "raw", "policy.md"),
      "Release workflow approval checksum evidence.\n",
    )
    await mkdir(path.join(root, "src"), { recursive: true })
    await Promise.all(
      Array.from({ length: 105 }, (_value, index) =>
        writeFile(
          path.join(root, "src", `a-${String(index).padStart(3, "0")}.ts`),
          "export const releaseWorkflow = 'routine control'\n",
        ),
      ),
    )
    await writeFile(
      path.join(root, "src", "z-best.ts"),
      "export const releaseWorkflowApprovalChecksum = 'strongest evidence'\n",
    )
    await ingest({ cwd: root })

    const report = await research("release workflow approval checksum", { cwd: root })

    expect(report.codeEvidence[0]?.relativePath).toBe("src/z-best.ts")
  })

  it("should report explicit scan and output budgets when research is bounded", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-research-budgets-"))
    tempDirs.push(root)
    await initProject(root)
    await writeFile(
      path.join(root, ".ragmir", "raw", "policy.md"),
      "Bounded release workflow evidence.\n",
    )
    await mkdir(path.join(root, "src"), { recursive: true })
    await Promise.all(
      Array.from({ length: 4 }, (_value, index) =>
        writeFile(
          path.join(root, "src", `evidence-${index}.ts`),
          "export const boundedReleaseWorkflow = true\n",
        ),
      ),
    )
    await ingest({ cwd: root })

    const report = await research("bounded release workflow", {
      cwd: root,
      timeoutMs: 10_000,
      topK: 1,
      codeTopK: 1,
      codeScanMaxFiles: 2,
      codeScanMaxBytes: 1_000,
      codeScanConcurrency: 2,
    })

    expect(report.audit).toMatchObject({ mode: "manifest", inventoryVerified: false })
    expect(report.evidence.length).toBeLessThanOrEqual(1)
    expect(report.codeEvidence.length).toBeLessThanOrEqual(1)
    expect(report.budgets).toMatchObject({
      timeoutMs: 10_000,
      evidenceTopK: 1,
      codeEvidenceTopK: 1,
      codeScanMaxFiles: 2,
      codeScanMaxBytes: 1_000,
      codeScanConcurrency: 2,
      codeFilesScanned: 2,
      codeScanTruncated: true,
    })
    expect(report.budgets.codeBytesScanned).toBeLessThanOrEqual(1_000)
  })

  it("should load one immutable index snapshot when query expansions run concurrently", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-research-snapshot-"))
    tempDirs.push(root)
    await initProject(root)
    await writeFile(
      path.join(root, ".ragmir", "raw", "policy.md"),
      "Release approval requires deterministic evidence.\n",
    )
    await ingest({ cwd: root })
    const diagnostics = { manifestReads: 0, tableOpens: 0 }
    const listener = (event: unknown): void => {
      if (!event || typeof event !== "object" || !("projectRoot" in event)) {
        return
      }
      if (event.projectRoot !== root || !("kind" in event)) {
        return
      }
      if (event.kind === "manifest-read") {
        diagnostics.manifestReads += 1
      } else if (event.kind === "table-open") {
        diagnostics.tableOpens += 1
      }
    }
    subscribe("ragmir:index-read", listener)
    try {
      await research("release approval evidence", { cwd: root, includeCode: false })
    } finally {
      unsubscribe("ragmir:index-read", listener)
    }

    expect(diagnostics).toEqual({ manifestReads: 1, tableOpens: 1 })
  })

  it("excludes secret-like files from the code scan and redacts secrets in snippets", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-research-secrets-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, "src"), { recursive: true })
    await writeFile(
      path.join(root, ".ragmir", "raw", "policy.md"),
      "The credential rotation secret handling policy.\n",
      "utf8",
    )
    await writeFile(
      path.join(root, "src", "config.ts"),
      "export const credentialSecret = 'sk-proj-0123456789abcdefghijklmnopqrstuvwxyz'\n",
      "utf8",
    )
    await writeFile(
      path.join(root, ".env.json"),
      JSON.stringify({ credentialSecret: "sk-proj-0123456789abcdefghijklmnopqrstuvwxyz" }),
      "utf8",
    )

    await ingest({ cwd: root })
    const report = await research("credential secret", { cwd: root })

    const scannedPaths = report.codeEvidence.map((entry) => entry.relativePath)
    expect(scannedPaths).toContain("src/config.ts")
    expect(scannedPaths).not.toContain(".env.json")
    for (const evidence of report.codeEvidence) {
      expect(evidence.snippet).not.toContain("sk-proj-0123456789abcdefghijklmnopqrstuvwxyz")
    }
  })

  it("disables repository-wide code scanning in strict privacy mode", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-research-strict-"))
    tempDirs.push(root)
    await initProject(root)
    await writeFile(
      path.join(root, ".ragmir", "config.json"),
      JSON.stringify({ privacyProfile: "strict" }),
    )
    await writeFile(
      path.join(root, ".ragmir", "raw", "policy.md"),
      "Strict local policy evidence.\n",
    )
    await mkdir(path.join(root, "src"), { recursive: true })
    await writeFile(path.join(root, "src", "outside.ts"), "export const strictLocalPolicy = true\n")
    await ingest({ cwd: root })

    const report = await research("strict local policy", { cwd: root, includeCode: true })

    expect(report.evidence.length).toBeGreaterThan(0)
    expect(report.codeEvidence).toEqual([])
  })
})

function searchResult(relativePath: string, chunkIndex: number): SearchResult {
  return {
    source: relativePath,
    relativePath,
    chunkIndex,
    contextPath: "",
    citation: `${relativePath}:L1-L1#${chunkIndex}`,
    text: `${relativePath} evidence`,
    distance: 0.5,
    charStart: 0,
    charEnd: 10,
    lineStart: 1,
    lineEnd: 1,
    pageStart: null,
    pageEnd: null,
    locationKind: null,
    locationStart: null,
    locationEnd: null,
    locationLabel: null,
    cellStart: null,
    cellEnd: null,
    context: [],
  }
}
