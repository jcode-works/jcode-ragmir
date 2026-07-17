import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { findProjectConfig, loadConfig } from "./config.js"
import { initProject } from "./init.js"
import { MAX_EXTERNAL_TEXT_STDIO_BYTES, MAX_PDF_PAGES } from "./limits.js"
import { rgrCommand } from "./package-manager.js"
import { hardenPrivateFile } from "./permissions.js"
import { mutateProjectConfig } from "./project-config-file.js"

const OCR_COMMAND_TIMEOUT_MS = 120_000
const OCR_PROBE_TIMEOUT_MS = 10_000
const OCR_PROCESS_KILL_GRACE_MS = 1_000
export const OCR_RENDER_DPI = 300
export const MAX_OCR_BATCH_PAGES = 16
const MINIMUM_OCRMYPDF_VERSION = { major: 12, minor: 6 }

export type PdfOcrEngine = "ocrmypdf" | "tesseract"
export type PdfOcrEngineSelection = PdfOcrEngine | "auto"

export interface OcrExecutableStatus {
  available: boolean
  version: string | null
}

export interface PdfOcrStatus {
  projectRoot: string
  privacyProfile: "strict" | "private" | "trusted" | "custom"
  configured: boolean
  configuredCommand: string[]
  recommendedEngine: PdfOcrEngine | null
  ocrmypdf: OcrExecutableStatus & { supported: boolean }
  tesseract: OcrExecutableStatus
  pdftoppm: OcrExecutableStatus
  languages: string[]
}

export interface ConfigurePdfOcrOptions {
  cwd?: string
  engine?: PdfOcrEngineSelection
  language?: string
  timeoutMs?: number
}

export interface ConfigurePdfOcrResult {
  configPath: string
  engine: PdfOcrEngine
  language: string
  timeoutMs: number
  pdfOcrCommand: string[]
}

export interface ExtractPdfPageOptions {
  engine: PdfOcrEngine
  input: string
  page: number
  language?: string
  timeoutMs?: number
}

export interface ExtractPdfPagesOptions {
  engine: PdfOcrEngine
  input: string
  pages: number[]
  language?: string
  timeoutMs?: number
}

export interface ExtractPdfPagesResult {
  engine: PdfOcrEngine
  language: string
  dpi: number
  subprocesses: number
  pages: Array<{ page: number; text: string }>
}

export interface PdfOcrCommandIdentity {
  engine: string
  engineVersion: string
  language: string
  dpi: number
  commandFingerprint: string
  supportsBatch: boolean
  subprocesses: number
}

interface ProcessResult {
  stdout: string
  stderr: string
}

export function parsePdfOcrEngine(value: string | undefined, allowAuto: true): PdfOcrEngineSelection
export function parsePdfOcrEngine(value: string | undefined, allowAuto?: false): PdfOcrEngine
export function parsePdfOcrEngine(
  value: string | undefined,
  allowAuto = false,
): PdfOcrEngineSelection {
  const normalized = value?.trim().toLowerCase()
  if (normalized === "ocrmypdf" || normalized === "tesseract") {
    return normalized
  }
  if (allowAuto && (normalized === undefined || normalized === "auto")) {
    return "auto"
  }
  throw new Error(
    allowAuto ? "Expected auto, ocrmypdf, or tesseract." : "Expected ocrmypdf or tesseract.",
  )
}

export function normalizeOcrLanguage(value = "eng"): string {
  const normalized = value.trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9_-]*(?:\+[a-z0-9][a-z0-9_-]*)*$/u.test(normalized)) {
    throw new Error("OCR language must use Tesseract codes such as eng, fra, or eng+fra.")
  }
  return normalized
}

export function parsePdfOcrPages(value: string): number[] {
  const pages = value.split(",").map((entry) => Number(entry.trim()))
  return normalizePdfOcrPages(pages)
}

