import { existsSync } from "node:fs"
import { mkdir, mkdtemp, open, rm, stat, utimes, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  discoverSourceFiles,
  inventorySourceFiles,
  listSourceFiles,
  sourceRuleDiagnostics,
} from "./files.js"
import { isCaseInsensitiveFileSystem } from "./source-paths.js"
import { testConfig } from "./test-support/config.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("listSourceFiles", () => {
  it("should stop source discovery when the signal is already aborted", async () => {
    const controller = new AbortController()
    controller.abort("cancelled by caller")

    await expect(
      listSourceFiles(testConfig(process.cwd()), { signal: controller.signal }),
    ).rejects.toMatchObject({ code: "ABORTED", retryable: true })
  })

  it("should interrupt source inventory while hashing a large file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-files-abort-"))
    tempDirs.push(root)
    const rawDir = path.join(root, ".ragmir", "raw")
    await mkdir(rawDir, { recursive: true })
    const largeFile = await open(path.join(rawDir, "large.md"), "w")
    try {
      await largeFile.truncate(512 * 1024 * 1024)
    } finally {
      await largeFile.close()
    }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort("cancelled while hashing"), 25)

    try {
      await expect(
        inventorySourceFiles(testConfig(root, { maxFileBytes: 1024 * 1024 * 1024 }), {
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({ code: "ABORTED", retryable: true })
    } finally {
      clearTimeout(timeout)
    }
  })

  it("indexes broad text-like formats and custom extensions while ignoring runtime folders", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-files-"))
    tempDirs.push(root)

    await mkdir(path.join(root, ".ragmir", "raw", "nested"), { recursive: true })
    await mkdir(path.join(root, ".ragmir", "raw", ".kb"), { recursive: true })
    await mkdir(path.join(root, ".ragmir", "raw", ".ragmir"), { recursive: true })
    await mkdir(path.join(root, ".ragmir", "raw", ".mvn", "wrapper"), { recursive: true })
    await mkdir(path.join(root, ".ragmir", "raw", ".vscode"), { recursive: true })
    await writeFile(path.join(root, ".ragmir", "raw", ".env"), "SECRET=hidden\n", "utf8")
    await writeFile(path.join(root, ".ragmir", "raw", ".gitignore"), "node_modules/\n", "utf8")
    await writeFile(path.join(root, ".ragmir", "raw", ".gitkeep"), "", "utf8")
    await writeFile(path.join(root, ".ragmir", "raw", ".gitlab-ci.yml"), "stages: [test]\n", "utf8")
    await writeFile(
      path.join(root, ".ragmir", "raw", ".mvn", "wrapper", "maven-wrapper.properties"),
      "distributionUrl=https://example.invalid/maven.zip\n",
      "utf8",
    )
    await writeFile(
      path.join(root, ".ragmir", "raw", ".vscode", "settings.json"),
      '{"editor.tabSize":2}\n',
      "utf8",
    )
    await writeFile(
      path.join(root, ".ragmir", "raw", "events.jsonl"),
      '{"event":"login"}\n',
      "utf8",
    )
    await writeFile(path.join(root, ".ragmir", "raw", "example.bat"), "echo evidence\n", "utf8")
    await writeFile(path.join(root, ".ragmir", "raw", "example.cmd"), "echo evidence\n", "utf8")
    await writeFile(path.join(root, ".ragmir", "raw", "schema.sql"), "select 1;\n", "utf8")
    await writeFile(path.join(root, ".ragmir", "raw", "settings.example"), "name=value\n", "utf8")
    await writeFile(path.join(root, ".ragmir", "raw", "settings.exemple"), "name=value\n", "utf8")
    await writeFile(
      path.join(root, ".ragmir", "raw", "component.vue"),
      "<template>Evidence</template>\n",
      "utf8",
    )
    await writeFile(
      path.join(root, ".ragmir", "raw", "loader.mjs"),
      "export const evidence = true\n",
      "utf8",
    )
    await writeFile(path.join(root, ".ragmir", "raw", "mvnw"), "#!/bin/sh\n", "utf8")
    await writeFile(path.join(root, ".ragmir", "raw", "sequence.mmd"), "sequenceDiagram\n", "utf8")
    await writeFile(
      path.join(root, ".ragmir", "raw", "captions.vtt"),
      "WEBVTT\n\nEvidence\n",
      "utf8",
    )
    await writeFile(path.join(root, ".ragmir", "raw", "notes.transcript"), "call notes\n", "utf8")
    await writeFile(path.join(root, ".ragmir", "raw", "README.md"), "generated helper\n", "utf8")
    await writeFile(path.join(root, ".ragmir", "raw", "image.png"), "not indexed\n", "utf8")
    await writeFile(path.join(root, ".ragmir", "raw", "legacy.doc"), "not indexed\n", "utf8")
    await writeFile(path.join(root, ".ragmir", "raw", "legacy.xls"), "not indexed\n", "utf8")
    await writeFile(path.join(root, ".ragmir", "raw", "private.pem"), "not indexed\n", "utf8")
    await writeFile(path.join(root, ".ragmir", "raw", ".kb", "index.md"), "ignored\n", "utf8")
    await writeFile(path.join(root, ".ragmir", "raw", ".ragmir", "agent.md"), "ignored\n", "utf8")

    const files = await listSourceFiles(testConfig(root, { includeExtensions: [".transcript"] }))

    expect(files.map((file) => file.relativePath)).toEqual([
      ".ragmir/raw/.gitignore",
      ".ragmir/raw/.gitlab-ci.yml",
      ".ragmir/raw/.mvn/wrapper/maven-wrapper.properties",
      ".ragmir/raw/.vscode/settings.json",
      ".ragmir/raw/captions.vtt",
      ".ragmir/raw/component.vue",
      ".ragmir/raw/events.jsonl",
      ".ragmir/raw/example.bat",
      ".ragmir/raw/example.cmd",
      ".ragmir/raw/loader.mjs",
      ".ragmir/raw/mvnw",
      ".ragmir/raw/notes.transcript",
      ".ragmir/raw/schema.sql",
      ".ragmir/raw/sequence.mmd",
      ".ragmir/raw/settings.example",
      ".ragmir/raw/settings.exemple",
    ])

    const inventory = await inventorySourceFiles(
      testConfig(root, { includeExtensions: [".transcript"], maxFileBytes: 20 }),
    )

    expect(inventory.skippedFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relativePath: ".ragmir/raw/.env",
          reason: "sensitive-name",
          recommendation:
            "Review manually; secret-like files are skipped to avoid indexing credentials or private keys.",
        }),
        expect.objectContaining({
          relativePath: ".ragmir/raw/.gitkeep",
          reason: "unsupported-extension",
        }),
        expect.objectContaining({
          relativePath: ".ragmir/raw/image.png",
          reason: "unsupported-extension",
          recommendation:
            "Configure imageOcrCommand for local image OCR, save extracted text as a supported text file, or convert to an OCRed PDF before ingesting.",
        }),
        expect.objectContaining({
          relativePath: ".ragmir/raw/legacy.doc",
          reason: "unsupported-extension",
          recommendation:
            "Configure legacyWordCommand for local legacy Word extraction, or convert to DOCX, PDF, HTML, or text before ingesting.",
        }),
        expect.objectContaining({
          relativePath: ".ragmir/raw/legacy.xls",
          reason: "unsupported-extension",
          recommendation:
            "Convert legacy XLS workbooks to XLSX, CSV, PDF, HTML, or text before ingesting.",
        }),
        expect.objectContaining({
          relativePath: ".ragmir/raw/private.pem",
          reason: "sensitive-name",
          recommendation:
            "Review manually; secret-like files are skipped to avoid indexing credentials or private keys.",
        }),
        expect.objectContaining({
          relativePath: ".ragmir/raw/component.vue",
          reason: "oversized",
          recommendation:
            "Split, compress, or raise maxFileBytes only after confirming the file is safe and useful.",
        }),
      ]),
    )
  })

  it("skips additional secret-like files by name and extension", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-secrets-"))
    tempDirs.push(root)

    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await writeFile(path.join(root, ".ragmir", "raw", ".env.development"), "TOKEN=dev\n", "utf8")
    await writeFile(path.join(root, ".ragmir", "raw", ".env.example"), "TOKEN=changeme\n", "utf8")
    await writeFile(path.join(root, ".ragmir", "raw", "id_rsa"), "PRIVATE\n", "utf8")
    await writeFile(path.join(root, ".ragmir", "raw", "credentials"), "aws creds\n", "utf8")
    await writeFile(path.join(root, ".ragmir", "raw", "service.p8"), "apple key\n", "utf8")
    await writeFile(path.join(root, ".ragmir", "raw", "keep.md"), "safe evidence\n", "utf8")

    const inventory = await inventorySourceFiles(testConfig(root))

    expect(inventory.supportedFiles.map((file) => file.relativePath)).toEqual([
      ".ragmir/raw/keep.md",
    ])
    const sensitive = inventory.skippedFiles
      .filter((file) => file.reason === "sensitive-name")
      .map((file) => file.relativePath)
    expect(sensitive).toEqual(
      expect.arrayContaining([
        ".ragmir/raw/.env.development",
        ".ragmir/raw/.env.example",
        ".ragmir/raw/credentials",
        ".ragmir/raw/id_rsa",
        ".ragmir/raw/service.p8",
      ]),
    )
  })

  it("indexes image files only when an OCR command is configured", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-image-files-"))
    tempDirs.push(root)

    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await writeFile(path.join(root, ".ragmir", "raw", "diagram.png"), "fake image bytes", "utf8")

    await expect(listSourceFiles(testConfig(root))).resolves.toEqual([])

    const files = await listSourceFiles(
      testConfig(root, { imageOcrCommand: [process.execPath, "image-ocr-wrapper.mjs"] }),
    )

    expect(files.map((file) => file.relativePath)).toEqual([".ragmir/raw/diagram.png"])
  })

  it("indexes legacy Word files only when a text extraction command is configured", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-doc-files-"))
    tempDirs.push(root)

    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await writeFile(path.join(root, ".ragmir", "raw", "legacy.doc"), "fake doc bytes", "utf8")

    await expect(listSourceFiles(testConfig(root))).resolves.toEqual([])

    const files = await listSourceFiles(
      testConfig(root, { legacyWordCommand: [process.execPath, "doc-wrapper.mjs"] }),
    )

    expect(files.map((file) => file.relativePath)).toEqual([".ragmir/raw/legacy.doc"])
  })

  it("indexes single files listed in the sources file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-source-file-"))
    tempDirs.push(root)

    await mkdir(path.join(root, ".ragmir"), { recursive: true })
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await mkdir(path.join(root, "external"), { recursive: true })
    await writeFile(path.join(root, ".ragmir", "sources.txt"), "external/README.md\n", "utf8")
    await writeFile(path.join(root, "external", "README.md"), "external evidence\n", "utf8")

    const files = await listSourceFiles(testConfig(root))

    expect(files.map((file) => ({ relativePath: file.relativePath, source: file.source }))).toEqual(
      [
        {
          relativePath: "external/README.md",
          source: "external/README.md",
        },
      ],
    )
  })

  it("indexes glob sources with exclusions for monorepo documentation", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-source-glob-"))
    tempDirs.push(root)

    await mkdir(path.join(root, ".ragmir"), { recursive: true })
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await mkdir(path.join(root, "apps", "front", "docs", "private"), { recursive: true })
    await mkdir(path.join(root, "apps", "back", "docs"), { recursive: true })
    await writeFile(
      path.join(root, ".ragmir", "sources.txt"),
      ["apps/*/README.md", "apps/*/docs/**/*.md", "!apps/*/docs/private/**", ""].join("\n"),
      "utf8",
    )
    await writeFile(path.join(root, "apps", "front", "README.md"), "front readme\n", "utf8")
    await writeFile(path.join(root, "apps", "front", "docs", "feature.md"), "front docs\n", "utf8")
    await writeFile(
      path.join(root, "apps", "front", "docs", "private", "secret.md"),
      "private docs\n",
      "utf8",
    )
    await writeFile(path.join(root, "apps", "back", "README.md"), "back readme\n", "utf8")
    await writeFile(path.join(root, "apps", "back", "docs", "api.md"), "back docs\n", "utf8")

    const files = await listSourceFiles(testConfig(root))

    expect(files.map((file) => file.relativePath)).toEqual([
      "apps/back/README.md",
      "apps/back/docs/api.md",
      "apps/front/README.md",
      "apps/front/docs/feature.md",
    ])
    expect(files.map((file) => file.source)).toEqual([
      "apps/back/README.md",
      "apps/back/docs/api.md",
      "apps/front/README.md",
      "apps/front/docs/feature.md",
    ])
  })

  it("indexes sources declared inline in the config", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-config-sources-"))
    tempDirs.push(root)

    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await mkdir(path.join(root, "apps", "front", "docs", "private"), { recursive: true })
    await mkdir(path.join(root, "apps", "back", "docs"), { recursive: true })
    await writeFile(path.join(root, "apps", "front", "README.md"), "front readme\n", "utf8")
    await writeFile(path.join(root, "apps", "front", "docs", "feature.md"), "front docs\n", "utf8")
    await writeFile(
      path.join(root, "apps", "front", "docs", "private", "secret.md"),
      "private docs\n",
      "utf8",
    )
    await writeFile(path.join(root, "apps", "back", "docs", "api.md"), "back docs\n", "utf8")

    const files = await listSourceFiles(
      testConfig(root, {
        sources: ["apps/*/README.md", "apps/*/docs/**/*.md", "!apps/*/docs/private/**"],
      }),
    )

    expect(files.map((file) => file.relativePath)).toEqual([
      "apps/back/docs/api.md",
      "apps/front/README.md",
      "apps/front/docs/feature.md",
    ])
  })

  it("applies exclusions to directory source roots", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-source-root-exclusion-"))
    tempDirs.push(root)

    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await mkdir(path.join(root, "docs", "private"), { recursive: true })
    await writeFile(path.join(root, "docs", "public.md"), "public evidence\n", "utf8")
    await writeFile(path.join(root, "docs", "private", "secret.md"), "private evidence\n", "utf8")

    const files = await listSourceFiles(testConfig(root, { sources: ["docs", "!docs/private/**"] }))

    expect(files.map((file) => file.relativePath)).toEqual(["docs/public.md"])
  })

  it("merges inline config sources with the legacy sources file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-sources-merge-"))
    tempDirs.push(root)

    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await mkdir(path.join(root, "inline"), { recursive: true })
    await mkdir(path.join(root, "legacy"), { recursive: true })
    await writeFile(path.join(root, "inline", "README.md"), "inline\n", "utf8")
    await writeFile(path.join(root, "legacy", "README.md"), "legacy\n", "utf8")
    await writeFile(path.join(root, ".ragmir", "sources.txt"), "legacy/README.md\n", "utf8")

    const files = await listSourceFiles(testConfig(root, { sources: ["inline/README.md"] }))

    expect(files.map((file) => file.relativePath)).toEqual(["inline/README.md", "legacy/README.md"])
  })

  it("indexes parent-relative glob sources from a nested knowledge base", async () => {
    const monorepo = await mkdtemp(path.join(os.tmpdir(), "ragmir-monorepo-glob-"))
    tempDirs.push(monorepo)
    const root = path.join(monorepo, "team-knowledge")

    await mkdir(path.join(root, ".ragmir"), { recursive: true })
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await mkdir(path.join(monorepo, "apps", "admin", "docs"), { recursive: true })
    await mkdir(path.join(monorepo, "apps", "portal", "docs"), { recursive: true })
    await writeFile(
      path.join(root, ".ragmir", "sources.txt"),
      ["../apps/*/README.md", "../apps/*/docs/**/*.md", "!../apps/*/docs/private/**", ""].join(
        "\n",
      ),
      "utf8",
    )
    await writeFile(path.join(monorepo, "apps", "admin", "README.md"), "admin readme\n", "utf8")
    await writeFile(path.join(monorepo, "apps", "admin", "docs", "ops.md"), "admin docs\n", "utf8")
    await writeFile(path.join(monorepo, "apps", "portal", "README.md"), "portal readme\n", "utf8")
    await writeFile(path.join(monorepo, "apps", "portal", "docs", "ux.md"), "portal docs\n", "utf8")

    const files = await listSourceFiles(testConfig(root))

    expect(files.map((file) => file.relativePath)).toEqual([
      "../apps/admin/README.md",
      "../apps/admin/docs/ops.md",
      "../apps/portal/README.md",
      "../apps/portal/docs/ux.md",
    ])
  })

  it("should reuse cached fingerprints without reading unchanged file content", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-fingerprint-cache-"))
    tempDirs.push(root)
    const rawDir = path.join(root, ".ragmir", "raw")
    await mkdir(rawDir, { recursive: true })
    await writeFile(path.join(rawDir, "a.md"), "alpha\n", "utf8")
    await writeFile(path.join(rawDir, "b.md"), "bravo\n", "utf8")
    const config = testConfig(root)

    const first = await inventorySourceFiles(config)
    const second = await inventorySourceFiles(config)

    expect(inventoryMetrics(first)).toMatchObject({ hashedFiles: 2, contentBytesRead: 12 })
    expect(inventoryMetrics(second)).toMatchObject({
      hashedFiles: 0,
      contentBytesRead: 0,
      reusedFingerprints: 2,
    })
  })

  it("should hash an overlapping source path only once per inventory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-fingerprint-dedup-"))
    tempDirs.push(root)
    const nested = path.join(root, ".ragmir", "raw", "nested")
    await mkdir(nested, { recursive: true })
    await writeFile(path.join(nested, "evidence.md"), "evidence\n", "utf8")

    const inventory = await inventorySourceFiles(
      testConfig(root, { sources: [".ragmir/raw/nested"] }),
    )

    expect(inventory.supportedFiles).toHaveLength(1)
    expect(inventoryMetrics(inventory).hashedFiles).toBe(1)
  })

  it("should fall back to content hashing when the fingerprint cache is corrupt", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-fingerprint-corrupt-"))
    tempDirs.push(root)
    const rawDir = path.join(root, ".ragmir", "raw")
    const storageDir = path.join(root, ".ragmir", "storage")
    await mkdir(rawDir, { recursive: true })
    await mkdir(storageDir, { recursive: true })
    await writeFile(path.join(rawDir, "evidence.md"), "evidence\n", "utf8")
    await writeFile(path.join(storageDir, "source-fingerprints.jsonl"), "{not valid json\n", "utf8")

    const inventory = await inventorySourceFiles(testConfig(root))

    expect(inventoryMetrics(inventory)).toMatchObject({
      hashedFiles: 1,
      reusedFingerprints: 0,
    })
  })

  it("should hash every included file on every strict inventory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-fingerprint-strict-"))
    tempDirs.push(root)
    const rawDir = path.join(root, ".ragmir", "raw")
    await mkdir(rawDir, { recursive: true })
    await writeFile(path.join(rawDir, "evidence.md"), "evidence\n", "utf8")
    const config = testConfig(root, { sourceFingerprintMode: "strict" })

    await inventorySourceFiles(config)
    const repeated = await inventorySourceFiles(config)

    expect(inventoryMetrics(repeated)).toMatchObject({
      hashedFiles: 1,
      reusedFingerprints: 0,
      contentBytesRead: 9,
    })
  })

  it("should not hash files excluded from a directory source root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-fingerprint-excluded-"))
    tempDirs.push(root)
    const rawDir = path.join(root, ".ragmir", "raw")
    await mkdir(path.join(rawDir, "excluded"), { recursive: true })
    await writeFile(path.join(rawDir, "included.md"), "included\n", "utf8")
    await writeFile(path.join(rawDir, "excluded", "hidden.md"), "hidden\n", "utf8")

    const inventory = await inventorySourceFiles(
      testConfig(root, { sources: ["!.ragmir/raw/excluded/**"] }),
    )

    expect(inventory.supportedFiles.map((file) => file.relativePath)).toEqual([
      ".ragmir/raw/included.md",
    ])
    expect(inventoryMetrics(inventory)).toMatchObject({
      hashedFiles: 1,
      contentBytesRead: 9,
    })
  })

  it("should detect a same-size change when mtime is restored", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-fingerprint-suspicious-"))
    tempDirs.push(root)
    const rawDir = path.join(root, ".ragmir", "raw")
    const filePath = path.join(rawDir, "evidence.md")
    await mkdir(rawDir, { recursive: true })
    await writeFile(filePath, "first\n", "utf8")
    const config = testConfig(root)
    const before = await inventorySourceFiles(config)
    const originalStats = await stat(filePath)

    await writeFile(filePath, "other\n", "utf8")
    await utimes(filePath, originalStats.atime, originalStats.mtime)
    const after = await inventorySourceFiles(config)

    expect(after.supportedFiles[0]?.checksum).not.toBe(before.supportedFiles[0]?.checksum)
    expect(inventoryMetrics(after).hashedFiles).toBe(1)
  })
})

