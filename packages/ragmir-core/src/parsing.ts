import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { strFromU8, unzipSync } from "fflate"
import { htmlToText } from "html-to-text"
import readExcelFile from "read-excel-file/node"

import mammoth = require("mammoth")

import { getDocumentProxy } from "unpdf"
import YAML from "yaml"
import { OCR_IMAGE_EXTENSIONS } from "./files.js"
import { isRecord } from "./guards.js"
import {
  MAX_EXTERNAL_TEXT_STDIO_BYTES,
  MAX_OFFICE_TEXT_ENTRY_COUNT,
  MAX_OFFICE_XML_ENTRY_BYTES,
  MAX_OFFICE_XML_TOTAL_BYTES,
  MAX_PDF_PAGES,
  MAX_PDF_TEXT_CHARACTERS,
} from "./limits.js"
import { MAX_OCR_BATCH_PAGES, pdfOcrCommandIdentity } from "./ocr.js"
import {
  PDF_OCR_PARSER_POLICY,
  type PdfOcrCacheIdentity,
  readPdfOcrCache,
  writePdfOcrCache,
} from "./ocr-cache.js"
import { throwIfAborted } from "./operation.js"
import type {
  ParsedDocument,
  ParsedPage,
  ParsedRegion,
  PdfOcrMetrics,
  SourceFile,
  SourceLocation,
} from "./types.js"

const EXTERNAL_COMMAND_KILL_GRACE_MS = 2_000
const LONG_BASE64_TEXT_PATTERN = /\b[A-Za-z0-9+/]{240,}={0,2}\b/gu
const OFFICE_TEXT_ENTRY_PATTERN = /\.(?:xml|rels|xhtml|html|htm|opf)$/iu
const NATURAL_PATH_ORDER = new Intl.Collator("en", { numeric: true, sensitivity: "base" })
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
  let regions: ParsedRegion[] | undefined
  let ocr: PdfOcrMetrics | undefined
  let sourceLineCoordinates = false

  switch (file.extension) {
    case ".pdf":
      ;({ text, pages, regions, ocr } = await parsePdf(file, options))
      break
    case ".doc":
      text = await parseLegacyWord(file.absolutePath, options)
      break
    case ".docx":
      text = await parseDocx(file.absolutePath)
      break
    case ".pptx":
      ;({ text, regions } = await parsePptx(file.absolutePath))
      break
    case ".xlsx":
      ;({ text, regions } = await parseXlsx(file.absolutePath))
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
      ;({ text, regions } = await parseEpub(file.absolutePath))
      break
    case ".html":
    case ".htm":
      text = htmlToText(await readFile(file.absolutePath, "utf8"), HTML_TO_TEXT_OPTIONS)
      break
    case ".json":
    case ".ipynb": {
      text = JSON.stringify(JSON.parse(await readFile(file.absolutePath, "utf8")), null, 2)
      break
    }
    case ".yaml":
    case ".yml": {
      text = YAML.stringify(YAML.parse(await readFile(file.absolutePath, "utf8")))
      break
    }
    case ".rtf":
      text = stripRtf(await readFile(file.absolutePath, "utf8"))
      break
    default:
      text = await readFile(file.absolutePath, "utf8")
      sourceLineCoordinates = true
  }

  throwIfAborted(options.signal)
  const document: ParsedDocument = {
    file,
    text: regions ? text : normalizeText(text, sourceLineCoordinates),
    sourceLineCoordinates,
  }
  if (pages) {
    document.pages = pages
  }
  if (regions) {
    document.regions = regions
  }
  if (ocr) {
    document.ocr = ocr
  }
  return document
}

async function parseDocx(filePath: string): Promise<string> {
  const buffer = await readFile(filePath)
  unzipOfficeFile(buffer)
  const result = await mammoth.extractRawText({ buffer })
  return result.value
}

