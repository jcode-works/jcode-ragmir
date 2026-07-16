import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import { strFromU8, unzipSync } from "fflate"
import { htmlToText } from "html-to-text"
import readExcelFile from "read-excel-file/node"

import mammoth = require("mammoth")

import { getDocumentProxy } from "unpdf"
import YAML from "yaml"
import { OCR_IMAGE_EXTENSIONS } from "./files.js"
import {
  MAX_EXTERNAL_TEXT_STDIO_BYTES,
  MAX_OFFICE_TEXT_ENTRY_COUNT,
  MAX_OFFICE_XML_ENTRY_BYTES,
  MAX_OFFICE_XML_TOTAL_BYTES,
  MAX_PDF_PAGES,
  MAX_PDF_TEXT_CHARACTERS,
} from "./limits.js"
import { throwIfAborted } from "./operation.js"
import type { ParsedDocument, ParsedPage, SourceFile } from "./types.js"

const EXTERNAL_COMMAND_KILL_GRACE_MS = 2_000
const LONG_BASE64_TEXT_PATTERN = /\b[A-Za-z0-9+/]{240,}={0,2}\b/gu
const OFFICE_TEXT_ENTRY_PATTERN = /\.(?:xml|rels|xhtml|html|htm)$/iu
const HTML_TO_TEXT_OPTIONS = {
  wordwrap: false,
  selectors: [
    { selector: "a", options: { ignoreHref: true } },
    { selector: "img", format: "skip" },
  ],
} satisfies Parameters<typeof htmlToText>[1]

export interface ParseFileOptions {
  projectRoot?: string
  pdfOcrCommand?: string[]
  pdfOcrTimeoutMs?: number
  imageOcrCommand?: string[]
  imageOcrTimeoutMs?: number
  legacyWordCommand?: string[]
  legacyWordTimeoutMs?: number
  signal?: AbortSignal
}

export async function parseFile(
  file: SourceFile,
  options: ParseFileOptions = {},
): Promise<ParsedDocument> {
  throwIfAborted(options.signal)
  let text: string
  let pages: ParsedPage[] | undefined

  switch (file.extension) {
    case ".pdf":
      ;({ text, pages } = await parsePdf(file.absolutePath, options))
      break
    case ".doc":
      text = await parseLegacyWord(file.absolutePath, options)
      break
    case ".docx":
      text = await parseDocx(file.absolutePath)
      break
    case ".pptx":
      text = await parsePptx(file.absolutePath)
      break
    case ".xlsx":
      text = await parseXlsx(file.absolutePath)
      break
    case ".avif":
    case ".bmp":
    case ".gif":
    case ".heic":
    case ".heif":
    case ".jpeg":
    case ".jpg":
    case ".png":
    case ".tif":
    case ".tiff":
    case ".webp":
      text = await parseImage(file.absolutePath, file.extension, options)
      break
    case ".odt":
    case ".ods":
    case ".odp":
      text = await parseOpenDocument(file.absolutePath)
      break
    case ".epub":
      text = await parseEpub(file.absolutePath)
      break
    case ".html":
    case ".htm":
      text = htmlToText(await readFile(file.absolutePath, "utf8"), HTML_TO_TEXT_OPTIONS)
      break
    case ".json":
    case ".ipynb":
      text = JSON.stringify(JSON.parse(await readFile(file.absolutePath, "utf8")), null, 2)
      break
    case ".yaml":
    case ".yml":
      text = YAML.stringify(YAML.parse(await readFile(file.absolutePath, "utf8")))
      break
    case ".rtf":
      text = stripRtf(await readFile(file.absolutePath, "utf8"))
      break
    default:
      text = await readFile(file.absolutePath, "utf8")
  }

  throwIfAborted(options.signal)
  const document: ParsedDocument = { file, text: normalizeText(text) }
  if (pages) {
    document.pages = pages
  }
  return document
}

async function parseDocx(filePath: string): Promise<string> {
  const buffer = await readFile(filePath)
  unzipOfficeFile(buffer)
  const result = await mammoth.extractRawText({ buffer })
  return result.value
}

async function parsePptx(filePath: string): Promise<string> {
  const entries = unzipOfficeFile(await readFile(filePath))
  return xmlEntriesToText(entries, [
    /^ppt\/slides\/slide\d+\.xml$/u,
    /^ppt\/notesSlides\/notesSlide\d+\.xml$/u,
  ])
}

