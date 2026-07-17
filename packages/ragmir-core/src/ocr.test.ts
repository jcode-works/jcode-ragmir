import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { isRecord } from "./guards.js"
import { initProject } from "./init.js"
import {
  configurePdfOcr,
  extractPdfPage,
  extractPdfPages,
  inspectPdfOcr,
  normalizeOcrLanguage,
  parsePdfOcrEngine,
  parsePdfOcrPages,
  pdfOcrCommandIdentity,
} from "./ocr.js"

const tempDirs: string[] = []
const originalPath = process.env.PATH

afterEach(async () => {
  process.env.PATH = originalPath
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("PDF OCR onboarding", () => {
  it("should validate OCR engines and Tesseract language codes", () => {
    expect(parsePdfOcrEngine("auto", true)).toBe("auto")
    expect(parsePdfOcrEngine("ocrmypdf")).toBe("ocrmypdf")
    expect(parsePdfOcrEngine("tesseract")).toBe("tesseract")
    expect(normalizeOcrLanguage(" ENG+FRA ")).toBe("eng+fra")
    expect(() => parsePdfOcrEngine("cloud", true)).toThrow("auto, ocrmypdf, or tesseract")
    expect(() => normalizeOcrLanguage("eng;curl example.test")).toThrow("Tesseract codes")
    expect(parsePdfOcrPages("3,1,2,2")).toEqual([1, 2, 3])
    expect(() => parsePdfOcrPages("0,2")).toThrow("between 1")
  })

  it("should detect Tesseract with Poppler and configure the project command", async () => {
    const root = await createTempRoot("ragmir-ocr-config-")
    const binDir = await createFakeTools(root, { tesseract: true, pdftoppm: true })
    process.env.PATH = binDir
    await writeFile(path.join(root, "package.json"), '{"packageManager":"pnpm@11.9.0"}\n')

    const status = await inspectPdfOcr(root)
    expect(status.recommendedEngine).toBe("tesseract")
    expect(status.languages).toEqual(["eng", "fra"])

    const result = await configurePdfOcr({
      cwd: root,
      engine: "auto",
      language: "eng+fra",
      timeoutMs: 45_000,
    })
    const raw: unknown = JSON.parse(await readFile(result.configPath, "utf8"))
    expect(isRecord(raw)).toBe(true)
    if (!isRecord(raw)) {
      throw new Error("Expected an object config fixture.")
    }
    expect(result.engine).toBe("tesseract")
    expect(raw.pdfOcrCommand).toEqual([
      "pnpm",
      "exec",
      "rgr",
      "ocr",
      "extract-pages",
      "--engine",
      "tesseract",
      "--language",
      "eng+fra",
      "--input",
      "{input}",
      "--pages",
      "{pages}",
      "--timeout-ms",
      "45000",
    ])
    expect(raw.pdfOcrTimeoutMs).toBe(45_000)
  }, 10_000)

  it("should reject OCR configuration under the strict privacy profile", async () => {
    const root = await createTempRoot("ragmir-ocr-strict-")
    await initProject(root)
    const configPath = path.join(root, ".ragmir", "config.json")
    const raw: unknown = JSON.parse(await readFile(configPath, "utf8"))
    if (!isRecord(raw)) {
      throw new Error("Expected an object config fixture.")
    }
    await writeFile(
      configPath,
      `${JSON.stringify({ ...raw, privacyProfile: "strict" }, null, 2)}\n`,
    )

    await expect(configurePdfOcr({ cwd: root })).rejects.toThrow(
      "strict privacy profile disables external extractors",
    )
  })

  it("should extract one PDF page with the local Tesseract pipeline", async () => {
    const root = await createTempRoot("ragmir-ocr-tesseract-")
    const binDir = await createFakeTools(root, { tesseract: true, pdftoppm: true })
    process.env.PATH = binDir
    const input = path.join(root, "scan.pdf")
    await writeFile(input, "synthetic PDF fixture")

    await expect(
      extractPdfPage({ engine: "tesseract", input, page: 2, language: "eng" }),
    ).resolves.toBe("Synthetic OCR text from Tesseract\n")
  })

  it("should extract multiple PDF pages through one bounded Tesseract batch", async () => {
    const root = await createTempRoot("ragmir-ocr-tesseract-batch-")
    const binDir = await createFakeTools(root, { tesseract: true, pdftoppm: true })
    process.env.PATH = binDir
    const input = path.join(root, "scan.pdf")
    await writeFile(input, "synthetic PDF fixture")

    await expect(
      extractPdfPages({ engine: "tesseract", input, pages: [2, 4, 5], language: "eng" }),
    ).resolves.toMatchObject({
      subprocesses: 2,
      pages: [
        { page: 2, text: "Synthetic OCR text from Tesseract\n" },
        { page: 4, text: "Synthetic OCR text from Tesseract\n" },
        { page: 5, text: "Synthetic OCR text from Tesseract\n" },
      ],
    })
  })

  it("should extract one PDF page with OCRmyPDF sidecar output", async () => {
    const root = await createTempRoot("ragmir-ocr-ocrmypdf-")
    const binDir = await createFakeTools(root, { ocrmypdf: true })
    process.env.PATH = binDir
    const input = path.join(root, "scan.pdf")
    await writeFile(input, "synthetic PDF fixture")

    await expect(
      extractPdfPage({ engine: "ocrmypdf", input, page: 1, language: "eng" }),
    ).resolves.toBe("Synthetic OCR text from OCRmyPDF\n")
  })

  it("should extract multiple selected pages through one OCRmyPDF batch", async () => {
    const root = await createTempRoot("ragmir-ocr-ocrmypdf-batch-")
    const binDir = await createFakeTools(root, { ocrmypdf: true })
    process.env.PATH = binDir
    const input = path.join(root, "scan.pdf")
    await writeFile(input, "synthetic PDF fixture")

    await expect(
      extractPdfPages({ engine: "ocrmypdf", input, pages: [1, 3], language: "eng" }),
    ).resolves.toMatchObject({
      subprocesses: 1,
      pages: [
        { page: 1, text: "Synthetic OCR text from OCRmyPDF\n" },
        { page: 3, text: "Synthetic OCR text from OCRmyPDF\n" },
      ],
    })
  })

  it("should invalidate custom OCR identity when command content or language changes", async () => {
    const root = await createTempRoot("ragmir-ocr-identity-")
    const script = path.join(root, "ocr-wrapper.mjs")
    const command = [process.execPath, script, "--language", "eng", "{pages}"]
    await writeFile(script, 'process.stdout.write("v1")\n')
    const first = await pdfOcrCommandIdentity(command, root)
    await writeFile(script, 'process.stdout.write("v2")\n')
    const changedContent = await pdfOcrCommandIdentity(command, root)
    const changedLanguage = await pdfOcrCommandIdentity(
      [process.execPath, script, "--language", "fra", "{pages}"],
      root,
    )

    expect(changedContent.engineVersion).not.toBe(first.engineVersion)
    expect(changedContent.commandFingerprint).not.toBe(first.commandFingerprint)
    expect(changedLanguage.language).toBe("fra")
    expect(changedLanguage.commandFingerprint).not.toBe(changedContent.commandFingerprint)
  })
})

async function createTempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix))
  tempDirs.push(root)
  return root
}