async function parsePptx(filePath: string): Promise<{ text: string; regions: ParsedRegion[] }> {
  const entries = unzipOfficeFile(await readFile(filePath))
  const slides = orderedPresentationSlides(entries)
  const notes = new Map(
    numberedOfficeParts(entries, /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/u).map((part) => [
      part.number,
      part.text,
    ]),
  )
  const parts = slides.flatMap((slide, index) => {
    const noteText = presentationSlideNotes(entries, slide.number) ?? notes.get(slide.number) ?? ""
    const text = [slide.text, noteText].filter(Boolean).join("\n\n")
    const slideNumber = index + 1
    return text
      ? [
          {
            text,
            contextPath: `Slide ${slideNumber}`,
            location: {
              kind: "slide" as const,
              start: slideNumber,
              end: slideNumber,
            },
          },
        ]
      : []
  })
  return joinLocatedParts(parts)
}

function presentationSlideNotes(entries: Map<string, string>, slideNumber: number): string | null {
  const relationships = entries.get(`ppt/slides/_rels/slide${slideNumber}.xml.rels`)
  if (!relationships) {
    return null
  }

  for (const relationship of xmlStartTags(relationships, "Relationship")) {
    const target = xmlAttribute(relationship, "Target")
    if (!target) {
      continue
    }
    const entry = path.posix.normalize(path.posix.join("ppt/slides", target))
    if (!/^ppt\/notesSlides\/notesSlide\d+\.xml$/u.test(entry)) {
      continue
    }
    const xml = entries.get(entry)
    if (xml) {
      return xmlToText(xml)
    }
  }
  return null
}