async function parseXlsx(filePath: string): Promise<string> {
  const buffer = await readFile(filePath)
  unzipOfficeFile(buffer)
  const workbook = await readExcelFile(buffer, { trim: false })
  const sheets: string[] = []

  for (const sheet of workbook) {
    const rows = sheet.data.map(spreadsheetRowToText).filter((row) => row.some(Boolean))

    if (rows.length > 0) {
      sheets.push(`# ${sheet.sheet}`, rows.map((row) => row.join("\t")).join("\n"))
    }
  }

  return sheets.join("\n\n")
}

async function parseImage(
  filePath: string,
  extension: string,
  options: ParseFileOptions,
): Promise<string> {
  if (!OCR_IMAGE_EXTENSIONS.has(extension)) {
    return ""
  }
  if (!options.imageOcrCommand || options.imageOcrCommand.length === 0) {
    return ""
  }
  return runExternalTextCommand(filePath, {
    command: options.imageOcrCommand,
    cwd: options.projectRoot,
    label: "OCR command",
    timeoutMs: options.imageOcrTimeoutMs ?? 120_000,
    pathEnvName: "RAGMIR_IMAGE_PATH",
    ...(options.signal ? { signal: options.signal } : {}),
  })
}

async function parseLegacyWord(filePath: string, options: ParseFileOptions): Promise<string> {
  if (!options.legacyWordCommand || options.legacyWordCommand.length === 0) {
    return ""
  }
  return runExternalTextCommand(filePath, {
    command: options.legacyWordCommand,
    cwd: options.projectRoot,
    label: "legacy Word command",
    timeoutMs: options.legacyWordTimeoutMs ?? 120_000,
    pathEnvName: "RAGMIR_LEGACY_WORD_PATH",
    ...(options.signal ? { signal: options.signal } : {}),
  })
}

async function parseOpenDocument(filePath: string): Promise<string> {
  const entries = unzipOfficeFile(await readFile(filePath))
  return xmlEntriesToText(entries, [/^content\.xml$/u, /^meta\.xml$/u])
}

