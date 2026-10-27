import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { createReadStream, existsSync } from "node:fs"
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { findProjectConfig, loadConfig } from "./config.js"
import { removeTree } from "./fs-retry.js"
import { initProject } from "./init.js"
import { MAX_EXTERNAL_TEXT_STDIO_BYTES, MAX_PDF_PAGES } from "./limits.js"
import { rgrCommand } from "./package-manager.js"
import { hardenPrivateFile } from "./permissions.js"
import { mutateProjectConfig } from "./project-config-file.js"

const OCR_COMMAND_TIMEOUT_MS = 120_000
const OCR_PROBE_TIMEOUT_MS = 10_000
const OCR_PROCESS_KILL_GRACE_MS = 1_000
export const OCR_RENDER_DPI = 300
/** Longest rendered page side in pixels: US Legal at 300 DPI, so standard paper keeps 300 DPI. */
const MAX_OCR_RENDER_PIXELS = 4_200
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

  const status = await inspectPdfOcr(cwd)
  const requestedEngine = parsePdfOcrEngine(options.engine, true)
  const engine = resolveEngine(requestedEngine, status)
  const language = normalizeOcrLanguage(options.language)
  assertLanguagesAvailable(language, status.languages)
  const timeoutMs = options.timeoutMs ?? config.pdfOcrTimeoutMs
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("OCR timeout must be a positive integer.")
  }

  const pdfOcrCommand = await portableRunnerCommand(config.projectRoot, [
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
      subprocesses: pages.length + 2,
      pages: pairOcrPageText(
        pages,
        await extractWithTesseract({ input, pages, language, timeoutMs, tempDir }),
      ),
    }
  } finally {
    await removeTree(tempDir)
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
  const longSides = await pdfPageLongSides(options)
  const selectedPages: string[] = []
  for (const pageNumber of options.pages) {
    const outputPrefix = path.join(options.tempDir, `rendered-page-${pageNumber}`)
    // Phone scanners write PDF pages whose size is in pixels, so 300 DPI rendered them at about
    // 58 megapixels, and PNG compression alone took about 26 s per page. The pixel cap and LZW
    // TIFF keep a 16-page batch of such scans well inside the default OCR timeout.
    await runProcess(
      "pdftoppm",
      [
        "-f",
        String(pageNumber),
        "-l",
        String(pageNumber),
        "-r",
        String(ocrRenderDpi(longSides.get(pageNumber))),
        "-gray",
        "-tiff",
        "-tiffcompression",
        "lzw",
        "-singlefile",
        options.input,
        outputPrefix,
      ],
      { timeoutMs: options.timeoutMs },
    )
    const renderedPage = `${outputPrefix}.tif`
    if (!(await stat(renderedPage).catch(() => null))?.isFile()) {
      throw new Error(`Poppler did not render requested PDF page ${pageNumber}.`)
    }
    selectedPages.push(renderedPage)
  }
  const pageListPath = path.join(options.tempDir, "pages.txt")
  await writeFile(pageListPath, `${selectedPages.join("\n")}\n`, "utf8")
  const result = await runProcess("tesseract", [pageListPath, "stdout", "-l", options.language], {
    cwd: options.tempDir,
    timeoutMs: options.timeoutMs,
  })
  return result.stdout
}

/** 300 DPI, lowered so the longest rendered side stays within US Legal at 300 DPI. */
export function ocrRenderDpi(longSidePoints: number | undefined): number {
  if (longSidePoints === undefined || !(longSidePoints > 0)) {
    return OCR_RENDER_DPI
  }
  return Math.max(
    1,
    Math.min(OCR_RENDER_DPI, Math.floor((MAX_OCR_RENDER_PIXELS * 72) / longSidePoints)),
  )
}

/** Longest side, in points, of each requested page; empty when Poppler `pdfinfo` is unavailable. */
async function pdfPageLongSides(options: {
  input: string
  pages: number[]
  timeoutMs: number
}): Promise<Map<number, number>> {
  const longSides = new Map<number, number>()
  const firstPage = options.pages[0]
  const lastPage = options.pages.at(-1)
  if (firstPage === undefined || lastPage === undefined) {
    return longSides
  }
  const result = await runProcess(
    "pdfinfo",
    ["-f", String(firstPage), "-l", String(lastPage), options.input],
    { timeoutMs: options.timeoutMs },
  ).catch(() => null)
  for (const match of result?.stdout.matchAll(
    /^Page\s+(\d+)\s+size:\s+([\d.]+)\s+x\s+([\d.]+)/gmu,
  ) ?? []) {
    longSides.set(Number(match[1]), Math.max(Number(match[2]), Number(match[3])))
  }
  return longSides
}