export async function inspectPdfOcr(cwd = process.cwd()): Promise<PdfOcrStatus> {
  const config = await loadConfig(cwd)
  const [ocrmypdf, tesseract, pdftoppm] = await Promise.all([
    probeExecutable("ocrmypdf", ["--version"]),
    probeExecutable("tesseract", ["--version"]),
    probeExecutable("pdftoppm", ["-v"]),
  ])
  const languages = tesseract.available ? await listTesseractLanguages() : []
  const ocrmypdfSupported = ocrmypdf.available && isSupportedOcrMyPdfVersion(ocrmypdf.version)
  const recommendedEngine = ocrmypdfSupported
    ? "ocrmypdf"
    : tesseract.available && pdftoppm.available
      ? "tesseract"
      : null

  return {
    projectRoot: config.projectRoot,
    privacyProfile: config.privacyProfile,
    configured: config.pdfOcrCommand.length > 0,
    configuredCommand: config.pdfOcrCommand,
    recommendedEngine,
    ocrmypdf: { ...ocrmypdf, supported: ocrmypdfSupported },
    tesseract,
    pdftoppm,
    languages,
  }
}

export async function configurePdfOcr(
  options: ConfigurePdfOcrOptions = {},
): Promise<ConfigurePdfOcrResult> {
  const cwd = options.cwd ?? process.cwd()
  await initProject(cwd)
  const config = await loadConfig(cwd)
  if (config.privacyProfile === "strict") {
    throw new Error(
      "The strict privacy profile disables external extractors. Use the private or custom profile before configuring local OCR.",
    )
  }

  const status = await inspectPdfOcr(cwd)
  const requestedEngine = parsePdfOcrEngine(options.engine, true)
  const engine = resolveEngine(requestedEngine, status)
  const language = normalizeOcrLanguage(options.language)
  assertLanguagesAvailable(language, status.languages)
  const timeoutMs = options.timeoutMs ?? config.pdfOcrTimeoutMs
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("OCR timeout must be a positive integer.")
  }

  const configuredCommand = await rgrCommand(config.projectRoot, [
    "ocr",
    "extract-pages",
    "--engine",
    engine,
    "--language",
    language,
    "--input",
    "{input}",
    "--pages",
    "{pages}",
    "--timeout-ms",
    String(timeoutMs),
  ])
  const pdfOcrCommand = [configuredCommand.command, ...configuredCommand.args]
  const projectConfig = findProjectConfig(config.projectRoot)
  await mutateProjectConfig(projectConfig, (raw) => {
    Object.assign(raw, { pdfOcrCommand, pdfOcrTimeoutMs: timeoutMs })
    return { changed: true, value: undefined }
  })
  await hardenPrivateFile(projectConfig.configPath)

  return {
    configPath: projectConfig.configPath,
    engine,
    language,
    timeoutMs,
    pdfOcrCommand,
  }
}