async function createFakeTools(
  root: string,
  tools: { ocrmypdf?: boolean; tesseract?: boolean; pdftoppm?: boolean },
): Promise<string> {
  const binDir = path.join(root, "bin")
  await mkdir(binDir, { recursive: true })

  if (tools.tesseract) {
    await writeExecutable(
      path.join(binDir, "tesseract"),
      `import { readFileSync } from "node:fs"
const args = process.argv.slice(2)
if (args.includes("--list-langs")) {
  process.stdout.write("List of available languages (2):\\neng\\nfra\\n")
} else if (args.includes("stdout")) {
  const pages = readFileSync(args[0], "utf8").trim().split("\\n").filter(Boolean)
  process.stdout.write(pages.map(() => "Synthetic OCR text from Tesseract\\n").join("\\f") + "\\f")
} else {
  process.stdout.write("tesseract 5.5.0\\n")
}`,
    )
  }
  if (tools.pdftoppm) {
    await writeExecutable(
      path.join(binDir, "pdftoppm"),
      `import { writeFileSync } from "node:fs"
const args = process.argv.slice(2)
if (args.includes("-v")) {
  process.stderr.write("pdftoppm version 25.0.0\\n")
} else {
  const first = Number(args[args.indexOf("-f") + 1])
  const last = Number(args[args.indexOf("-l") + 1])
  for (let page = first; page <= last; page += 1) {
    writeFileSync(args.at(-1) + "-" + page + ".png", "synthetic image")
  }
}`,
    )
  }
  if (tools.ocrmypdf) {
    await writeExecutable(
      path.join(binDir, "ocrmypdf"),
      `import { writeFileSync } from "node:fs"
const args = process.argv.slice(2)
if (args.includes("--version")) {
  process.stdout.write("17.8.0\\n")
} else {
  const sidecarIndex = args.indexOf("--sidecar")
  const pages = args[args.indexOf("--pages") + 1].split(",")
  writeFileSync(args[sidecarIndex + 1], pages.map(() => "Synthetic OCR text from OCRmyPDF\\n").join("\\f") + "\\f")
}`,
    )
  }

  return binDir
}

async function writeExecutable(filePath: string, source: string): Promise<void> {
  await writeFile(filePath, `#!${process.execPath}\n${source}\n`, "utf8")
  await chmod(filePath, 0o755)
}