async function parseXlsx(filePath: string): Promise<{ text: string; regions: ParsedRegion[] }> {
  const buffer = await readFile(filePath)
  unzipOfficeFile(buffer)
  const workbook = await readExcelFile(buffer, { trim: false })
  const parts: Array<{ text: string; contextPath: string; location: SourceLocation }> = []

  for (const [sheetIndex, sheet] of workbook.entries()) {
    let firstRow = true
    for (const [rowIndex, rawRow] of sheet.data.entries()) {
      const row = spreadsheetRowToText(rawRow)
      const firstColumn = row.findIndex(Boolean)
      if (firstColumn < 0) {
        continue
      }
      const lastColumn = lastNonEmptyIndex(row)
      const rowNumber = rowIndex + 1
      parts.push({
        text: `${firstRow ? `# ${sheet.sheet}\n` : ""}${row.join("\t")}`,
        contextPath: `Sheet: ${sheet.sheet}`,
        location: {
          kind: "sheet",
          start: sheetIndex + 1,
          end: sheetIndex + 1,
          label: sheet.sheet,
          cellStart: `${spreadsheetColumnName(firstColumn + 1)}${rowNumber}`,
          cellEnd: `${spreadsheetColumnName(lastColumn + 1)}${rowNumber}`,
        },
      })
      firstRow = false
    }
  }

  return joinLocatedParts(parts)
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

async function parseEpub(filePath: string): Promise<{ text: string; regions: ParsedRegion[] }> {
  const entries = unzipOfficeFile(await readFile(filePath))
  const orderedEntries = epubReadingOrder(entries)
  const parts = orderedEntries.flatMap((name, index) => {
    const content = entries.get(name)
    if (content === undefined) {
      return []
    }
    const text = htmlToText(content, HTML_TO_TEXT_OPTIONS)
    return text.trim()
      ? [
          {
            text,
            contextPath: `EPUB: ${name}`,
            location: {
              kind: "epub" as const,
              start: index + 1,
              end: index + 1,
              label: name,
            },
          },
        ]
      : []
  })
  return joinLocatedParts(parts)
}

function numberedOfficeParts(
  entries: Map<string, string>,
  pattern: RegExp,
): Array<{ number: number; text: string }> {
  return [...entries.entries()]
    .flatMap(([name, xml]) => {
      const match = pattern.exec(name)
      const number = Number(match?.[1])
      const text = match && Number.isSafeInteger(number) && number > 0 ? xmlToText(xml) : ""
      return text ? [{ number, text }] : []
    })
    .sort((left, right) => left.number - right.number)
}

function orderedPresentationSlides(
  entries: Map<string, string>,
): Array<{ number: number; text: string }> {
  const natural = numberedOfficeParts(entries, /^ppt\/slides\/slide(\d+)\.xml$/u)
  const presentation = entries.get("ppt/presentation.xml")
  const relationships = entries.get("ppt/_rels/presentation.xml.rels")
  if (!presentation || !relationships) {
    return natural
  }

  const targets = new Map<string, string>()
  for (const relationship of xmlStartTags(relationships, "Relationship")) {
    const id = xmlAttribute(relationship, "Id")
    const target = xmlAttribute(relationship, "Target")
    if (id && target) {
      targets.set(id, path.posix.normalize(path.posix.join("ppt", target)))
    }
  }
  const byNumber = new Map(natural.map((slide) => [slide.number, slide]))
  const ordered = xmlStartTags(presentation, "sldId").flatMap((slide) => {
    const relationshipId = xmlAttribute(slide, "r:id")
    const target = relationshipId ? targets.get(relationshipId) : undefined
    const match = target ? /^ppt\/slides\/slide(\d+)\.xml$/u.exec(target) : null
    const number = Number(match?.[1])
    const part = Number.isSafeInteger(number) ? byNumber.get(number) : undefined
    if (!part) {
      return []
    }
    byNumber.delete(number)
    return [part]
  })
  return ordered.length > 0 ? [...ordered, ...byNumber.values()] : natural
}

function joinLocatedParts(
  parts: Array<{ text: string; contextPath: string; location: SourceLocation }>,
): { text: string; regions: ParsedRegion[] } {
  let text = ""
  const regions: ParsedRegion[] = []
  for (const part of parts) {
    const normalized = normalizeText(part.text)
    if (!normalized) {
      continue
    }
    if (text) {
      text += "\n\n"
    }
    const charStart = text.length
    text += normalized
    regions.push({
      charStart,
      charEnd: text.length,
      contextPath: part.contextPath,
      location: part.location,
    })
  }
  return { text, regions }
}

function epubReadingOrder(entries: Map<string, string>): string[] {
  const htmlEntries = [...entries.keys()]
    .filter((name) => /\.(?:xhtml|html|htm)$/iu.test(name))
    .sort((left, right) => NATURAL_PATH_ORDER.compare(left, right))
  const containerPath = [...entries.keys()].find(
    (name) => name.toLowerCase() === "meta-inf/container.xml",
  )
  const container = containerPath ? entries.get(containerPath) : undefined
  const packagePath = container ? firstXmlAttribute(container, "rootfile", "full-path") : null
  const packageXml = packagePath ? entries.get(packagePath) : undefined
  if (!packagePath || !packageXml) {
    return htmlEntries
  }

  const packageDirectory = path.posix.dirname(packagePath)
  const manifest = new Map<string, string>()
  for (const element of xmlStartTags(packageXml, "item")) {
    const id = xmlAttribute(element, "id")
    const href = xmlAttribute(element, "href")
    if (id && href) {
      manifest.set(id, resolveEpubEntry(packageDirectory, href))
    }
  }
  const spine = xmlStartTags(packageXml, "itemref").flatMap((element) => {
    const id = xmlAttribute(element, "idref")
    const entry = id ? manifest.get(id) : undefined
    return entry && entries.has(entry) ? [entry] : []
  })
  return spine.length > 0 ? [...new Set(spine)] : htmlEntries
}

function resolveEpubEntry(packageDirectory: string, href: string): string {
  const withoutFragment = href.split("#", 1)[0] ?? href
  let decoded = withoutFragment
  try {
    decoded = decodeURIComponent(withoutFragment)
  } catch {
    // Keep the literal manifest path when percent encoding is malformed.
  }
  return path.posix.normalize(path.posix.join(packageDirectory, decoded))
}

function xmlStartTags(xml: string, localName: string): string[] {
  return [...xml.matchAll(new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${localName}\\b[^>]*>`, "giu"))].map(
    (match) => match[0],
  )
}

function firstXmlAttribute(xml: string, element: string, attribute: string): string | null {
  const tag = xmlStartTags(xml, element)[0]
  return tag ? xmlAttribute(tag, attribute) : null
}

function xmlAttribute(element: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "iu").exec(element)
  return match?.[2] ? decodeXmlEntities(match[2]) : null
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

function spreadsheetColumnName(column: number): string {
  let current = column
  let name = ""
  while (current > 0) {
    current -= 1
    name = String.fromCharCode(65 + (current % 26)) + name
    current = Math.floor(current / 26)
  }
  return name
}

function lastNonEmptyIndex(values: string[]): number {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (values[index]) {
      return index
    }
  }
  return -1
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
  file: SourceFile,
  options: ParseFileOptions,
): Promise<{
  text: string
  pages: ParsedPage[]
  regions: ParsedRegion[]
  ocr?: PdfOcrMetrics
}> {
  const buffer = await readFile(file.absolutePath)
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

  const pageTexts: string[] = []
  try {
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new Error(`PDF has ${pdf.numPages} pages; the safety limit is ${MAX_PDF_PAGES}.`)
    }

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
      pageTexts.push(pageText)
    }
  } finally {
    await pdf.destroy()
  }

  const blankPages = pageTexts.flatMap((text, index) => (text ? [] : [index + 1]))
  const ocr =
    blankPages.length > 0 && options.pdfOcrCommand && options.pdfOcrCommand.length > 0
      ? await fillPdfOcrPages(file, pageTexts, blankPages, options)
      : undefined
  const totalCharacters = pageTexts.reduce((total, pageText) => total + pageText.length, 0)
  if (totalCharacters > MAX_PDF_TEXT_CHARACTERS) {
    throw new Error(`PDF text exceeds the ${MAX_PDF_TEXT_CHARACTERS} character safety limit.`)
  }
  return { ...joinPdfPages(pageTexts), ...(ocr ? { ocr } : {}) }
}

async function fillPdfOcrPages(
  file: SourceFile,
  pageTexts: string[],
  blankPages: number[],
  options: ParseFileOptions,
): Promise<PdfOcrMetrics> {
  const startedAt = performance.now()
  const command = options.pdfOcrCommand ?? []
  const projectRoot = options.projectRoot ?? path.dirname(file.absolutePath)
  const commandIdentity = await pdfOcrCommandIdentity(command, projectRoot)
  const metrics: PdfOcrMetrics = {
    pages: blankPages.length,
    cacheHits: 0,
    cacheMisses: 0,
    batches: 0,
    subprocesses: commandIdentity.subprocesses,
    durationMs: 0,
  }
  const missingPages: number[] = []

  for (const pageNumber of blankPages) {
    const cached = await readPdfOcrCache(
      projectRoot,
      pdfOcrCacheIdentity(file.checksum, pageNumber, commandIdentity),
    )
    if (cached === null) {
      metrics.cacheMisses += 1
      missingPages.push(pageNumber)
    } else {
      metrics.cacheHits += 1
      pageTexts[pageNumber - 1] = cached
    }
  }

  if (commandIdentity.supportsBatch) {
    for (const batch of pdfOcrPageBatches(missingPages)) {
      const output = await runExternalTextCommand(file.absolutePath, {
        command,
        cwd: options.projectRoot,
        label: `OCR command for PDF pages ${batch.join(",")}`,
        timeoutMs: options.pdfOcrTimeoutMs ?? 120_000,
        pathEnvName: "RAGMIR_PDF_PATH",
        pageNumbers: batch,
        ...(options.signal ? { signal: options.signal } : {}),
      })
      const result = parsePdfOcrBatchOutput(output, batch)
      metrics.batches += 1
      metrics.subprocesses += 1 + result.subprocesses
      for (const page of result.pages) {
        const text = normalizePdfPageText(page.text)
        pageTexts[page.page - 1] = text
        await writePdfOcrCache(
          projectRoot,
          pdfOcrCacheIdentity(file.checksum, page.page, commandIdentity),
          text,
        )
      }
    }
  } else {
    for (const pageNumber of missingPages) {
      const text = normalizePdfPageText(
        await runExternalTextCommand(file.absolutePath, {
          command,
          cwd: options.projectRoot,
          label: `OCR command for PDF page ${pageNumber}`,
          timeoutMs: options.pdfOcrTimeoutMs ?? 120_000,
          pathEnvName: "RAGMIR_PDF_PATH",
          pageNumber,
          ...(options.signal ? { signal: options.signal } : {}),
        }),
      )
      metrics.batches += 1
      metrics.subprocesses += 1
      pageTexts[pageNumber - 1] = text
      await writePdfOcrCache(
        projectRoot,
        pdfOcrCacheIdentity(file.checksum, pageNumber, commandIdentity),
        text,
      )
    }
  }

  metrics.durationMs = Math.round((performance.now() - startedAt) * 1_000) / 1_000
  return metrics
}

function pdfOcrCacheIdentity(
  sourceChecksum: string,
  page: number,
  command: Awaited<ReturnType<typeof pdfOcrCommandIdentity>>,
): PdfOcrCacheIdentity {
  return {
    sourceChecksum,
    page,
    engine: command.engine,
    engineVersion: command.engineVersion,
    language: command.language,
    dpi: command.dpi,
    parserPolicy: PDF_OCR_PARSER_POLICY,
    commandFingerprint: command.commandFingerprint,
  }
}

function pdfOcrPageBatches(pages: number[]): number[][] {
  const batches: number[][] = []
  for (const page of pages) {
    const current = batches.at(-1)
    if (
      !current ||
      current.length >= MAX_OCR_BATCH_PAGES ||
      page - (current[0] ?? page) >= MAX_OCR_BATCH_PAGES
    ) {
      batches.push([page])
    } else {
      current.push(page)
    }
  }
  return batches
}

function parsePdfOcrBatchOutput(
  output: string,
  requestedPages: number[],
): { pages: Array<{ page: number; text: string }>; subprocesses: number } {
  let value: unknown
  try {
    value = JSON.parse(output)
  } catch {
    throw new Error("Batched PDF OCR command returned invalid JSON.")
  }
  if (!isRecord(value)) {
    throw new Error("Batched PDF OCR command returned an invalid result.")
  }
  if (
    !Number.isInteger(value.subprocesses) ||
    Number(value.subprocesses) < 0 ||
    Number(value.subprocesses) > 100 ||
    !Array.isArray(value.pages)
  ) {
    throw new Error("Batched PDF OCR command returned invalid process diagnostics.")
  }
  const pages = value.pages.flatMap((entry) => {
    if (isRecord(entry) && Number.isInteger(entry.page) && typeof entry.text === "string") {
      return [
        {
          page: Number(entry.page),
          text: entry.text,
        },
      ]
    }
    return []
  })
  if (
    pages.length !== requestedPages.length ||
    pages.some((page, index) => page.page !== requestedPages[index])
  ) {
    throw new Error("Batched PDF OCR command returned pages outside the requested ordered batch.")
  }
  return { pages, subprocesses: Number(value.subprocesses) }
}

function isPdfTextItem(value: unknown): value is { str: string; hasEOL?: boolean } {
  return (
    typeof value === "object" && value !== null && "str" in value && typeof value.str === "string"
  )
}

function normalizePdfPageText(text: string): string {
  return normalizeText(text).replace(/([\p{L}\p{N}])-\n([\p{Ll}])/gu, "$1$2")
}

function joinPdfPages(pageTexts: string[]): {
  text: string
  pages: ParsedPage[]
  regions: ParsedRegion[]
} {
  let text = ""
  const pages: ParsedPage[] = []
  const regions: ParsedRegion[] = []
  for (const [index, pageText] of pageTexts.entries()) {
    if (index > 0) {
      text += "\n\n"
    }
    const charStart = text.length
    text += pageText
    const pageNumber = index + 1
    pages.push({ pageNumber, charStart, charEnd: text.length })
    regions.push({
      charStart,
      charEnd: text.length,
      contextPath: `Page ${pageNumber}`,
      location: { kind: "page", start: pageNumber, end: pageNumber },
    })
  }
  return { text, pages, regions }
}

interface ExternalTextCommandOptions {
  command?: string[]
  cwd?: string | undefined
  label: string
  timeoutMs: number
  pathEnvName: "RAGMIR_IMAGE_PATH" | "RAGMIR_LEGACY_WORD_PATH" | "RAGMIR_PDF_PATH"
  pageNumber?: number
  pageNumbers?: number[]
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
  const pageNumbers = options.pageNumbers?.join(",") ?? ""
  for (const [index, arg] of args.entries()) {
    args[index] = arg.replaceAll("{page}", pageNumber).replaceAll("{pages}", pageNumbers)
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
        ...(options.pageNumbers === undefined ? {} : { RAGMIR_PDF_PAGES: pageNumbers }),
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

function normalizeText(input: string, preserveSourceLines = false): string {
  const normalized = input.replace(LONG_BASE64_TEXT_PATTERN, " ").replace(/\r\n?/gu, "\n")
  if (preserveSourceLines) {
    return normalized.replace(/[ \t]+\n/gu, "\n").trimEnd()
  }
  return normalized
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
}