export async function extractPdfPage(options: ExtractPdfPageOptions): Promise<string> {
  const result = await extractPdfPages({
    engine: options.engine,
    input: options.input,
    pages: [options.page],
    ...(options.language === undefined ? {} : { language: options.language }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  })
  return result.pages[0]?.text ?? ""
}

export async function extractPdfPages(
  options: ExtractPdfPagesOptions,
): Promise<ExtractPdfPagesResult> {
  const pages = normalizePdfOcrPages(options.pages)
  if (pages.length > MAX_OCR_BATCH_PAGES) {
    throw new Error(`One OCR batch cannot exceed ${MAX_OCR_BATCH_PAGES} pages.`)
  }
  const language = normalizeOcrLanguage(options.language)
  const timeoutMs = options.timeoutMs ?? OCR_COMMAND_TIMEOUT_MS
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("OCR timeout must be a positive integer.")
  }
  const engine = parsePdfOcrEngine(options.engine)
  const input = path.resolve(options.input)
  const tempDir = await createOcrTempDirectory()

  try {
    if (engine === "ocrmypdf") {
      return {
        engine,
        language,
        dpi: OCR_RENDER_DPI,
        subprocesses: 1,
        pages: pairOcrPageText(
          pages,
          await extractWithOcrMyPdf({ input, pages, language, timeoutMs, tempDir }),
        ),
      }
    }
    return {
      engine,
      language,
      dpi: OCR_RENDER_DPI,
      subprocesses: 2,
      pages: pairOcrPageText(
        pages,
        await extractWithTesseract({ input, pages, language, timeoutMs, tempDir }),
      ),
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

function resolveEngine(selection: PdfOcrEngineSelection, status: PdfOcrStatus): PdfOcrEngine {
  if (selection === "auto") {
    if (status.recommendedEngine) {
      return status.recommendedEngine
    }
    throw new Error(
      "No supported local PDF OCR engine found. Install OCRmyPDF 12.6+ or install both Tesseract and Poppler, then run `rgr ocr setup` again.",
    )
  }
  if (selection === "ocrmypdf" && !status.ocrmypdf.supported) {
    throw new Error("OCRmyPDF 12.6 or newer is required for sidecar-only page extraction.")
  }
  if (selection === "tesseract" && (!status.tesseract.available || !status.pdftoppm.available)) {
    throw new Error(
      "The Tesseract engine requires both `tesseract` and Poppler `pdftoppm` on PATH.",
    )
  }
  return selection
}

function assertLanguagesAvailable(language: string, installed: string[]): void {
  if (installed.length === 0) {
    return
  }
  const available = new Set(installed)
  const missing = language.split("+").filter((entry) => !available.has(entry))
  if (missing.length > 0) {
    throw new Error(`Missing Tesseract language packs: ${missing.join(", ")}.`)
  }
}

async function extractWithOcrMyPdf(options: {
  input: string
  pages: number[]
  language: string
  timeoutMs: number
  tempDir: string
}): Promise<string> {
  const sidecarPath = path.join(options.tempDir, "pages.txt")
  await runProcess(
    "ocrmypdf",
    [
      "--quiet",
      "--force-ocr",
      "--pages",
      options.pages.join(","),
      "--language",
      options.language,
      "--sidecar",
      sidecarPath,
      "--output-type",
      "none",
      options.input,
      "-",
    ],
    { timeoutMs: options.timeoutMs },
  )
  return readFile(sidecarPath, "utf8")
}

async function extractWithTesseract(options: {
  input: string
  pages: number[]
  language: string
  timeoutMs: number
  tempDir: string
}): Promise<string> {
  const firstPage = options.pages[0]
  const lastPage = options.pages.at(-1)
  if (firstPage === undefined || lastPage === undefined) {
    throw new Error("At least one PDF page is required for OCR.")
  }
  const outputPrefix = path.join(options.tempDir, "rendered-page")
  await runProcess(
    "pdftoppm",
    [
      "-f",
      String(firstPage),
      "-l",
      String(lastPage),
      "-r",
      String(OCR_RENDER_DPI),
      "-gray",
      "-png",
      options.input,
      outputPrefix,
    ],
    { timeoutMs: options.timeoutMs },
  )
  const renderedPages = (await readdir(options.tempDir))
    .filter((entry) => entry.startsWith("rendered-page-") && entry.endsWith(".png"))
    .sort(naturalFilenameOrder)
  const renderedCount = lastPage - firstPage + 1
  if (renderedPages.length !== renderedCount) {
    throw new Error(
      `Poppler rendered ${renderedPages.length} pages, expected ${renderedCount} for OCR.`,
    )
  }
  const selectedPages = options.pages.map((pageNumber) => {
    const filename = renderedPages[pageNumber - firstPage]
    if (!filename) {
      throw new Error(`Poppler did not render requested PDF page ${pageNumber}.`)
    }
    return path.join(options.tempDir, filename)
  })
  const pageListPath = path.join(options.tempDir, "pages.txt")
  await writeFile(pageListPath, `${selectedPages.join("\n")}\n`, "utf8")
  const result = await runProcess("tesseract", [pageListPath, "stdout", "-l", options.language], {
    cwd: options.tempDir,
    timeoutMs: options.timeoutMs,
  })
  return result.stdout
}

function pairOcrPageText(pages: number[], output: string): Array<{ page: number; text: string }> {
  const pageTexts = output.replace(/\r\n?/gu, "\n").split("\f")
  if (pageTexts.at(-1) === "") {
    pageTexts.pop()
  }
  if (pageTexts.length !== pages.length) {
    throw new Error(
      `OCR returned ${pageTexts.length} page payloads for ${pages.length} requested pages.`,
    )
  }
  return pages.map((page, index) => ({ page, text: pageTexts[index] ?? "" }))
}

function normalizePdfOcrPages(pages: number[]): number[] {
  if (pages.length === 0) {
    throw new Error("At least one PDF page is required for OCR.")
  }
  const normalized = [...new Set(pages)].sort((left, right) => left - right)
  if (
    normalized.some(
      (pageNumber) =>
        !Number.isInteger(pageNumber) || pageNumber <= 0 || pageNumber > MAX_PDF_PAGES,
    )
  ) {
    throw new Error(`PDF pages must be integers between 1 and ${MAX_PDF_PAGES}.`)
  }
  return normalized
}

function naturalFilenameOrder(left: string, right: string): number {
  const leftPage = Number(left.match(/(\d+)\.png$/u)?.[1])
  const rightPage = Number(right.match(/(\d+)\.png$/u)?.[1])
  return leftPage - rightPage
}

export async function pdfOcrCommandIdentity(
  command: string[],
  cwd = process.cwd(),
): Promise<PdfOcrCommandIdentity> {
  const configuredEngine = commandOption(command, "--engine")
  const engine =
    configuredEngine === "ocrmypdf" || configuredEngine === "tesseract"
      ? configuredEngine
      : path.basename(command[0] ?? "custom")
  const configuredLanguage = commandOption(command, "--language")?.trim().toLowerCase()
  const language = configuredLanguage && configuredLanguage.length > 0 ? configuredLanguage : "eng"
  const configuredDpi = Number(commandOption(command, "--dpi"))
  const dpi = Number.isInteger(configuredDpi) && configuredDpi > 0 ? configuredDpi : OCR_RENDER_DPI
  const commandFingerprint = await fingerprintOcrCommand(command, cwd)
  let engineVersion = `command:${commandFingerprint}`
  let subprocesses = 0

  if (engine === "tesseract") {
    const [tesseract, pdftoppm] = await Promise.all([
      probeExecutable("tesseract", ["--version"]),
      probeExecutable("pdftoppm", ["-v"]),
    ])
    engineVersion = `tesseract:${tesseract.version ?? "unavailable"};pdftoppm:${pdftoppm.version ?? "unavailable"}`
    subprocesses = 2
  } else if (engine === "ocrmypdf") {
    const ocrmypdf = await probeExecutable("ocrmypdf", ["--version"])
    engineVersion = `ocrmypdf:${ocrmypdf.version ?? "unavailable"}`
    subprocesses = 1
  }

  return {
    engine,
    engineVersion,
    language,
    dpi,
    commandFingerprint,
    supportsBatch: command.some((part) => part.includes("{pages}")),
    subprocesses,
  }
}

function commandOption(command: string[], name: string): string | undefined {
  const index = command.indexOf(name)
  return index >= 0 ? command[index + 1] : undefined
}

async function fingerprintOcrCommand(command: string[], cwd: string): Promise<string> {
  const fingerprint = createHash("sha256")
  fingerprint.update(JSON.stringify(command))
  for (const [index, part] of command.entries()) {
    if (part.includes("{") || part.startsWith("--")) {
      continue
    }
    const candidate = await commandFilePath(part, index === 0, cwd)
    if (!candidate) {
      continue
    }
    const metadata = await stat(candidate)
    if (!metadata.isFile()) {
      continue
    }
    fingerprint.update("\0")
    fingerprint.update(String(index))
    fingerprint.update("\0")
    fingerprint.update(String(metadata.size))
    fingerprint.update("\0")
    if (candidate === process.execPath) {
      fingerprint.update(process.version)
      continue
    }
    for await (const chunk of createReadStream(candidate)) {
      fingerprint.update(chunk)
    }
  }
  return fingerprint.digest("hex")
}

async function commandFilePath(
  value: string,
  executable: boolean,
  cwd: string,
): Promise<string | null> {
  const candidates = path.isAbsolute(value)
    ? [value]
    : value.includes(path.sep)
      ? [path.resolve(cwd, value)]
      : executable
        ? executableCandidates(value)
        : [path.resolve(cwd, value)]
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) {
        return candidate
      }
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") {
        throw error
      }
    }
  }
  return null
}

