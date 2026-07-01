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
    const root = await mkdtemp(path.join(os.tmpdir(), "mimir-files-"))
    tempDirs.push(root)

    await mkdir(path.join(root, ".mimir", "raw", "nested"), { recursive: true })
    await mkdir(path.join(root, ".mimir", "raw", ".kb"), { recursive: true })
    await mkdir(path.join(root, ".mimir", "raw", ".mimir"), { recursive: true })
    await mkdir(path.join(root, ".mimir", "raw", ".mvn", "wrapper"), { recursive: true })
    await mkdir(path.join(root, ".mimir", "raw", ".vscode"), { recursive: true })
    await writeFile(path.join(root, ".mimir", "raw", ".env"), "SECRET=hidden\n", "utf8")
    await writeFile(path.join(root, ".mimir", "raw", ".gitignore"), "node_modules/\n", "utf8")
    await writeFile(path.join(root, ".mimir", "raw", ".gitkeep"), "", "utf8")
    await writeFile(path.join(root, ".mimir", "raw", ".gitlab-ci.yml"), "stages: [test]\n", "utf8")
    await writeFile(
      path.join(root, ".mimir", "raw", ".mvn", "wrapper", "maven-wrapper.properties"),
      "distributionUrl=https://example.invalid/maven.zip\n",
      "utf8",
    )
    await writeFile(
      path.join(root, ".mimir", "raw", ".vscode", "settings.json"),
      '{"editor.tabSize":2}\n',
      "utf8",
    )
    await writeFile(path.join(root, ".mimir", "raw", "events.jsonl"), '{"event":"login"}\n', "utf8")
    await writeFile(path.join(root, ".mimir", "raw", "example.bat"), "echo evidence\n", "utf8")
    await writeFile(path.join(root, ".mimir", "raw", "example.cmd"), "echo evidence\n", "utf8")
    await writeFile(path.join(root, ".mimir", "raw", "schema.sql"), "select 1;\n", "utf8")
    await writeFile(path.join(root, ".mimir", "raw", "settings.example"), "name=value\n", "utf8")
    await writeFile(path.join(root, ".mimir", "raw", "settings.exemple"), "name=value\n", "utf8")
    await writeFile(
      path.join(root, ".mimir", "raw", "component.vue"),
      "<template>Evidence</template>\n",
      "utf8",
    )
    await writeFile(
      path.join(root, ".mimir", "raw", "loader.mjs"),
      "export const evidence = true\n",
      "utf8",
    )
    await writeFile(path.join(root, ".mimir", "raw", "mvnw"), "#!/bin/sh\n", "utf8")
    await writeFile(path.join(root, ".mimir", "raw", "sequence.mmd"), "sequenceDiagram\n", "utf8")
    await writeFile(
      path.join(root, ".mimir", "raw", "captions.vtt"),
      "WEBVTT\n\nEvidence\n",
      "utf8",
    )
    await writeFile(path.join(root, ".mimir", "raw", "notes.transcript"), "call notes\n", "utf8")
    await writeFile(path.join(root, ".mimir", "raw", "README.md"), "generated helper\n", "utf8")
    await writeFile(path.join(root, ".mimir", "raw", "image.png"), "not indexed\n", "utf8")
    await writeFile(path.join(root, ".mimir", "raw", "legacy.doc"), "not indexed\n", "utf8")
    await writeFile(path.join(root, ".mimir", "raw", "legacy.xls"), "not indexed\n", "utf8")
    await writeFile(path.join(root, ".mimir", "raw", "private.pem"), "not indexed\n", "utf8")
    await writeFile(path.join(root, ".mimir", "raw", ".kb", "index.md"), "ignored\n", "utf8")
    await writeFile(path.join(root, ".mimir", "raw", ".mimir", "agent.md"), "ignored\n", "utf8")

    const files = await listSourceFiles(testConfig(root, { includeExtensions: [".transcript"] }))

    expect(files.map((file) => file.relativePath)).toEqual([
      ".mimir/raw/.gitignore",
      ".mimir/raw/.gitlab-ci.yml",
      ".mimir/raw/.mvn/wrapper/maven-wrapper.properties",
      ".mimir/raw/.vscode/settings.json",
      ".mimir/raw/captions.vtt",
      ".mimir/raw/component.vue",
      ".mimir/raw/events.jsonl",
      ".mimir/raw/example.bat",
      ".mimir/raw/example.cmd",
      ".mimir/raw/loader.mjs",
      ".mimir/raw/mvnw",
      ".mimir/raw/notes.transcript",
      ".mimir/raw/schema.sql",
      ".mimir/raw/sequence.mmd",
      ".mimir/raw/settings.example",
      ".mimir/raw/settings.exemple",
    ])

    const inventory = await inventorySourceFiles(
      testConfig(root, { includeExtensions: [".transcript"], maxFileBytes: 20 }),
    )

    expect(inventory.skippedFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relativePath: ".mimir/raw/.env",
          reason: "sensitive-name",
          recommendation:
            "Review manually; secret-like files are skipped to avoid indexing credentials or private keys.",
        }),
        expect.objectContaining({
          relativePath: ".mimir/raw/.gitkeep",
          reason: "unsupported-extension",
        }),
        expect.objectContaining({
          relativePath: ".mimir/raw/image.png",
          reason: "unsupported-extension",
          recommendation:
            "Configure imageOcrCommand for local image OCR, save extracted text as a supported text file, or convert to an OCRed PDF before ingesting.",
        }),
        expect.objectContaining({
          relativePath: ".mimir/raw/legacy.doc",
          reason: "unsupported-extension",
          recommendation:
            "Configure legacyWordCommand for local legacy Word extraction, or convert to DOCX, PDF, HTML, or text before ingesting.",
        }),
        expect.objectContaining({
          relativePath: ".mimir/raw/legacy.xls",
          reason: "unsupported-extension",
          recommendation:
            "Convert legacy XLS workbooks to XLSX, CSV, PDF, HTML, or text before ingesting.",
        }),
        expect.objectContaining({
          relativePath: ".mimir/raw/private.pem",
          reason: "sensitive-name",
          recommendation:
            "Review manually; secret-like files are skipped to avoid indexing credentials or private keys.",
        }),
        expect.objectContaining({
          relativePath: ".mimir/raw/component.vue",
          reason: "oversized",
          recommendation:
            "Split, compress, or raise maxFileBytes only after confirming the file is safe and useful.",
        }),
      ]),
    )
  })

  it("indexes image files only when an OCR command is configured", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mimir-image-files-"))
    tempDirs.push(root)

    await mkdir(path.join(root, ".mimir", "raw"), { recursive: true })
    await writeFile(path.join(root, ".mimir", "raw", "diagram.png"), "fake image bytes", "utf8")

    await expect(listSourceFiles(testConfig(root))).resolves.toEqual([])

    const files = await listSourceFiles(
      testConfig(root, { imageOcrCommand: [process.execPath, "image-ocr-wrapper.mjs"] }),
    )

    expect(files.map((file) => file.relativePath)).toEqual([".mimir/raw/diagram.png"])
  })

  it("indexes legacy Word files only when a text extraction command is configured", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mimir-doc-files-"))
    tempDirs.push(root)

    await mkdir(path.join(root, ".mimir", "raw"), { recursive: true })
    await writeFile(path.join(root, ".mimir", "raw", "legacy.doc"), "fake doc bytes", "utf8")

    await expect(listSourceFiles(testConfig(root))).resolves.toEqual([])

    const files = await listSourceFiles(
      testConfig(root, { legacyWordCommand: [process.execPath, "doc-wrapper.mjs"] }),
    )

    expect(files.map((file) => file.relativePath)).toEqual([".mimir/raw/legacy.doc"])
  })

  it("indexes single files listed in the sources file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mimir-source-file-"))
    tempDirs.push(root)

    await mkdir(path.join(root, ".mimir"), { recursive: true })
    await mkdir(path.join(root, ".mimir", "raw"), { recursive: true })
    await mkdir(path.join(root, "external"), { recursive: true })
    await writeFile(path.join(root, ".mimir", "sources.txt"), "external/README.md\n", "utf8")
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
})
