import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import type { RagmirError } from "./errors.js"
import { ingest } from "./ingest.js"
import { initProject } from "./init.js"
import { ask, expandCitation, search, vectorCandidateLimit } from "./query.js"

const tempDirs: string[] = []
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("search", () => {
  it("should release generation leases after search and citation expansion", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-query-generation-lease-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await writeFile(path.join(root, ".ragmir", "raw", "policy.md"), "Policy evidence.\n")
    await ingest({ cwd: root })

    const [result] = await search("policy evidence", { cwd: root })
    expect(result).toBeDefined()
    if (!result) {
      return
    }
    await expandCitation(result.citation, { cwd: root })

    await expect(
      readdir(path.join(root, ".ragmir", "storage", "generation-leases")),
    ).resolves.toEqual([])
  })

  it("should reject invalid numeric options at the library boundary", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-query-options-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await writeFile(path.join(root, ".ragmir", "raw", "policy.md"), "Policy evidence.\n")
    await ingest({ cwd: root })

    for (const topK of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(search("policy", { cwd: root, topK })).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: "topK must be a positive integer.",
      } satisfies Partial<RagmirError>)
    }
    for (const contextRadius of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(search("policy", { cwd: root, contextRadius })).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: "contextRadius must be a non-negative integer.",
      } satisfies Partial<RagmirError>)
    }
  })

  it("keeps a broad vector candidate pool for small result sets", () => {
    expect(vectorCandidateLimit(1)).toBe(80)
    expect(vectorCandidateLimit(5)).toBe(80)
    expect(vectorCandidateLimit(25)).toBe(100)
    expect(vectorCandidateLimit(1, "fast")).toBe(40)
    expect(vectorCandidateLimit(1, "quality")).toBe(200)
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
    expect(results[0]?.citation).toContain(".ragmir/raw/security-policy.md:L1-")
    expect(results[0]?.lineStart).toBe(1)
  })

  it("filters retrieval by included and excluded source path prefixes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-query-path-filter-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw", "primary"), { recursive: true })
    await mkdir(path.join(root, ".ragmir", "raw", "research"), { recursive: true })
    await writeFile(
      path.join(root, ".ragmir", "raw", "primary", "report.md"),
      "The primary report records the verified evidence.\n",
      "utf8",
    )
    await writeFile(
      path.join(root, ".ragmir", "raw", "research", "review.md"),
      "The literature review discusses the verified evidence.\n",
      "utf8",
    )
    await ingest({ cwd: root })

    const primary = await search("verified evidence", {
      cwd: root,
      includePaths: [".ragmir/raw/primary"],
    })
    const withoutResearch = await search("verified evidence", {
      cwd: root,
      excludePaths: [".ragmir/raw/research"],
    })

    expect(primary.map((result) => result.relativePath)).toEqual([".ragmir/raw/primary/report.md"])
    expect(withoutResearch.every((result) => !result.relativePath.includes("/research/"))).toBe(
      true,
    )
  })

  it("should filter retrieval by structural context prefixes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-query-context-filter-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await writeFile(
      path.join(root, ".ragmir", "raw", "runbook.md"),
      [
        "# Operations",
        "",
        "## Release",
        "The verified control evidence belongs to the active release workflow.",
        "",
        "## Archive",
        "The verified control evidence belongs to the archived workflow.",
      ].join("\n"),
      "utf8",
    )
    await ingest({ cwd: root })

    const results = await search("verified control evidence", {
      cwd: root,
      contextPaths: ["Operations > Archive"],
    })

    expect(results.length).toBeGreaterThan(0)
    expect(results.every((result) => result.contextPath === "Operations > Archive")).toBe(true)
    expect(results.every((result) => result.text.includes("archived workflow"))).toBe(true)
  })

  it("should keep root and app indexes isolated in a monorepo", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-query-monorepo-"))
    tempDirs.push(root)
    const app = path.join(root, "apps", "checkout")
    const appSource = path.join(app, "src")
    await initProject(root)
    await initProject(app)
    await mkdir(appSource, { recursive: true })
    await writeFile(
      path.join(root, ".ragmir", "raw", "architecture.md"),
      "Root atlasproof describes the shared monorepo architecture.\n",
      "utf8",
    )
    await writeFile(
      path.join(app, ".ragmir", "raw", "payments.md"),
      "Checkout vaultproof describes the isolated payment workflow.\n",
      "utf8",
    )
    await ingest({ cwd: root })
    await ingest({ cwd: app })

    const rootResults = await search("atlasproof architecture", { cwd: root })
    const appResults = await search("vaultproof payment", { cwd: appSource })
    const rootLeak = await search("vaultproof", { cwd: root })
    const appLeak = await search("atlasproof", { cwd: appSource })

    expect(rootResults[0]?.text).toContain("atlasproof")
    expect(appResults[0]?.text).toContain("vaultproof")
    expect(rootLeak).toEqual([])
    expect(appLeak).toEqual([])
  })

  it("should explain hybrid retrieval without changing the default result shape", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-query-explain-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await writeFile(
      path.join(root, ".ragmir", "raw", "security.md"),
      "Token rotation requires signed source-control evidence.\n",
      "utf8",
    )
    await writeFile(
      path.join(root, ".ragmir", "raw", "facilities.md"),
      "Facilities planning covers staffing and maintenance.\n",
      "utf8",
    )
    await ingest({ cwd: root })

    const plain = await search("token rotation evidence", { cwd: root, topK: 1 })
    const explained = await search("token rotation evidence", { cwd: root, topK: 1, explain: true })
    const score = explained[0]?.score

    expect(plain[0]).not.toHaveProperty("score")
    expect(explained[0]?.relativePath).toBe(plain[0]?.relativePath)
    expect(score?.fusion).toBe("rrf")
    expect(score?.combinedScore).toBeCloseTo(
      (score?.vectorContribution ?? 0) + (score?.lexicalContribution ?? 0),
    )
    expect(score?.vectorRank).toBeGreaterThan(0)
    expect(score?.lexicalRank).toBeGreaterThan(0)
    expect(score?.vectorDistance).toBe(explained[0]?.distance)
    expect(score?.lexicalBackendScore).toBeGreaterThan(0)
    expect(score?.matchedTerms).toEqual(expect.arrayContaining(["token", "rotation", "evidence"]))
  })

  it("uses the full-text lexical index when the fallback scan limit is narrow", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-query-fts-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await writeFile(
      path.join(root, ".ragmir", "config.json"),
      JSON.stringify({ hybridTextScanLimit: 1, topK: 1 }),
      "utf8",
    )
    await writeFile(
      path.join(root, ".ragmir", "raw", "alpha.md"),
      "Routine planning notes with no target keyword.\n",
      "utf8",
    )
    await writeFile(
      path.join(root, ".ragmir", "raw", "zeta.md"),
      "The zanzibar-token policy is the authoritative retention proof.\n",
      "utf8",
    )

    await ingest({ cwd: root })
    const results = await search("zanzibar-token retention proof", { cwd: root, topK: 1 })

    expect(results[0]?.relativePath).toBe(".ragmir/raw/zeta.md")
  })

  it("should retrieve later Markdown chunks through their heading context", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-query-markdown-context-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await writeFile(
      path.join(root, ".ragmir", "config.json"),
      JSON.stringify({ chunkSize: 90, chunkOverlap: 10, topK: 4 }),
      "utf8",
    )
    await writeFile(
      path.join(root, ".ragmir", "raw", "guide.md"),
      [
        "# Operations",
        "",
        "## Zephyr authorization",
        "The first paragraph describes the ordinary workflow with neutral wording repeated here.",
        "",
        "The second paragraph contains consequences but deliberately omits the section title.",
      ].join("\n"),
      "utf8",
    )

    await ingest({ cwd: root })
    const results = await search("zephyr authorization", { cwd: root, topK: 4 })

    expect(
      results.some((result) => result.contextPath === "Operations > Zephyr authorization"),
    ).toBe(true)
    expect(
      results.some(
        (result) =>
          !result.text.toLowerCase().includes("zephyr") &&
          result.contextPath.includes("Zephyr authorization"),
      ),
    ).toBe(true)
  })

  it("should retrieve JSON values through their JSONPath without exposing it as text", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-query-json-context-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await writeFile(
      path.join(root, ".ragmir", "config.json"),
      JSON.stringify({ chunkSize: 55, chunkOverlap: 0, topK: 3 }),
      "utf8",
    )
    await writeFile(
      path.join(root, ".ragmir", "raw", "controls.json"),
      JSON.stringify(
        {
          compliance: {
            owner: "alice",
            description: "A neutral control description that is long enough to split the object.",
          },
          operations: { owner: "bob" },
        },
        null,
        2,
      ),
      "utf8",
    )

    await ingest({ cwd: root })
    const results = await search("compliance", { cwd: root, topK: 3 })
    const nested = results.find(
      (result) =>
        result.contextPath.startsWith("$.compliance") && !result.text.includes("compliance"),
    )

    expect(nested?.relativePath).toBe(".ragmir/raw/controls.json")
    expect(nested?.contextPath).toContain("$.compliance")
  })

  it("matches accent-folded lexical queries", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-query-accent-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await writeFile(
      path.join(root, ".ragmir", "raw", "policy.md"),
      "La confidentialité exige une révision régulière.\n",
      "utf8",
    )
    await ingest({ cwd: root })

    const results = await search("confidentialite revision", { cwd: root, topK: 1 })

    expect(results[0]?.relativePath).toBe(".ragmir/raw/policy.md")
  })

  it("should recover a single-token transposition without matching a nearby wrong word", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-query-typo-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await writeFile(
      path.join(root, ".ragmir", "raw", "security.md"),
      "Security controls require signed evidence.\n",
      "utf8",
    )
    await ingest({ cwd: root })

    const typo = await search("sceurity", { cwd: root, topK: 1 })
    const wrongWord = await search("secretary", { cwd: root, topK: 1 })

    expect(typo[0]?.relativePath).toBe(".ragmir/raw/security.md")
    expect(wrongWord).toEqual([])
  })

  it("blocks search when the active index policy differs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-query-policy-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await writeFile(path.join(root, ".ragmir", "raw", "policy.md"), "Policy evidence.\n")
    await ingest({ cwd: root })
    await writeFile(
      path.join(root, ".ragmir", "config.json"),
      JSON.stringify({ chunkSize: 900, chunkOverlap: 100 }),
    )

    await expect(search("policy", { cwd: root })).rejects.toThrow("Rebuild")
    await expect(expandCitation(".ragmir/raw/policy.md:L1-L1#0", { cwd: root })).rejects.toThrow(
      "Rebuild",
    )
  })

  it("abstains when local-hash retrieval has no lexical evidence", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-query-abstain-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await writeFile(path.join(root, ".ragmir", "raw", "policy.md"), "Retention policy evidence.\n")
    await ingest({ cwd: root })

    await expect(search("quantum banana volcano", { cwd: root })).resolves.toEqual([])
    await expect(search("x", { cwd: root })).resolves.toEqual([])
  })

  it("retrieves distinct French, English, Thai, and Chinese evidence", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-query-multilingual-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    const documents = [
      ["fr.md", "La politique de confidentialité impose un stockage local chiffré.\n"],
      ["en.md", "The deployment checklist requires signed release checksums.\n"],
      ["th.md", "เอกสารลับต้องจัดเก็บไว้ในเครื่องที่เข้ารหัสเท่านั้น\n"],
      ["zh.md", "机密文档必须存储在加密的本地设备上。\n"],
    ]
    for (const [filename, content] of documents) {
      await writeFile(path.join(root, ".ragmir", "raw", filename ?? ""), content ?? "")
    }
    await ingest({ cwd: root })

    const queries = [
      ["stockage local chiffré", "fr.md"],
      ["signed release checksums", "en.md"],
      ["เอกสารลับจัดเก็บในเครื่องเข้ารหัส", "th.md"],
      ["机密文档存储加密本地设备", "zh.md"],
    ]
    for (const [query, expected] of queries) {
      const results = await search(query ?? "", { cwd: root, topK: 1 })
      expect(results[0]?.relativePath).toBe(`.ragmir/raw/${expected}`)
    }
  })

  it("hydrates neighboring context chunks when requested", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-query-context-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await writeFile(
      path.join(root, ".ragmir", "config.json"),
      JSON.stringify({ chunkSize: 36, chunkOverlap: 0, topK: 1 }),
      "utf8",
    )
    await writeFile(
      path.join(root, ".ragmir", "raw", "context.md"),
      [
        "Opening operational note.",
        "",
        "Rare needle evidence belongs here.",
        "",
        "Closing consequence line.",
      ].join("\n"),
      "utf8",
    )

    await ingest({ cwd: root })
    const results = await search("rare needle evidence", { cwd: root, topK: 1, contextRadius: 1 })

    expect(results[0]?.relativePath).toBe(".ragmir/raw/context.md")
    expect(results[0]?.context.length).toBeGreaterThanOrEqual(2)
    expect(results[0]?.context.some((chunk) => chunk.text.includes("Opening"))).toBe(true)
    expect(results[0]?.context.some((chunk) => chunk.text.includes("Rare needle"))).toBe(true)
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
    const ttsEvidence = await search("What proves offline text-to-speech is required?", {
      cwd: root,
      topK: 5,
    })
    expect(
      ttsEvidence.filter((result) => result.relativePath === "raw/review-notes.evidence"),
    ).toHaveLength(1)
    expect(
      ttsEvidence.some((result) => result.relativePath === "raw/incident-timeline.jsonl"),
    ).toBe(true)
    await expectAnyResult(root, "Who owns the usage review?", [
      "raw/operations-brief.md",
      "raw/security-policy.yaml",
      "raw/review-notes.evidence",
    ])
  })

  it("returns page-aware citations for PDF evidence", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-query-pdf-page-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await writeFile(path.join(root, ".ragmir", "raw", "brief.pdf"), createSearchPdf())
    await ingest({ cwd: root })

    const results = await search("page aware confidential evidence", { cwd: root, topK: 1 })

    expect(results[0]?.pageStart).toBe(1)
    expect(results[0]?.pageEnd).toBe(1)
    expect(results[0]?.citation).toContain("brief.pdf:p1#")
    expect(results[0]?.lineStart).toBeNull()
    expect(results[0]?.lineEnd).toBeNull()

    const expanded = await expandCitation(results[0]?.citation ?? "", { cwd: root })
    expect(expanded.found).toBe(true)
    expect(expanded.passages[0]?.pageStart).toBe(1)
  })
})