function executableCandidates(executable: string): string[] {
  const extensions =
    process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""]
  return (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .flatMap((directory) =>
      extensions.map((extension) => path.join(directory, executable + extension)),
    )
}

async function createOcrTempDirectory(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "ragmir-ocr-"))
}

async function probeExecutable(executable: string, args: string[]): Promise<OcrExecutableStatus> {
  try {
    const result = await runProcess(executable, args, { timeoutMs: OCR_PROBE_TIMEOUT_MS })
    const version = firstNonEmptyLine(`${result.stdout}\n${result.stderr}`)
    return { available: true, version }
  } catch {
    return { available: false, version: null }
  }
}

async function listTesseractLanguages(): Promise<string[]> {
  try {
    const result = await runProcess("tesseract", ["--list-langs"], {
      timeoutMs: OCR_PROBE_TIMEOUT_MS,
    })
    return `${result.stdout}\n${result.stderr}`
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("List of available languages"))
      .sort((left, right) => left.localeCompare(right))
  } catch {
    return []
  }
}

function isSupportedOcrMyPdfVersion(version: string | null): boolean {
  if (!version) {
    return false
  }
  const match = version.match(/(\d+)\.(\d+)/u)
  if (!match) {
    return false
  }
  const major = Number(match[1])
  const minor = Number(match[2])
  return (
    major > MINIMUM_OCRMYPDF_VERSION.major ||
    (major === MINIMUM_OCRMYPDF_VERSION.major && minor >= MINIMUM_OCRMYPDF_VERSION.minor)
  )
}

