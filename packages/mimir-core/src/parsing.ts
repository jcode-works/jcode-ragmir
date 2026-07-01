import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import { strFromU8, unzipSync } from "fflate"
import { htmlToText } from "html-to-text"
import readExcelFile from "read-excel-file/node"

import mammoth = require("mammoth")

import { extractText, getDocumentProxy } from "unpdf"
import YAML from "yaml"
import type { ParsedDocument, SourceFile } from "./types.js"

const MAX_OFFICE_XML_ENTRY_BYTES = 25_000_000
const MAX_EXTERNAL_TEXT_STDIO_BYTES = 25_000_000
const LONG_BASE64_TEXT_PATTERN = /\b[A-Za-z0-9+/]{240,}={0,2}\b/gu

export interface ParseFileOptions {
  projectRoot?: string
  pdfOcrCommand?: string[]
  pdfOcrTimeoutMs?: number
  imageOcrCommand?: string[]
  imageOcrTimeoutMs?: number
  legacyWordCommand?: string[]
  legacyWordTimeoutMs?: number
}

const OCR_IMAGE_EXTENSIONS = new Set([
  ".avif",
  ".bmp",
  ".gif",
  ".heic",
  ".heif",
  ".jpeg",
  ".jpg",
  ".png",
  ".tif",
  ".tiff",
  ".webp",
])

export async function parseFile(
  file: SourceFile,
  options: ParseFileOptions = {},
): Promise<ParsedDocument> {
  let text: string

  switch (file.extension) {
    case ".pdf":
      text = await parsePdf(file.absolutePath, options)
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
      text = htmlToText(await readFile(file.absolutePath, "utf8"), {
        wordwrap: false,
        selectors: [
          { selector: "a", options: { ignoreHref: true } },
          { selector: "img", format: "skip" },
        ],
      })
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

  return { file, text: normalizeText(text) }
}

async function parseDocx(filePath: string): Promise<string> {
  const result = await mammoth.extractRawText({ path: filePath })
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
  const workbook = await readExcelFile(filePath, { trim: false })
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
    pathEnvName: "MIMIR_IMAGE_PATH",
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
    pathEnvName: "MIMIR_LEGACY_WORD_PATH",
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
    const text = htmlToText(content, {
      wordwrap: false,
      selectors: [
        { selector: "a", options: { ignoreHref: true } },
        { selector: "img", format: "skip" },
      ],
    })
    if (text.trim()) {
      parts.push(text)
    }
  }
  return parts.join("\n\n")
}

function unzipOfficeFile(buffer: Buffer): Map<string, string> {
  const unzipped = unzipSync(new Uint8Array(buffer), {
    filter: (file) => file.originalSize <= MAX_OFFICE_XML_ENTRY_BYTES,
  })
  const entries = new Map<string, string>()
  for (const [name, content] of Object.entries(unzipped)) {
    if (/\.(?:xml|rels|xhtml|html|htm)$/iu.test(name)) {
      entries.set(name, strFromU8(content))
    }
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

async function parsePdf(filePath: string, options: ParseFileOptions): Promise<string> {
  const buffer = await readFile(filePath)
  const pdf = await getDocumentProxy(new Uint8Array(buffer))
  const result = await extractText(pdf, { mergePages: true })
  if (normalizeText(result.text)) {
    return result.text
  }
  if (!options.pdfOcrCommand || options.pdfOcrCommand.length === 0) {
    return result.text
  }
  return runExternalTextCommand(filePath, {
    command: options.pdfOcrCommand,
    cwd: options.projectRoot,
    label: "OCR command",
    timeoutMs: options.pdfOcrTimeoutMs ?? 120_000,
    pathEnvName: "MIMIR_PDF_PATH",
  })
}

interface ExternalTextCommandOptions {
  command?: string[]
  cwd?: string | undefined
  label: string
  timeoutMs: number
  pathEnvName: "MIMIR_IMAGE_PATH" | "MIMIR_LEGACY_WORD_PATH" | "MIMIR_PDF_PATH"
}

async function runExternalTextCommand(
  filePath: string,
  options: ExternalTextCommandOptions,
): Promise<string> {
  const command = options.command ?? []
  const [executable, ...configuredArgs] = command
  if (!executable) {
    return ""
  }

  const hasInputPlaceholder = command.some((part) => part.includes("{input}"))
  const args = configuredArgs.map((part) => part.replaceAll("{input}", filePath))
  if (!hasInputPlaceholder) {
    args.push(filePath)
  }

  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: { ...process.env, [options.pathEnvName]: filePath },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    let didTimeout = false
    let outputTooLarge = false
    const timeout = setTimeout(() => {
      didTimeout = true
      child.kill("SIGTERM")
    }, options.timeoutMs)

    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk
      if (Buffer.byteLength(stdout, "utf8") > MAX_EXTERNAL_TEXT_STDIO_BYTES) {
        outputTooLarge = true
        child.kill("SIGTERM")
      }
    })
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk
      if (Buffer.byteLength(stderr, "utf8") > MAX_EXTERNAL_TEXT_STDIO_BYTES) {
        outputTooLarge = true
        child.kill("SIGTERM")
      }
    })
    child.on("error", (error) => {
      clearTimeout(timeout)
      reject(new Error(`${options.label} failed to start: ${error.message}`))
    })
    child.on("close", (code) => {
      clearTimeout(timeout)
      if (didTimeout) {
        reject(new Error(`${options.label} timed out.`))
        return
      }
      if (outputTooLarge) {
        reject(new Error(`${options.label} produced too much output.`))
        return
      }
      if (code !== 0) {
        const detail = stderr.trim()
        reject(
          new Error(detail ? `${options.label} failed: ${detail}` : `${options.label} failed.`),
        )
        return
      }
      resolve(stdout)
    })
  })
}

function normalizeText(input: string): string {
  return input
    .replace(LONG_BASE64_TEXT_PATTERN, " ")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
}