function pairOcrPageText(pages: number[], output: string): Array<{ page: number; text: string }> {
  const pageTexts = output.replace(/\r\n?/gu, "\n").split("\f")
  if (pageTexts.length === pages.length + 1 && pageTexts.at(-1) === "") {
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
  // Windows programs need their system and profile folders; TESSDATA_PREFIX locates OCR languages.
  const allowed = [
    "HOME",
    "LANG",
    "LC_ALL",
    "PATH",
    "TEMP",
    "TMP",
    "TMPDIR",
    "TESSDATA_PREFIX",
    "SYSTEMROOT",
    "WINDIR",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "PATHEXT",
    "COMSPEC",
  ]
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

export type LegacyWordEngine = "textutil" | "antiword" | "catdoc" | "soffice"

export interface LocalExtractorStatus {
  imageOcr: {
    available: boolean
    tesseract: OcrExecutableStatus
    /** macOS converts HEIC, HEIF, and AVIF photos to PNG before OCR. */
    imageConverter: "sips" | null
    languages: string[]
  }
  legacyWord: {
    recommendedEngine: LegacyWordEngine | null
    engines: Record<LegacyWordEngine, boolean>
  }
}

export interface ConfigureLocalExtractorsOptions {
  cwd?: string
  images?: boolean
  legacyWord?: boolean
  language?: string
  timeoutMs?: number
}

export interface ConfigureLocalExtractorsResult {
  configPath: string
  imageOcrCommand: string[] | null
  legacyWordCommand: string[] | null
}

const IMAGE_FORMATS_NEEDING_CONVERSION = new Set([".avif", ".heic", ".heif"])
const LEGACY_WORD_ENGINE_ORDER: readonly LegacyWordEngine[] = [
  "textutil",
  "antiword",
  "catdoc",
  "soffice",
]

/** Local tools that can read photos and scans (Tesseract) and legacy `.doc` files. */
export async function inspectLocalExtractors(): Promise<LocalExtractorStatus> {
  const [tesseract, sips, ...legacyEngines] = await Promise.all([
    probeExecutable(executablePath("tesseract"), ["--version"]),
    process.platform === "darwin"
      ? probeExecutable("sips", ["--help"])
      : Promise.resolve({ available: false, version: null }),
    ...LEGACY_WORD_ENGINE_ORDER.map((engine) =>
      engine === "textutil" && process.platform !== "darwin"
        ? Promise.resolve({ available: false, version: null })
        : probeExecutable(executablePath(engine), legacyWordProbeArgs(engine)),
    ),
  ])
  const engines = Object.fromEntries(
    LEGACY_WORD_ENGINE_ORDER.map((engine, index) => [
      engine,
      legacyEngines[index]?.available === true,
    ]),
  ) as Record<LegacyWordEngine, boolean>
  return {
    imageOcr: {
      available: tesseract.available,
      tesseract,
      imageConverter: sips.available ? "sips" : null,
      languages: tesseract.available ? await listTesseractLanguages() : [],
    },
    legacyWord: {
      recommendedEngine: LEGACY_WORD_ENGINE_ORDER.find((engine) => engines[engine]) ?? null,
      engines,
    },
  }
}

/**
 * Configure image OCR and legacy Word extraction with Ragmir's own extractors, run through the
 * project runner so the config stays portable across machines and operating systems.
 */
export async function configureLocalExtractors(
  options: ConfigureLocalExtractorsOptions = {},
): Promise<ConfigureLocalExtractorsResult> {
  const cwd = options.cwd ?? process.cwd()
  await initProject(cwd)
  const config = await loadConfig(cwd)
  const status = await inspectLocalExtractors()
  const language = normalizeOcrLanguage(options.language)
  let imageOcrCommand: string[] | null = null
  let legacyWordCommand: string[] | null = null
  if (options.images === true) {
    if (!status.imageOcr.available) {
      throw new Error(
        "Image OCR needs Tesseract. Install it (brew install tesseract, apt install tesseract-ocr, or the Windows installer), then rerun.",
      )
    }
    assertLanguagesAvailable(language, status.imageOcr.languages)
    imageOcrCommand = await portableRunnerCommand(config.projectRoot, [
      "ocr",
      "extract-image",
      "--language",
      language,
      "--input",
      "{input}",
    ])
  }
  if (options.legacyWord === true) {
    const engine = status.legacyWord.recommendedEngine
    if (!engine) {
      throw new Error(
        "Legacy .doc extraction needs textutil (macOS), antiword or catdoc (Linux), or LibreOffice (any platform).",
      )
    }
    legacyWordCommand = await portableRunnerCommand(config.projectRoot, [
      "ocr",
      "extract-doc",
      "--engine",
      engine,
      "--input",
      "{input}",
    ])
  }
  const projectConfig = findProjectConfig(config.projectRoot)
  await mutateProjectConfig(projectConfig, (raw) => {
    if (imageOcrCommand) {
      raw.imageOcrCommand = imageOcrCommand
      if (options.timeoutMs !== undefined) raw.imageOcrTimeoutMs = options.timeoutMs
    }
    if (legacyWordCommand) {
      raw.legacyWordCommand = legacyWordCommand
      if (options.timeoutMs !== undefined) raw.legacyWordTimeoutMs = options.timeoutMs
    }
    return { changed: imageOcrCommand !== null || legacyWordCommand !== null, value: undefined }
  })
  return { configPath: projectConfig.configPath, imageOcrCommand, legacyWordCommand }
}

/** OCR one photo or scanned image with Tesseract; HEIC, HEIF, and AVIF go through PNG first. */
export async function extractImageText(options: {
  input: string
  language?: string
  timeoutMs?: number
}): Promise<string> {
  const language = normalizeOcrLanguage(options.language)
  const timeoutMs = options.timeoutMs ?? OCR_COMMAND_TIMEOUT_MS
  let input = options.input
  let workDir: string | null = null
  try {
    if (IMAGE_FORMATS_NEEDING_CONVERSION.has(path.extname(input).toLowerCase())) {
      if (process.platform !== "darwin") {
        throw new Error(
          "HEIC, HEIF, and AVIF images need conversion to PNG or JPEG before OCR on this platform.",
        )
      }
      workDir = await mkdtemp(path.join(os.tmpdir(), "ragmir-image-ocr-"))
      const converted = path.join(workDir, "page.png")
      await runProcess("sips", ["-s", "format", "png", input, "--out", converted], { timeoutMs })
      input = converted
    }
    const result = await runProcess(
      executablePath("tesseract"),
      [input, "stdout", "-l", language],
      { timeoutMs },
    )
    return result.stdout
  } finally {
    if (workDir) {
      await removeTree(workDir)
    }
  }
}

/** Extract the text of a legacy Word `.doc` file with a local converter. */
export async function extractLegacyWordText(options: {
  input: string
  engine: LegacyWordEngine
  timeoutMs?: number
}): Promise<string> {
  const timeoutMs = options.timeoutMs ?? OCR_COMMAND_TIMEOUT_MS
  switch (options.engine) {
    case "textutil":
      return (
        await runProcess("textutil", ["-convert", "txt", "-stdout", options.input], { timeoutMs })
      ).stdout
    case "antiword":
      return (await runProcess(executablePath("antiword"), [options.input], { timeoutMs })).stdout
    case "catdoc":
      return (await runProcess(executablePath("catdoc"), ["-w", options.input], { timeoutMs }))
        .stdout
    case "soffice": {
      const workDir = await mkdtemp(path.join(os.tmpdir(), "ragmir-legacy-word-"))
      try {
        await runProcess(
          executablePath("soffice"),
          ["--headless", "--convert-to", "txt:Text", "--outdir", workDir, options.input],
          { timeoutMs },
        )
        const output = path.join(
          workDir,
          `${path.basename(options.input, path.extname(options.input))}.txt`,
        )
        return await readFile(output, "utf8")
      } finally {
        await removeTree(workDir)
      }
    }
  }
}

export function parseLegacyWordEngine(value: string): LegacyWordEngine {
  const normalized = value.trim().toLowerCase()
  if (LEGACY_WORD_ENGINE_ORDER.includes(normalized as LegacyWordEngine)) {
    return normalized as LegacyWordEngine
  }
  throw new Error(`Expected one of ${LEGACY_WORD_ENGINE_ORDER.join(", ")}.`)
}

/**
 * The runner command with a project-relative runner path: extractor commands run from the project
 * root, so a committed config works for every clone instead of naming one machine's absolute path.
 */
export async function portableRunnerCommand(
  projectRoot: string,
  args: string[],
): Promise<string[]> {
  const command = await rgrCommand(projectRoot, args)
  const [runner, ...rest] = command.args
  if (command.command === "node" && runner !== undefined && path.isAbsolute(runner)) {
    const relative = path.relative(projectRoot, runner)
    if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
      return ["node", relative.split(path.sep).join("/"), ...rest]
    }
  }
  return [command.command, ...command.args]
}

function legacyWordProbeArgs(engine: LegacyWordEngine): string[] {
  switch (engine) {
    case "textutil":
      return ["-help"]
    case "antiword":
      return ["-h"]
    case "catdoc":
      return ["-V"]
    case "soffice":
      return ["--version"]
  }
}

/**
 * Windows installers for Tesseract and LibreOffice do not always add themselves to PATH, so their
 * default install locations are tried when the bare command is missing there.
 */
function executablePath(command: string): string {
  if (process.platform !== "win32") {
    return command
  }
  const programFiles = process.env.ProgramFiles ?? "C:\\Program Files"
  const candidates: Record<string, string> = {
    tesseract: path.join(programFiles, "Tesseract-OCR", "tesseract.exe"),
    soffice: path.join(programFiles, "LibreOffice", "program", "soffice.exe"),
  }
  const candidate = candidates[command]
  return candidate !== undefined && existsSync(candidate) ? candidate : command
}