function firstNonEmptyLine(value: string): string | null {
  return (
    value
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? null
  )
}

async function runProcess(
  executable: string,
  args: string[],
  options: { cwd?: string; timeoutMs: number },
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      detached: process.platform !== "win32",
      env: externalCommandEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    let settled = false
    let timedOut = false
    let outputTooLarge = false
    let terminationStarted = false
    let forceKillTimeout: ReturnType<typeof setTimeout> | undefined

    const terminateWithEscalation = (): void => {
      if (terminationStarted) {
        return
      }
      terminationStarted = true
      terminateChild(child, "SIGTERM")
      forceKillTimeout = setTimeout(
        () => terminateChild(child, "SIGKILL"),
        OCR_PROCESS_KILL_GRACE_MS,
      )
    }
    const timeout = setTimeout(() => {
      timedOut = true
      terminateWithEscalation()
    }, options.timeoutMs)
    const finish = (error?: Error, result?: ProcessResult): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      if (forceKillTimeout) {
        clearTimeout(forceKillTimeout)
      }
      if (error) {
        reject(error)
      } else if (result) {
        resolve(result)
      }
    }

    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk
      if (Buffer.byteLength(stdout, "utf8") > MAX_EXTERNAL_TEXT_STDIO_BYTES) {
        outputTooLarge = true
        terminateWithEscalation()
      }
    })
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk
      if (Buffer.byteLength(stderr, "utf8") > MAX_EXTERNAL_TEXT_STDIO_BYTES) {
        outputTooLarge = true
        terminateWithEscalation()
      }
    })
    child.on("error", (error) => finish(error))
    child.on("close", (code) => {
      if (timedOut) {
        finish(new Error(`${executable} timed out.`))
        return
      }
      if (outputTooLarge) {
        finish(new Error(`${executable} produced too much output.`))
        return
      }
      if (code !== 0) {
        const detail = stderr.trim()
        finish(new Error(detail ? `${executable} failed: ${detail}` : `${executable} failed.`))
        return
      }
      finish(undefined, { stdout, stderr })
    })
  })
}

function terminateChild(child: ReturnType<typeof spawn>, signal: NodeJS.Signals): void {
  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, signal)
      return
    } catch {
      // The child may have exited before the signal was sent.
    }
  }
  child.kill(signal)
}

function externalCommandEnvironment(): NodeJS.ProcessEnv {
  const allowed = ["HOME", "LANG", "LC_ALL", "PATH", "TEMP", "TMP", "TMPDIR"]
  return Object.fromEntries(
    allowed.flatMap((name) => {
      const value = process.env[name]
      return value === undefined ? [] : [[name, value]]
    }),
  )
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}