describe("portable source paths", () => {
  const decomposed = "E\u0301tudes"
  const composed = "\u00c9tudes"

  it("applies a composed exclusion to a decomposed on-disk name and cites the composed path", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-unicode-exclusion-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await mkdir(path.join(root, "files", decomposed), { recursive: true })
    await writeFile(path.join(root, "files", decomposed, `Propositio\u0301n.md`), "price\n", "utf8")
    await writeFile(path.join(root, "files", decomposed, "plan.md"), "plan\n", "utf8")

    const files = await listSourceFiles(
      testConfig(root, { sources: ["files", `!files/${composed}/Propositi\u00f3n.md`] }),
    )

    expect(files.map((file) => file.relativePath)).toEqual([`files/${composed}/plan.md`])
    expect(files[0]?.relativePath.normalize("NFC")).toBe(files[0]?.relativePath)
    expect(existsSync(files[0]?.absolutePath ?? "")).toBe(true)
  })

  it("applies a composed directory exclusion and glob to decomposed folders", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-unicode-glob-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await mkdir(path.join(root, "docs", decomposed, "archive"), { recursive: true })
    await writeFile(path.join(root, "docs", decomposed, "guide.md"), "guide\n", "utf8")
    await writeFile(path.join(root, "docs", decomposed, "archive", "old.md"), "old\n", "utf8")

    const files = await listSourceFiles(
      testConfig(root, {
        sources: [`docs/${composed}/**/*.md`, `!docs/${composed}/archive`],
      }),
    )

    expect(files.map((file) => file.relativePath)).toEqual([`docs/${composed}/guide.md`])
  })

  it("resolves a composed source folder that exists only in decomposed form", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-unicode-root-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await mkdir(path.join(root, decomposed), { recursive: true })
    await writeFile(path.join(root, decomposed, "notes.md"), "notes\n", "utf8")

    const files = await listSourceFiles(testConfig(root, { sources: [composed] }))

    expect(files.map((file) => file.relativePath)).toEqual([`${composed}/notes.md`])
  })

  it.runIf(isCaseInsensitiveFileSystem(os.tmpdir()))(
    "matches exclusions without case on case-insensitive volumes",
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-case-exclusion-"))
      tempDirs.push(root)
      await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
      await mkdir(path.join(root, "Docs"), { recursive: true })
      await writeFile(path.join(root, "Docs", "Secret.md"), "secret\n", "utf8")
      await writeFile(path.join(root, "Docs", "public.md"), "public\n", "utf8")

      const files = await listSourceFiles(
        testConfig(root, { sources: ["Docs", "!docs/secret.md"] }),
      )

      expect(files.map((file) => file.relativePath)).toEqual(["Docs/public.md"])
    },
  )

  it("skips tool state and lockfiles unless a source names them or defaults are off", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-default-excludes-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await mkdir(path.join(root, ".claude", "skills"), { recursive: true })
    await mkdir(path.join(root, "docs"), { recursive: true })
    await writeFile(path.join(root, ".claude", "skills", "tool.md"), "skill\n", "utf8")
    await writeFile(path.join(root, "docs", "guide.md"), "guide\n", "utf8")
    await writeFile(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: 9\n", "utf8")

    const defaults = await listSourceFiles(testConfig(root, { sources: ["**/*.{md,yaml}"] }))
    const named = await listSourceFiles(
      testConfig(root, { sources: ["**/*.{md,yaml}", ".claude/**/*.md"] }),
    )
    const disabled = await listSourceFiles(
      testConfig(root, { sources: ["**/*.{md,yaml}"], defaultExcludes: false }),
    )

    expect(defaults.map((file) => file.relativePath)).toEqual(["docs/guide.md"])
    expect(named.map((file) => file.relativePath)).toEqual([
      ".claude/skills/tool.md",
      "docs/guide.md",
    ])
    expect(disabled.map((file) => file.relativePath)).toEqual([
      ".claude/skills/tool.md",
      "docs/guide.md",
      "pnpm-lock.yaml",
    ])
  })

  it("reports source rules that match nothing or leave an excluded copy indexed", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-source-rules-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await mkdir(path.join(root, "files", "copy"), { recursive: true })
    await writeFile(path.join(root, "files", "pricing.md"), "confidential price\n", "utf8")
    await writeFile(path.join(root, "files", "copy", "pricing.md"), "confidential price\n", "utf8")
    const config = testConfig(root, {
      sources: [
        "files",
        "missing-folder",
        "notes/**/*.md",
        "!files/pricing.md",
        "!files/absent.md",
        "docs\\guide.md",
      ],
    })
    const inventory = await inventorySourceFiles(config)

    const diagnostics = await sourceRuleDiagnostics(config, inventory.supportedFiles)

    expect(inventory.supportedFiles.map((file) => file.relativePath)).toEqual([
      "files/copy/pricing.md",
    ])
    expect(diagnostics.unmatchedSources).toEqual(["missing-folder", "docs\\guide.md"])
    expect(diagnostics.unmatchedPatterns).toEqual(["notes/**/*.md"])
    expect(diagnostics.unmatchedExclusions).toEqual(["files/absent.md"])
    expect(diagnostics.excludedCopies).toEqual([
      { excluded: "files/pricing.md", indexedCopy: "files/copy/pricing.md" },
    ])
    expect(diagnostics.portabilityWarnings).toHaveLength(1)
  })

  it("discovers sizes and modification times without hashing content", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-discovery-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
    await writeFile(path.join(root, ".ragmir", "raw", "a.md"), "alpha\n", "utf8")

    const discovery = await discoverSourceFiles(testConfig(root))

    expect(discovery.files).toEqual([
      expect.objectContaining({ relativePath: ".ragmir/raw/a.md", bytes: 6 }),
    ])
  })
})

function inventoryMetrics(inventory: Awaited<ReturnType<typeof inventorySourceFiles>>): {
  contentBytesRead: number
  hashedFiles: number
  reusedFingerprints: number
} {
  return inventory as typeof inventory & {
    contentBytesRead: number
    hashedFiles: number
    reusedFingerprints: number
  }
}
