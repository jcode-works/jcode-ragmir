import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { inventorySourceFiles, listSourceFiles } from "./files.js"
import { testConfig } from "./test-support/config.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("listSourceFiles", () => {
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
      "apps/back/docs/api.md",
      "apps/back/README.md",
      "apps/front/docs/feature.md",
      "apps/front/README.md",
    ])
    expect(files.map((file) => file.source)).toEqual([
      "apps/back/docs/api.md",
      "apps/back/README.md",
      "apps/front/docs/feature.md",
      "apps/front/README.md",
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
      "apps/front/docs/feature.md",
      "apps/front/README.md",
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
      "../apps/admin/docs/ops.md",
      "../apps/admin/README.md",
      "../apps/portal/docs/ux.md",
      "../apps/portal/README.md",
    ])
  })
})