describe("expandCitation", () => {
  it("should return the exact indexed passage and bounded neighbors when a citation is valid", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-expand-"))
    tempDirs.push(root)
    await initProject(root)
    await writeFile(
      path.join(root, ".ragmir", "config.json"),
      JSON.stringify({ chunkSize: 36, chunkOverlap: 0, topK: 1 }),
      "utf8",
    )
    await writeFile(
      path.join(root, ".ragmir", "raw", "policy's.md"),
      [
        "Opening operational note.",
        "Rare expansion target evidence.",
        "Closing consequence line.",
      ].join("\n\n"),
      "utf8",
    )
    await ingest({ cwd: root })
    const [result] = await search("expansion target evidence", { cwd: root, topK: 1 })

    const expanded = await expandCitation(result?.citation ?? "", { cwd: root, contextRadius: 20 })

    expect(expanded.found).toBe(true)
    expect(expanded.relativePath).toBe(".ragmir/raw/policy's.md")
    expect(expanded.contextRadius).toBe(3)
    expect(expanded.passages.some((passage) => passage.chunkIndex === result?.chunkIndex)).toBe(
      true,
    )

    const forgedCitation = (result?.citation ?? "").replace(/:L\d+-L\d+#/u, ":L999-L1000#")
    await expect(expandCitation(forgedCitation, { cwd: root })).rejects.toThrow(
      "do not match the indexed passage",
    )
  })

  it("should return no passages when the cited chunk does not exist", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-expand-missing-"))
    tempDirs.push(root)
    await initProject(root)

    await expect(expandCitation(".ragmir/raw/missing.md:L1-L1#4", { cwd: root })).resolves.toEqual({
      requestedCitation: ".ragmir/raw/missing.md:L1-L1#4",
      found: false,
      relativePath: ".ragmir/raw/missing.md",
      chunkIndex: 4,
      contextRadius: 0,
      passages: [],
    })
  })

  it("should reject malformed citation input", async () => {
    await expect(expandCitation("raw/policy.md:L1-L2")).rejects.toThrow("chunk suffix")
  })
})

describe("ask", () => {
  it("returns a no-evidence message when the index is empty", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-ask-empty-"))
    tempDirs.push(root)
    await initProject(root)

    const result = await ask("anything", { cwd: root })

    expect(result.sources).toEqual([])
    expect(result.answer).toContain("No relevant passages")
  })

  it("returns cited retrieval context when evidence is found", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-ask-"))
    tempDirs.push(root)
    await initProject(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await writeFile(
      path.join(root, ".ragmir", "raw", "policy.md"),
      "Tokens must be rotated every 30 days and kept out of source control.\n",
      "utf8",
    )
    await ingest({ cwd: root })

    const result = await ask("token rotation", { cwd: root, topK: 1 })

    expect(result.sources).toHaveLength(1)
    expect(result.answer).toContain("retrieval context only")
    expect(result.answer).toContain("[1]")
    expect(result.answer).toContain("policy.md:L1-")
    expect(result.staleWarning).toBeNull()
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

function createSearchPdf(): string {
  const content = "BT /F1 18 Tf 72 720 Td (Page aware confidential evidence) Tj ET"
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ]
  let pdf = "%PDF-1.4\n"
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xrefOffset = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")
  return `${pdf}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
}
