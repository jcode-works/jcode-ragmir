import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { loadConfig } from "./config.js"
import { indexPolicyFingerprint } from "./index-policy.js"
import { audit, ingest } from "./ingest.js"
import { initProject } from "./init.js"
import { openRowsTable, readIndexManifest } from "./store.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("ingest", () => {
  it("reports skipped files and detects stale indexed content by checksum", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-ingest-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await writeFile(path.join(root, ".ragmir", "raw", "evidence.md"), "First version.\n", "utf8")
    await writeFile(path.join(root, ".ragmir", "raw", "scan.heic"), "unsupported image\n", "utf8")

    const result = await ingest({ cwd: root })
    expect(result.discoveredFiles).toBe(2)
    expect(result.supportedFiles).toBe(1)
    expect(result.supportedBytes).toBeGreaterThan(0)
    expect(result.largestFileBytes).toBeGreaterThan(0)
    expect(result.rebuiltFiles).toBe(1)
    expect(result.reusedFiles).toBe(0)
    expect(result.unsupportedFiles).toBe(1)
    expect(result.emptyTextFiles).toEqual([])
    expect(result.unsupportedExtensions).toEqual([{ extension: ".heic", count: 1 }])

    await writeFile(path.join(root, ".ragmir", "raw", "evidence.md"), "Changed version.\n", "utf8")
    const report = await audit(root)

    expect(report.missingFromIndex).toEqual([])
    expect(report.discoveredFiles).toBe(2)
    expect(report.supportedBytes).toBeGreaterThan(0)
    expect(report.largestFileBytes).toBeGreaterThan(0)
    expect(report.staleInIndex).toEqual([".ragmir/raw/evidence.md"])
    expect(report.chunkStats.count).toBe(1)
    expect(report.chunkStats.minChars).toBeGreaterThan(0)
    expect(report.chunkStats.p95Chars).toBe(report.chunkStats.maxChars)
    expect(report.chunkStats.contextualRatio).toBe(0)
    expect(report.skippedFiles).toEqual([
      expect.objectContaining({
        relativePath: ".ragmir/raw/scan.heic",
        reason: "unsupported-extension",
      }),
    ])
  })

  it("reuses unchanged indexed rows during incremental ingest", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-ingest-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await writeFile(path.join(root, ".ragmir", "raw", "alpha.md"), "Alpha evidence.\n", "utf8")
    await writeFile(path.join(root, ".ragmir", "raw", "beta.md"), "Beta evidence.\n", "utf8")

    const first = await ingest({ cwd: root })
    await writeFile(
      path.join(root, ".ragmir", "raw", "beta.md"),
      "Changed beta evidence.\n",
      "utf8",
    )
    const second = await ingest({ cwd: root })

    expect(first.indexedFiles).toBe(2)
    expect(second.indexedFiles).toBe(2)
    expect(second.rebuiltFiles).toBe(1)
    expect(second.reusedFiles).toBe(1)
  })

  it("writes an index manifest after ingest and reports a null vectorIndexWarning", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-manifest-write-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await writeFile(path.join(root, ".ragmir", "raw", "alpha.md"), "Alpha evidence.\n", "utf8")

    const result = await ingest({ cwd: root })

    expect(result.vectorIndexWarning).toBeNull()
    expect(result.lexicalIndexWarning).toBeNull()
    const manifest = await readIndexManifest(await loadConfig(root))
    expect(manifest).not.toBeNull()
    expect(manifest?.embeddingProvider).toBe("local-hash")
    expect(manifest?.schemaVersion).toBe(7)
    expect(manifest?.indexPolicyFingerprint).toBe(indexPolicyFingerprint(await loadConfig(root)))
    expect(manifest?.vectorDimension).toBeGreaterThan(0)
    expect(manifest?.vectorDistanceMetric).toBe("l2")
    expect(manifest?.chunkCount).toBe(result.chunks)
  })

  it("does not create a LanceDB version for a no-op ingest", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-noop-ingest-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await writeFile(path.join(root, ".ragmir", "raw", "alpha.md"), "Alpha evidence.\n")
    await ingest({ cwd: root })
    const config = await loadConfig(root)
    const table = await openRowsTable(config)
    const versionBefore = await table?.version()

    const result = await ingest({ cwd: root })
    const versionAfter = await (await openRowsTable(config))?.version()

    expect(result.rebuiltFiles).toBe(0)
    expect(result.reusedFiles).toBe(1)
    expect(versionAfter).toBe(versionBefore)
  })

  it("rebuilds every file when the content policy changes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-policy-rebuild-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await writeFile(path.join(root, ".ragmir", "raw", "alpha.md"), "Contact user@example.test.\n")
    await ingest({ cwd: root })
    await writeFile(
      path.join(root, ".ragmir", "config.json"),
      JSON.stringify({ redaction: { enabled: false } }),
    )

    const result = await ingest({ cwd: root })

    expect(result.policyRebuild).toBe(true)
    expect(result.rebuiltFiles).toBe(1)
    expect(result.reusedFiles).toBe(0)
  })

  it("forces a full re-index of every file when rebuild is requested", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-rebuild-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await writeFile(path.join(root, ".ragmir", "raw", "alpha.md"), "Alpha evidence.\n", "utf8")
    await writeFile(path.join(root, ".ragmir", "raw", "beta.md"), "Beta evidence.\n", "utf8")

    // First ingest indexes both files.
    await ingest({ cwd: root })
    // A normal second ingest would reuse both; rebuild must re-index all of them.
    const rebuilt = await ingest({ cwd: root, rebuild: true })

    expect(rebuilt.indexedFiles).toBe(2)
    expect(rebuilt.rebuiltFiles).toBe(2)
    expect(rebuilt.reusedFiles).toBe(0)
  })

  it("reports supported files that produce no indexable text", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-empty-text-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await writeFile(path.join(root, ".ragmir", "raw", "scan.pdf"), createBlankPdf())

    const result = await ingest({ cwd: root })

    expect(result.discoveredFiles).toBe(1)
    expect(result.supportedFiles).toBe(1)
    expect(result.indexedFiles).toBe(0)
    expect(result.chunks).toBe(0)
    expect(result.skippedFiles).toBe(1)
    expect(result.emptyTextFiles).toEqual([".ragmir/raw/scan.pdf"])

    const report = await audit(root)
    expect(report.emptyTextFiles).toEqual([".ragmir/raw/scan.pdf"])
    expect(report.missingFromIndex).toEqual([])
  })

  it("reports duplicate and mirror-like source diagnostics", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-source-diagnostics-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw", "raw_files"), { recursive: true })
    await writeFile(
      path.join(root, ".ragmir", "raw", "decision.md"),
      "Canonical evidence.\n",
      "utf8",
    )
    await writeFile(
      path.join(root, ".ragmir", "raw", "raw_files", "decision-copy.md"),
      "Canonical evidence.\n",
      "utf8",
    )

    await ingest({ cwd: root })
    const report = await audit(root)

    expect(report.sourceDiagnostics.duplicateCandidates).toEqual([
      expect.objectContaining({
        files: [".ragmir/raw/decision.md", ".ragmir/raw/raw_files/decision-copy.md"],
      }),
    ])
    expect(report.sourceDiagnostics.mirrorCandidates).toEqual([
      expect.objectContaining({
        relativePath: ".ragmir/raw/raw_files/decision-copy.md",
      }),
    ])
  })

  it("does not report files with the same basename and different content as duplicates", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-source-diagnostics-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw", "nested"), { recursive: true })
    await writeFile(path.join(root, ".ragmir", "raw", "README.md"), "First source.\n", "utf8")
    await writeFile(
      path.join(root, ".ragmir", "raw", "nested", "README.md"),
      "Second source with different evidence.\n",
      "utf8",
    )

    await ingest({ cwd: root })
    const report = await audit(root)

    expect(report.sourceDiagnostics.duplicateCandidates).toEqual([])
  })
})

function createBlankPdf(): string {
  return `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>
endobj
xref
0 4
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
trailer
<< /Size 4 /Root 1 0 R >>
startxref
190
%%EOF`
}
