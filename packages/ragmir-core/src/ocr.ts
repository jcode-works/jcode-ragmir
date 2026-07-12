import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { findProjectConfig, loadConfig } from "./config.js"
import { isRecord } from "./guards.js"
import { initProject } from "./init.js"
import { MAX_EXTERNAL_TEXT_STDIO_BYTES } from "./limits.js"
import { rgrCommand } from "./package-manager.js"
import { hardenPrivateFile } from "./permissions.js"

const OCR_COMMAND_TIMEOUT_MS = 120_000
const OCR_PROBE_TIMEOUT_MS = 10_000
const OCR_PROCESS_KILL_GRACE_MS = 1_000
const OCR_RENDER_DPI = 300
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
    "extract-page",
    "--engine",
    engine,
    "--language",
    language,
    "--input",
    "{input}",
    "--page",
    "{page}",
    "--timeout-ms",
    String(timeoutMs),
  ])
  const pdfOcrCommand = [configuredCommand.command, ...configuredCommand.args]
  const projectConfig = findProjectConfig(config.projectRoot)
  const raw: unknown = JSON.parse(await readFile(projectConfig.configPath, "utf8"))
  if (!isRecord(raw)) {
    throw new Error(`${projectConfig.configPath} must contain a JSON object.`)
  }
  const nextConfig = {
    ...raw,
    pdfOcrCommand,
    pdfOcrTimeoutMs: timeoutMs,
  }
  await writeFile(projectConfig.configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8")
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
  if (!Number.isInteger(options.page) || options.page <= 0) {
    throw new Error("PDF page must be a positive integer.")
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
      return await extractWithOcrMyPdf({ input, page: options.page, language, timeoutMs, tempDir })
    }
    return await extractWithTesseract({ input, page: options.page, language, timeoutMs, tempDir })
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
  page: number
  language: string
  timeoutMs: number
  tempDir: string
}): Promise<string> {
  const sidecarPath = path.join(options.tempDir, "page.txt")
  await runProcess(
    "ocrmypdf",
    [
      "--quiet",
      "--force-ocr",
      "--pages",
      String(options.page),
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
  page: number
  language: string
  timeoutMs: number
  tempDir: string
}): Promise<string> {
  const outputPrefix = path.join(options.tempDir, "page")
  await runProcess(
    "pdftoppm",
    [
      "-f",
      String(options.page),
      "-l",
      String(options.page),
      "-singlefile",
      "-r",
      String(OCR_RENDER_DPI),
      "-gray",
      "-png",
      options.input,
      outputPrefix,
    ],
    { timeoutMs: options.timeoutMs },
  )
  const result = await runProcess("tesseract", ["page.png", "stdout", "-l", options.language], {
    cwd: options.tempDir,
    timeoutMs: options.timeoutMs,
  })
  return result.stdout
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
