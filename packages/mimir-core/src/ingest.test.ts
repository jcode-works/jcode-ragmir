import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { audit, ingest } from "./ingest.js"
import { initProject } from "./init.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("ingest", () => {
  it("reports skipped files and detects stale indexed content by checksum", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mimir-ingest-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".mimir", "raw"), { recursive: true })
    await writeFile(path.join(root, ".mimir", "raw", "evidence.md"), "First version.\n", "utf8")
    await writeFile(path.join(root, ".mimir", "raw", "scan.heic"), "unsupported image\n", "utf8")

    const result = await ingest({ cwd: root })
    expect(result.discoveredFiles).toBe(2)
    expect(result.supportedFiles).toBe(1)
    expect(result.rebuiltFiles).toBe(1)
    expect(result.reusedFiles).toBe(0)
    expect(result.unsupportedFiles).toBe(1)
    expect(result.emptyTextFiles).toEqual([])
    expect(result.unsupportedExtensions).toEqual([{ extension: ".heic", count: 1 }])

    await writeFile(path.join(root, ".mimir", "raw", "evidence.md"), "Changed version.\n", "utf8")
    const report = await audit(root)

    expect(report.missingFromIndex).toEqual([])
    expect(report.staleInIndex).toEqual([".mimir/raw/evidence.md"])
    expect(report.skippedFiles).toEqual([
      expect.objectContaining({
        relativePath: ".mimir/raw/scan.heic",
        reason: "unsupported-extension",
      }),
    ])
  })

  it("reuses unchanged indexed rows during incremental ingest", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mimir-ingest-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".mimir", "raw"), { recursive: true })
    await writeFile(path.join(root, ".mimir", "raw", "alpha.md"), "Alpha evidence.\n", "utf8")
    await writeFile(path.join(root, ".mimir", "raw", "beta.md"), "Beta evidence.\n", "utf8")

    const first = await ingest({ cwd: root })
    await writeFile(path.join(root, ".mimir", "raw", "beta.md"), "Changed beta evidence.\n", "utf8")
    const second = await ingest({ cwd: root })

    expect(first.indexedFiles).toBe(2)
    expect(second.indexedFiles).toBe(2)
    expect(second.rebuiltFiles).toBe(1)
    expect(second.reusedFiles).toBe(1)
  })

  it("reports supported files that produce no indexable text", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mimir-empty-text-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".mimir", "raw"), { recursive: true })
    await writeFile(path.join(root, ".mimir", "raw", "scan.pdf"), createBlankPdf())

    const result = await ingest({ cwd: root })

    expect(result.discoveredFiles).toBe(1)
    expect(result.supportedFiles).toBe(1)
    expect(result.indexedFiles).toBe(0)
    expect(result.chunks).toBe(0)
    expect(result.skippedFiles).toBe(1)
    expect(result.emptyTextFiles).toEqual([".mimir/raw/scan.pdf"])

    const report = await audit(root)
    expect(report.emptyTextFiles).toEqual([".mimir/raw/scan.pdf"])
    expect(report.missingFromIndex).toEqual([])
  })

  it("reports duplicate and mirror-like source diagnostics", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mimir-source-diagnostics-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".mimir", "raw", "raw_files"), { recursive: true })
    await writeFile(
      path.join(root, ".mimir", "raw", "decision.md"),
      "Canonical evidence.\n",
      "utf8",
    )
    await writeFile(
      path.join(root, ".mimir", "raw", "raw_files", "decision-copy.md"),
      "Canonical evidence.\n",
      "utf8",
    )

    await ingest({ cwd: root })
    const report = await audit(root)

    expect(report.sourceDiagnostics.duplicateCandidates).toEqual([
      expect.objectContaining({
        files: [".mimir/raw/decision.md", ".mimir/raw/raw_files/decision-copy.md"],
      }),
    ])
    expect(report.sourceDiagnostics.mirrorCandidates).toEqual([
      expect.objectContaining({
        relativePath: ".mimir/raw/raw_files/decision-copy.md",
      }),
    ])
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