async function parseEpub(filePath: string): Promise<string> {
  const entries = unzipOfficeFile(await readFile(filePath))
  const parts: string[] = []
  for (const [name, content] of [...entries.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (!/\.(?:xhtml|html|htm|xml)$/iu.test(name)) {
      continue
    }
    const text = htmlToText(content, HTML_TO_TEXT_OPTIONS)
    if (text.trim()) {
      parts.push(text)
    }
  }
  return parts.join("\n\n")
}

function unzipOfficeFile(buffer: Buffer): Map<string, string> {
  let textEntryCount = 0
  let totalTextBytes = 0
  let rejectedForSafetyLimit = false
  const unzipped = unzipSync(new Uint8Array(buffer), {
    filter: (file) => {
      if (!OFFICE_TEXT_ENTRY_PATTERN.test(file.name)) {
        return false
      }
      if (file.originalSize > MAX_OFFICE_XML_ENTRY_BYTES) {
        rejectedForSafetyLimit = true
        return false
      }
      textEntryCount += 1
      totalTextBytes += file.originalSize
      if (
        textEntryCount > MAX_OFFICE_TEXT_ENTRY_COUNT ||
        totalTextBytes > MAX_OFFICE_XML_TOTAL_BYTES
      ) {
        rejectedForSafetyLimit = true
        return false
      }
      return true
    },
  })
  if (rejectedForSafetyLimit) {
    throw new Error("Archive text payload exceeds Ragmir safety limits.")
  }

  const entries = new Map<string, string>()
  for (const [name, content] of Object.entries(unzipped)) {
    entries.set(name, strFromU8(content))
  }
  return entries
}

function xmlEntriesToText(entries: Map<string, string>, patterns: RegExp[]): string {
  const parts: string[] = []
  for (const [name, xml] of [...entries.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (patterns.some((pattern) => pattern.test(name))) {
      const text = xmlToText(xml)
      if (text) {
        parts.push(text)
      }
    }
  }
  return parts.join("\n\n")
}

function trimTrailingEmptyValues(values: string[]): string[] {
  let end = values.length
  while (end > 0 && values[end - 1] === "") {
    end -= 1
  }
  return values.slice(0, end)
}

function spreadsheetRowToText(row: readonly unknown[]): string[] {
  return trimTrailingEmptyValues(row.map(spreadsheetCellToText))
}

function spreadsheetCellToText(value: unknown): string {
  if (value === null || value === undefined) {
    return ""
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  return JSON.stringify(value)
}

function xmlToText(xml: string): string {
  return normalizeText(
    decodeXmlEntities(
      xml
        .replace(/<w:tab\/>/gu, " ")
        .replace(/<w:br\/>/gu, "\n")
        .replace(/<\/(?:w:p|a:p|text:p|text:h|table:table-row)>/gu, "\n")
        .replace(/<[^>]+>/gu, " ")
        .replace(/[ \t]{2,}/gu, " "),
    ),
  )
}

function stripRtf(input: string): string {
  return input
    .replace(/\\par[d]?/gu, "\n")
    .replace(/\\'[0-9a-fA-F]{2}/gu, " ")
    .replace(/\\[a-zA-Z]+-?\d* ?/gu, " ")
    .replace(/[{}]/gu, " ")
}

function decodeXmlEntities(input: string): string {
  return input
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, "&")
}

async function parsePdf(
  filePath: string,
  options: ParseFileOptions,
): Promise<{ text: string; pages: ParsedPage[] }> {
  const buffer = await readFile(filePath)
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>
  try {
    pdf = await getDocumentProxy(new Uint8Array(buffer))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    if (/password|encrypted/iu.test(detail)) {
      throw new Error(
        "PDF is encrypted or password-protected. Decrypt an authorized local copy before ingesting it.",
      )
    }
    throw error
  }

  try {
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new Error(`PDF has ${pdf.numPages} pages; the safety limit is ${MAX_PDF_PAGES}.`)
    }

    const pageTexts: string[] = []
    let totalCharacters = 0
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      let pageText = ""
      try {
        const content = await page.getTextContent()
        const items: unknown = content.items
        pageText = (Array.isArray(items) ? items : [])
          .filter(isPdfTextItem)
          .map((item) => `${item.str}${item.hasEOL ? "\n" : ""}`)
          .join("")
      } finally {
        page.cleanup()
      }

      pageText = normalizePdfPageText(pageText)
      if (!pageText && options.pdfOcrCommand && options.pdfOcrCommand.length > 0) {
        pageText = normalizePdfPageText(
          await runExternalTextCommand(filePath, {
            command: options.pdfOcrCommand,
            cwd: options.projectRoot,
            label: `OCR command for PDF page ${pageNumber}`,
            timeoutMs: options.pdfOcrTimeoutMs ?? 120_000,
            pathEnvName: "RAGMIR_PDF_PATH",
            pageNumber,
            ...(options.signal ? { signal: options.signal } : {}),
          }),
        )
      }
      totalCharacters += pageText.length
      if (totalCharacters > MAX_PDF_TEXT_CHARACTERS) {
        throw new Error(`PDF text exceeds the ${MAX_PDF_TEXT_CHARACTERS} character safety limit.`)
      }
      pageTexts.push(pageText)
    }

    return joinPdfPages(pageTexts)
  } finally {
    await pdf.destroy()
  }
}

function isPdfTextItem(value: unknown): value is { str: string; hasEOL?: boolean } {
  return (
    typeof value === "object" && value !== null && "str" in value && typeof value.str === "string"
  )
}

function normalizePdfPageText(text: string): string {
  return normalizeText(text).replace(/([\p{L}\p{N}])-\n([\p{Ll}])/gu, "$1$2")
}

function joinPdfPages(pageTexts: string[]): { text: string; pages: ParsedPage[] } {
  let text = ""
  const pages: ParsedPage[] = []
  for (const [index, pageText] of pageTexts.entries()) {
    if (index > 0) {
      text += "\n\n"
    }
    const charStart = text.length
    text += pageText
    pages.push({ pageNumber: index + 1, charStart, charEnd: text.length })
  }
  return { text, pages }
}

interface ExternalTextCommandOptions {
  command?: string[]
  cwd?: string | undefined
  label: string
  timeoutMs: number
  pathEnvName: "RAGMIR_IMAGE_PATH" | "RAGMIR_LEGACY_WORD_PATH" | "RAGMIR_PDF_PATH"
  pageNumber?: number
  signal?: AbortSignal
}

async function runExternalTextCommand(
  filePath: string,
  options: ExternalTextCommandOptions,
): Promise<string> {
  throwIfAborted(options.signal)
  const command = options.command ?? []
  const [executable, ...configuredArgs] = command
  if (!executable) {
    return ""
  }

  const hasInputPlaceholder = command.some((part) => part.includes("{input}"))
  const args = configuredArgs.map((part) => part.replaceAll("{input}", filePath))
  const pageNumber = options.pageNumber === undefined ? "" : String(options.pageNumber)
  for (const [index, arg] of args.entries()) {
    args[index] = arg.replaceAll("{page}", pageNumber)
  }
  if (!hasInputPlaceholder) {
    args.push(filePath)
  }

  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      detached: process.platform !== "win32",
      env: {
        ...externalCommandEnvironment(),
        [options.pathEnvName]: filePath,
        ...(options.pageNumber === undefined ? {} : { RAGMIR_PDF_PAGE: pageNumber }),
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let capturedBytes = 0
    let didTimeout = false
    let didAbort = false
    let outputTooLarge = false
    let terminationStarted = false
    let settled = false
    let forceKillTimeout: ReturnType<typeof setTimeout> | undefined
    let abortListener: (() => void) | undefined
    const cleanup = (): void => {
      clearTimeout(timeout)
      if (forceKillTimeout) {
        clearTimeout(forceKillTimeout)
      }
      if (abortListener) {
        options.signal?.removeEventListener("abort", abortListener)
      }
    }
    const rejectOnce = (error: Error): void => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      reject(error)
    }
    const terminateWithEscalation = (): void => {
      if (terminationStarted) {
        return
      }
      terminationStarted = true
      terminateChild(child, "SIGTERM")
      forceKillTimeout = setTimeout(
        () => terminateChild(child, "SIGKILL"),
        EXTERNAL_COMMAND_KILL_GRACE_MS,
      )
    }
    const timeout = setTimeout(() => {
      didTimeout = true
      terminateWithEscalation()
    }, options.timeoutMs)
    abortListener = () => {
      didAbort = true
      terminateWithEscalation()
    }
    if (options.signal?.aborted) {
      abortListener()
    } else {
      options.signal?.addEventListener("abort", abortListener, { once: true })
    }

    const captureOutput = (chunk: Buffer, chunks: Buffer[]): void => {
      if (outputTooLarge) {
        return
      }
      const remainingBytes = MAX_EXTERNAL_TEXT_STDIO_BYTES - capturedBytes
      if (chunk.byteLength > remainingBytes) {
        if (remainingBytes > 0) {
          chunks.push(chunk.subarray(0, remainingBytes))
          capturedBytes += remainingBytes
        }
        outputTooLarge = true
        clearTimeout(timeout)
        terminateWithEscalation()
        return
      }
      chunks.push(chunk)
      capturedBytes += chunk.byteLength
    }
    child.stdout.on("data", (chunk: Buffer) => captureOutput(chunk, stdoutChunks))
    child.stderr.on("data", (chunk: Buffer) => captureOutput(chunk, stderrChunks))
    child.on("error", (error) => {
      rejectOnce(new Error(`${options.label} failed to start: ${error.message}`))
    })
    child.on("close", (code) => {
      if (settled) {
        return
      }
      const stdout = Buffer.concat(stdoutChunks).toString("utf8")
      const stderr = Buffer.concat(stderrChunks).toString("utf8")
      if (didAbort) {
        try {
          throwIfAborted(options.signal)
        } catch (error) {
          rejectOnce(error instanceof Error ? error : new Error(`${options.label} was aborted.`))
        }
        return
      }
      if (didTimeout) {
        rejectOnce(new Error(`${options.label} timed out.`))
        return
      }
      if (outputTooLarge) {
        rejectOnce(new Error(`${options.label} produced too much output.`))
        return
      }
      if (code !== 0) {
        const detail = stderr.trim()
        rejectOnce(
          new Error(detail ? `${options.label} failed: ${detail}` : `${options.label} failed.`),
        )
        return
      }
      settled = true
      cleanup()
      resolve(stdout)
    })
  })
}

function terminateChild(child: ReturnType<typeof spawn>, signal: NodeJS.Signals): void {
  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, signal)
      return
    } catch {
      // The child may have exited between the timer and the signal.
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

function normalizeText(input: string): string {
  return input
    .replace(LONG_BASE64_TEXT_PATTERN, " ")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
}
