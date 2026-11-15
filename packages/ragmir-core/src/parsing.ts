import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { strFromU8, type UnzipFileInfo, unzipSync } from "fflate"
import { htmlToText } from "html-to-text"
import readExcelFile from "read-excel-file/node"

import mammoth = require("mammoth")

import { getDocumentProxy } from "unpdf"
import YAML from "yaml"
import { jsonExportSections } from "./data-exports.js"
import { sketchSections } from "./design-formats.js"
import { figmaFileSections } from "./figma-file.js"
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
import { emlText, emlxText, mboxSections, mhtmlText } from "./mail.js"
import { evernoteSections, fictionBookSections } from "./note-exports.js"
import { MAX_OCR_BATCH_PAGES, pdfOcrCommandIdentity } from "./ocr.js"
import {
  PDF_OCR_PARSER_POLICY,
  type PdfOcrCacheIdentity,
  readPdfOcrCache,
  writePdfOcrCache,
} from "./ocr-cache.js"
import { throwIfAborted } from "./operation.js"
import { outlookMessageText } from "./outlook-msg.js"
import {
  boundedSections,
  detectStructuredXml,
  drawioFromSvg,
  type StructuredSection,
  type StructuredXmlFormat,
  structuredXmlSections,
  visioSections,
} from "./structured-formats.js"
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
const OFFICE_TEXT_ENTRY_PATTERN = /\.(?:xml|rels|xhtml|html|htm|opf|twb)$/iu
// A Sketch document keeps its pages as JSON; previews and images stay compressed.
const SKETCH_TEXT_ENTRY_PATTERN = /^(?:pages\/[^/]+|document|meta)\.json$/u
// Flat OpenDocument files hold the body and metadata next to styles and settings, which are noise.
const FLAT_OPENDOCUMENT_PARTS = /<office:(meta|body)\b[\s\S]*?<\/office:\1>/gu
// Extensions whose content is a known structured export; generic `.xml` is detected by content.
const STRUCTURED_XML_EXTENSIONS: Record<string, StructuredXmlFormat> = {
  ".archimate": "archimate",
  ".bpm": "powerdesigner",
  ".bpmn": "bpmn",
  ".cdm": "powerdesigner",
  ".dio": "drawio",
  ".dmn": "dmn",
  ".drawio": "drawio",
  ".ldm": "powerdesigner",
  ".mcd": "powerdesigner",
  ".mpd": "powerdesigner",
  ".oom": "powerdesigner",
  ".pdm": "powerdesigner",
  ".twb": "tableau",
  ".xmi": "xmi",
}
const POWERDESIGNER_EXTENSIONS = new Set([".bpm", ".cdm", ".ldm", ".mcd", ".mpd", ".oom", ".pdm"])
const CHART_PART_PATTERN = /\/charts\/chart\d+\.xml$/u
// Points listed per chart series; larger series keep a count of the rest.
const MAX_CHART_POINTS = 200
// Go template actions mark a Helm chart template, which is YAML only once rendered.
const HELM_TEMPLATE_MARKER = /\{\{-?\s*[^}]*\}\}/u
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
    // Macro-enabled documents and templates share the Office Open XML layout of their family.
    case ".docx":
    case ".docm":
    case ".dotx":
    case ".dotm":
      text = await parseDocx(file.absolutePath, options.signal)
      break
    case ".pptx":
    case ".pptm":
    case ".potx":
    case ".potm":
    case ".ppsx":
    case ".ppsm":
      ;({ text, regions } = await parsePptx(file.absolutePath, options.signal))
      break
    case ".xlsx":
    case ".xlsm":
    case ".xltx":
    case ".xltm":
      ;({ text, regions } = await parseXlsx(file.absolutePath, options.signal))
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
    case ".odg":
    case ".ott":
    case ".ots":
    case ".otp":
    case ".otg":
      text = await parseOpenDocument(file.absolutePath, options.signal)
      break
    case ".fodt":
    case ".fods":
    case ".fodp":
    case ".fodg":
      text = flatOpenDocumentText(await readFile(file.absolutePath, "utf8"))
      break
    case ".epub":
      ;({ text, regions } = await parseEpub(file.absolutePath, options.signal))
      break
    case ".html":
    case ".htm":
    case ".xhtml":
    case ".xht":
    case ".shtml":
      text = renderHtml(decodeText(await readFile(file.absolutePath)))
      break
    case ".eml":
      text = emlText(await readFile(file.absolutePath), renderHtml)
      break
    case ".emlx":
      text = emlxText(await readFile(file.absolutePath), renderHtml)
      break
    case ".mbox":
      ;({ text, regions } = sectionRegions(
        mboxSections(await readFile(file.absolutePath), renderHtml),
        options.signal,
      ))
      break
    case ".mhtml":
    case ".mht":
      text = mhtmlText(await readFile(file.absolutePath), renderHtml)
      break
    case ".enex":
      ;({ text, regions } = sectionRegions(
        evernoteSections(await readStructuredSource(file), renderHtml),
        options.signal,
      ))
      break
    case ".fb2":
      ;({ text, regions } = sectionRegions(
        fictionBookSections(await readStructuredSource(file)),
        options.signal,
      ))
      break
    case ".fig":
      ;({ text, regions } = sectionRegions(
        figmaFileSections(await readFile(file.absolutePath)),
        options.signal,
      ))
      break
    case ".sketch": {
      const entries = unzipOfficeFile(
        await readFile(file.absolutePath),
        options.signal,
        SKETCH_TEXT_ENTRY_PATTERN,
      )
      ;({ text, regions } = sectionRegions(sketchSections(entries), options.signal))
      break
    }
    case ".json":
    case ".bim":
    case ".pbip":
    case ".pbir":
    case ".pbism":
    case ".ipynb":
    case ".geojson":
    case ".sarif":
    case ".excalidraw":
    case ".tldr":
    case ".canvas": {
      const value: unknown = JSON.parse(await readFile(file.absolutePath, "utf8"))
      const sections = jsonExportSections(value)
      if (sections) {
        ;({ text, regions } = sectionRegions(sections, options.signal))
        break
      }
      text = JSON.stringify(value, null, 2)
      break
    }
    case ".xml":
    case ".archimate":
    case ".bpm":
    case ".bpmn":
    case ".cdm":
    case ".dio":
    case ".dmn":
    case ".drawio":
    case ".ldm":
    case ".mcd":
    case ".mpd":
    case ".oom":
    case ".pdm":
    case ".twb":
    case ".xmi": {
      const source = await readStructuredSource(file)
      const format = detectStructuredXml(source) ?? STRUCTURED_XML_EXTENSIONS[file.extension]
      if (
        !format ||
        (format === "powerdesigner" && !/<\?PowerDesigner\b/u.test(source.slice(0, 8_192)))
      ) {
        if (
          POWERDESIGNER_EXTENSIONS.has(file.extension) &&
          file.extension !== ".mcd" &&
          file.extension !== ".mpd"
        ) {
          throw new Error(
            "PowerDesigner model is not saved as XML. Save it in the XML format, then ingest again.",
          )
        }
        text = source
        sourceLineCoordinates = true
        break
      }
      ;({ text, regions } = sectionRegions(structuredXmlSections(source, format), options.signal))
      break
    }
    case ".svg": {
      const source = await readFile(file.absolutePath, "utf8")
      const sections = /<mxfile\b|&lt;mxfile\b/u.test(source.slice(0, 65_536))
        ? drawioFromSvg(source)
        : null
      if (sections) {
        ;({ text, regions } = sectionRegions(sections, options.signal))
        break
      }
      text = source
      sourceLineCoordinates = true
      break
    }
    case ".mwb": {
      const entries = unzipOfficeFile(await readFile(file.absolutePath), options.signal)
      const model = entries.get("document.mwb.xml")
      if (!model) {
        throw new Error("MySQL Workbench model has no document.mwb.xml.")
      }
      ;({ text, regions } = sectionRegions(
        structuredXmlSections(model, "mysql-workbench"),
        options.signal,
      ))
      break
    }
    case ".vsdx":
    case ".vsdm":
    case ".vstx":
    case ".vstm": {
      const entries = unzipOfficeFile(await readFile(file.absolutePath), options.signal)
      ;({ text, regions } = sectionRegions(visioSections(entries), options.signal))
      break
    }
    case ".twbx": {
      const entries = unzipOfficeFile(await readFile(file.absolutePath), options.signal)
      const workbook = [...entries.keys()].find((name) => /\.twb$/iu.test(name))
      if (!workbook) {
        throw new Error("Packaged Tableau workbook has no .twb file.")
      }
      ;({ text, regions } = sectionRegions(
        structuredXmlSections(entries.get(workbook) ?? "", "tableau"),
        options.signal,
      ))
      break
    }
    case ".msg":
      text = outlookMessageText(await readFile(file.absolutePath))
      break
    case ".yaml":
    case ".yml": {
      const source = await readFile(file.absolutePath, "utf8")
      const documents = YAML.parseAllDocuments(source)
      const error = documents.flatMap((document) => document.errors)[0]
      if (error && HELM_TEMPLATE_MARKER.test(source)) {
        // A Helm template is YAML only once rendered: index the template itself, with line citations.
        text = source
        sourceLineCoordinates = true
        break
      }
      if (error) {
        throw error
      }
      const values = documents.map((document) => document.toJS())
      const sections = values.length === 1 ? jsonExportSections(values[0]) : null
      if (sections) {
        ;({ text, regions } = sectionRegions(sections, options.signal))
        break
      }
      text = documents
        .flatMap((document) => {
          const value = document.toJS()
          return value === null ? [] : [YAML.stringify(value)]
        })
        .join("\n")
      break
    }
    case ".rtf":
      text = stripRtf(await readFile(file.absolutePath, "utf8"))
      break
    default:
      text = decodeText(await readFile(file.absolutePath))
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

function renderHtml(html: string): string {
  return htmlToText(html, HTML_TO_TEXT_OPTIONS)
}

/**
 * Text files keep their own encoding: a UTF-16 byte order mark selects UTF-16, as Excel's
 * "Unicode text" and older Xcode string tables use, and bytes that are not valid UTF-8 are read as
 * Windows-1252, the usual encoding of legacy CSV, subtitles, and notes, instead of as U+FFFD.
 */
function decodeText(buffer: Buffer): string {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(buffer.subarray(2))
  }
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(buffer.subarray(2))
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer)
  } catch {
    return new TextDecoder("windows-1252").decode(buffer)
  }
}

/** Text of a flat OpenDocument file (`.fodt`, `.fods`, `.fodp`, `.fodg`): metadata, then body. */
function flatOpenDocumentText(xml: string): string {
  const parts = [...xml.matchAll(FLAT_OPENDOCUMENT_PARTS)].map((match) => xmlToText(match[0]))
  return parts.filter(Boolean).join("\n\n")
}

/** One located region per structured object, cited as `:section=<label>`. */
function sectionRegions(
  sections: StructuredSection[],
  signal: AbortSignal | undefined,
): { text: string; regions: ParsedRegion[] } {
  return joinLocatedParts(
    boundedSections(sections).map((section, index) => ({
      text: section.text,
      contextPath: section.label,
      location: { kind: "section", start: index + 1, end: index + 1, label: section.label },
    })),
    signal,
  )
}

async function readStructuredSource(file: SourceFile): Promise<string> {
  const buffer = await readFile(file.absolutePath)
  if (buffer.subarray(0, 4_096).includes(0)) {
    throw new Error(
      POWERDESIGNER_EXTENSIONS.has(file.extension)
        ? "PowerDesigner model is saved in binary format. Save it as XML, then ingest again."
        : "Structured model is binary, not XML.",
    )
  }
  return buffer.toString("utf8").replace(/^\uFEFF/u, "")
}

async function parseDocx(filePath: string, signal: AbortSignal | undefined): Promise<string> {
  const buffer = await readFile(filePath)
  throwIfAborted(signal)
  const entries = unzipOfficeFile(buffer, signal)
  const result = await mammoth.extractRawText({ buffer })
  throwIfAborted(signal)
  // Mammoth skips charts: append their titles, series, and values after the body text.
  const charts = relatedParts(entries, "word/document.xml", CHART_PART_PATTERN).map((part) =>
    chartXmlToText(entries.get(part) ?? ""),
  )
  return [result.value, ...charts].filter(Boolean).join("\n\n")
}

async function parsePptx(
  filePath: string,
  signal: AbortSignal | undefined,
): Promise<{ text: string; regions: ParsedRegion[] }> {
  const entries = unzipOfficeFile(await readFile(filePath), signal)
  const slides = orderedPresentationSlides(entries, signal)
  const notes = new Map(
    numberedOfficeParts(entries, /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/u, signal).map(
      (part) => [part.number, part.text],
    ),
  )
  const parts: Array<{ text: string; contextPath: string; location: SourceLocation }> = []
  for (const [index, slide] of slides.entries()) {
    throwIfAborted(signal)
    const noteText = presentationSlideNotes(entries, slide.number) ?? notes.get(slide.number) ?? ""
    const charts = relatedParts(
      entries,
      `ppt/slides/slide${slide.number}.xml`,
      CHART_PART_PATTERN,
    ).map((part) => chartXmlToText(entries.get(part) ?? ""))
    const text = [slide.text, ...charts, noteText].filter(Boolean).join("\n\n")
    const slideNumber = index + 1
    if (text) {
      parts.push({
        text,
        contextPath: `Slide ${slideNumber}`,
        location: {
          kind: "slide",
          start: slideNumber,
          end: slideNumber,
        },
      })
    }
  }
  return joinLocatedParts(parts, signal)
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

async function parseXlsx(
  filePath: string,
  signal: AbortSignal | undefined,
): Promise<{ text: string; regions: ParsedRegion[] }> {
  const buffer = await readFile(filePath)
  throwIfAborted(signal)
  const entries = unzipOfficeFile(buffer, signal)
  const workbook = await readExcelFile(buffer, { trim: false })
  throwIfAborted(signal)
  const parts: Array<{
    text: string
    contextPath: string
    location: SourceLocation
    headerRegionIndex?: number
  }> = []

  for (const [sheetIndex, sheet] of workbook.entries()) {
    throwIfAborted(signal)
    let firstRow = true
    let headerRegionIndex: number | undefined
    for (const [rowIndex, rawRow] of sheet.data.entries()) {
      throwIfAborted(signal)
      const row = spreadsheetRowToText(rawRow)
      const firstColumn = row.findIndex(Boolean)
      if (firstColumn < 0) {
        headerRegionIndex = undefined
        continue
      }
      const lastColumn = lastNonEmptyIndex(row)
      const rowNumber = rowIndex + 1
      const populatedCells = rawRow.filter((value) => value !== null && value !== "")
      const isHeader =
        headerRegionIndex === undefined &&
        populatedCells.length >= 2 &&
        populatedCells.every((value) => typeof value === "string")
      parts.push({
        text: `${firstRow ? `# ${sheet.sheet}\n` : ""}${row.join("\t")}`,
        contextPath: `Sheet: ${sheet.sheet}`,
        ...(headerRegionIndex === undefined ? {} : { headerRegionIndex }),
        location: {
          kind: "sheet",
          start: sheetIndex + 1,
          end: sheetIndex + 1,
          label: sheet.sheet,
          cellStart: `${spreadsheetColumnName(firstColumn + 1)}${rowNumber}`,
          cellEnd: `${spreadsheetColumnName(lastColumn + 1)}${rowNumber}`,
        },
      })
      if (isHeader) {
        headerRegionIndex = parts.length - 1
      }
      firstRow = false
    }
  }

  // Charts live in drawings attached to a sheet: cite them by sheet, without a cell range.
  for (const sheet of workbookSheetParts(entries)) {
    throwIfAborted(signal)
    const drawings = relatedParts(entries, sheet.part, /^xl\/drawings\/drawing\d+\.xml$/u)
    for (const drawing of drawings) {
      for (const chart of relatedParts(entries, drawing, CHART_PART_PATTERN)) {
        const text = chartXmlToText(entries.get(chart) ?? "")
        parts.push({
          text: `# ${sheet.name}\n${text}`,
          contextPath: `Sheet: ${sheet.name}`,
          location: {
            kind: "sheet",
            start: sheet.position,
            end: sheet.position,
            label: sheet.name,
          },
        })
      }
    }
  }

  return joinLocatedParts(parts, signal)
}

/** Workbook sheets in tab order, with the package part that holds each one. */
function workbookSheetParts(
  entries: Map<string, string>,
): Array<{ name: string; part: string; position: number }> {
  const workbook = entries.get("xl/workbook.xml")
  const relationships = entries.get("xl/_rels/workbook.xml.rels")
  if (!workbook || !relationships) {
    return []
  }
  const targets = new Map<string, string>()
  for (const relationship of xmlStartTags(relationships, "Relationship")) {
    const id = xmlAttribute(relationship, "Id")
    const target = xmlAttribute(relationship, "Target")
    if (id && target) {
      targets.set(id, resolvePartTarget("xl", target))
    }
  }
  return xmlStartTags(workbook, "sheet").flatMap((sheet, index) => {
    const name = xmlAttribute(sheet, "name")
    const id = xmlAttribute(sheet, "r:id")
    const part = id ? targets.get(id) : undefined
    return name && part ? [{ name, part, position: index + 1 }] : []
  })
}

/** Parts a package part points to through its relationships file, filtered by name. */
function relatedParts(entries: Map<string, string>, part: string, pattern: RegExp): string[] {
  const directory = path.posix.dirname(part)
  const relationships = entries.get(`${directory}/_rels/${path.posix.basename(part)}.rels`)
  if (!relationships) {
    return []
  }
  const parts: string[] = []
  for (const relationship of xmlStartTags(relationships, "Relationship")) {
    const target = xmlAttribute(relationship, "Target")
    if (!target || xmlAttribute(relationship, "TargetMode") === "External") {
      continue
    }
    const resolved = resolvePartTarget(directory, target)
    if (pattern.test(resolved) && entries.has(resolved) && !parts.includes(resolved)) {
      parts.push(resolved)
    }
  }
  return parts.sort(NATURAL_PATH_ORDER.compare)
}

function resolvePartTarget(directory: string, target: string): string {
  return target.startsWith("/")
    ? path.posix.normalize(target.slice(1))
    : path.posix.normalize(path.posix.join(directory, target))
}

/**
 * Text of an Office chart part: its title, axis titles, and each series with its points, so a
 * question about a figure in a chart finds the deck, document, or sheet that shows it.
 */
function chartXmlToText(xml: string): string {
  if (!xml) {
    return ""
  }
  const plotStart = xml.search(/<(?:\w+:)?plotArea\b/u)
  const header = plotStart < 0 ? xml : xml.slice(0, plotStart)
  const plotArea = plotStart < 0 ? "" : xml.slice(plotStart)
  const title = xmlTextValues(xmlBlocks(header, "title")[0] ?? "").join(" ")
  const lines = [title ? `Chart: ${title}` : "Chart"]
  const axes = ["catAx", "valAx", "dateAx", "serAx"]
    .flatMap((axis) => xmlBlocks(plotArea, axis))
    .map((axis) => xmlTextValues(xmlBlocks(axis, "title")[0] ?? "").join(" "))
    .filter(Boolean)
  if (axes.length > 0) {
    lines.push(`Axes: ${axes.join(" / ")}`)
  }
  for (const series of xmlBlocks(plotArea, "ser")) {
    const name = xmlTextValues(xmlBlocks(series, "tx")[0] ?? "").join(" ") || "Series"
    const categories = chartPoints(
      xmlBlocks(series, "cat")[0] ?? xmlBlocks(series, "xVal")[0] ?? "",
    )
    const values = chartPoints(xmlBlocks(series, "val")[0] ?? xmlBlocks(series, "yVal")[0] ?? "")
    const points = values
      .slice(0, MAX_CHART_POINTS)
      .map((value, index) => (categories[index] ? `${categories[index]}: ${value}` : value))
    const more =
      values.length > MAX_CHART_POINTS ? `; and ${values.length - MAX_CHART_POINTS} more` : ""
    lines.push(`${name}: ${points.join("; ")}${more}`)
  }
  return lines.join("\n")
}

/** Inner XML of each element with this local name, in document order (charts do not nest them). */
function xmlBlocks(xml: string, localName: string): string[] {
  return [
    ...xml.matchAll(
      new RegExp(
        `<(?:[A-Za-z_][\\w.-]*:)?${localName}\\b[^>]*>([\\s\\S]*?)</(?:[A-Za-z_][\\w.-]*:)?${localName}>`,
        "gu",
      ),
    ),
  ].map((match) => match[1] ?? "")
}

/** Rich text runs and cached cell values of a chart element. */
function xmlTextValues(xml: string): string[] {
  return [...xml.matchAll(/<(?:\w+:)?(?:t|v)>([^<]*)<\/(?:\w+:)?(?:t|v)>/gu)]
    .map((match) => decodeXmlEntities(match[1] ?? "").trim())
    .filter(Boolean)
}

/** Cached points of a category or value reference, ordered by their index. */
function chartPoints(xml: string): string[] {
  const points: string[] = []
  for (const match of xml.matchAll(
    /<(?:\w+:)?pt\b[^>]*\bidx\s*=\s*"(\d+)"[^>]*>([\s\S]*?)<\/(?:\w+:)?pt>/gu,
  )) {
    const index = Number(match[1])
    const value = xmlTextValues(match[2] ?? "").join(" ")
    if (Number.isSafeInteger(index) && index < MAX_CHART_POINTS * 4) {
      points[index] = value
    }
  }
  return Array.from(points, (value) => value ?? "")
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

async function parseOpenDocument(
  filePath: string,
  signal: AbortSignal | undefined,
): Promise<string> {
  const entries = unzipOfficeFile(await readFile(filePath), signal)
  return xmlEntriesToText(entries, [/^content\.xml$/u, /^meta\.xml$/u], signal)
}

async function parseEpub(
  filePath: string,
  signal: AbortSignal | undefined,
): Promise<{ text: string; regions: ParsedRegion[] }> {
  const entries = unzipOfficeFile(await readFile(filePath), signal)
  const orderedEntries = epubReadingOrder(entries, signal)
  const parts: Array<{ text: string; contextPath: string; location: SourceLocation }> = []
  for (const [index, name] of orderedEntries.entries()) {
    throwIfAborted(signal)
    const content = entries.get(name)
    if (content === undefined) {
      continue
    }
    const text = htmlToText(content, HTML_TO_TEXT_OPTIONS)
    if (text.trim()) {
      parts.push({
        text,
        contextPath: `EPUB: ${name}`,
        location: {
          kind: "epub",
          start: index + 1,
          end: index + 1,
          label: name,
        },
      })
    }
  }
  return joinLocatedParts(parts, signal)
}

function numberedOfficeParts(
  entries: Map<string, string>,
  pattern: RegExp,
  signal: AbortSignal | undefined,
): Array<{ number: number; text: string }> {
  const parts: Array<{ number: number; text: string }> = []
  for (const [name, xml] of entries) {
    throwIfAborted(signal)
    const match = pattern.exec(name)
    const number = Number(match?.[1])
    const text = match && Number.isSafeInteger(number) && number > 0 ? xmlToText(xml) : ""
    if (text) {
      parts.push({ number, text })
    }
  }
  return parts.sort((left, right) => left.number - right.number)
}

function orderedPresentationSlides(
  entries: Map<string, string>,
  signal: AbortSignal | undefined,
): Array<{ number: number; text: string }> {
  const natural = numberedOfficeParts(entries, /^ppt\/slides\/slide(\d+)\.xml$/u, signal)
  const presentation = entries.get("ppt/presentation.xml")
  const relationships = entries.get("ppt/_rels/presentation.xml.rels")
  if (!presentation || !relationships) {
    return natural
  }

  const targets = new Map<string, string>()
  for (const relationship of xmlStartTags(relationships, "Relationship")) {
    throwIfAborted(signal)
    const id = xmlAttribute(relationship, "Id")
    const target = xmlAttribute(relationship, "Target")
    if (id && target) {
      targets.set(id, path.posix.normalize(path.posix.join("ppt", target)))
    }
  }
  const byNumber = new Map(natural.map((slide) => [slide.number, slide]))
  const ordered: Array<{ number: number; text: string }> = []
  for (const slide of xmlStartTags(presentation, "sldId")) {
    throwIfAborted(signal)
    const relationshipId = xmlAttribute(slide, "r:id")
    const target = relationshipId ? targets.get(relationshipId) : undefined
    const match = target ? /^ppt\/slides\/slide(\d+)\.xml$/u.exec(target) : null
    const number = Number(match?.[1])
    const part = Number.isSafeInteger(number) ? byNumber.get(number) : undefined
    if (!part) {
      continue
    }
    byNumber.delete(number)
    ordered.push(part)
  }
  return ordered.length > 0 ? [...ordered, ...byNumber.values()] : natural
}

function joinLocatedParts(
  parts: Array<{
    text: string
    contextPath: string
    location: SourceLocation
    headerRegionIndex?: number
  }>,
  signal: AbortSignal | undefined,
): { text: string; regions: ParsedRegion[] } {
  let text = ""
  const regions: ParsedRegion[] = []
  for (const part of parts) {
    throwIfAborted(signal)
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
      ...(part.headerRegionIndex === undefined
        ? {}
        : { headerRegionIndex: part.headerRegionIndex }),
    })
  }
  return { text, regions }
}

function epubReadingOrder(entries: Map<string, string>, signal: AbortSignal | undefined): string[] {
  const htmlEntries: string[] = []
  for (const name of entries.keys()) {
    throwIfAborted(signal)
    if (/\.(?:xhtml|html|htm)$/iu.test(name)) {
      htmlEntries.push(name)
    }
  }
  htmlEntries.sort((left, right) => NATURAL_PATH_ORDER.compare(left, right))
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
    throwIfAborted(signal)
    const id = xmlAttribute(element, "id")
    const href = xmlAttribute(element, "href")
    if (id && href) {
      manifest.set(id, resolveEpubEntry(packageDirectory, href))
    }
  }
  const spine: string[] = []
  for (const element of xmlStartTags(packageXml, "itemref")) {
    throwIfAborted(signal)
    const id = xmlAttribute(element, "idref")
    const entry = id ? manifest.get(id) : undefined
    if (entry && entries.has(entry)) {
      spine.push(entry)
    }
  }
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

interface OfficeArchiveLimitsState {
  textEntryCount: number
  totalTextBytes: number
  rejected: boolean
}

function unzipOfficeFile(
  buffer: Buffer,
  signal: AbortSignal | undefined,
  entryPattern = OFFICE_TEXT_ENTRY_PATTERN,
): Map<string, string> {
  const state = officeArchiveLimitsState()
  const unzipped = unzipSync(new Uint8Array(buffer), {
    filter: (file) => {
      throwIfAborted(signal)
      return includeOfficeTextEntry(file, state, entryPattern)
    },
  })
  assertOfficeArchiveLimits(state)

  const entries = new Map<string, string>()
  for (const [name, content] of Object.entries(unzipped)) {
    throwIfAborted(signal)
    entries.set(name, strFromU8(content))
  }
  return entries
}

function officeArchiveLimitsState(): OfficeArchiveLimitsState {
  return { textEntryCount: 0, totalTextBytes: 0, rejected: false }
}

function includeOfficeTextEntry(
  file: UnzipFileInfo,
  state: OfficeArchiveLimitsState,
  entryPattern: RegExp,
): boolean {
  if (!entryPattern.test(file.name)) {
    return false
  }
  if (file.originalSize > MAX_OFFICE_XML_ENTRY_BYTES) {
    state.rejected = true
    return false
  }
  state.textEntryCount += 1
  state.totalTextBytes += file.originalSize
  if (
    state.textEntryCount > MAX_OFFICE_TEXT_ENTRY_COUNT ||
    state.totalTextBytes > MAX_OFFICE_XML_TOTAL_BYTES
  ) {
    state.rejected = true
    return false
  }
  return true
}

function assertOfficeArchiveLimits(state: OfficeArchiveLimitsState): void {
  if (state.rejected) {
    throw new Error("Archive text payload exceeds Ragmir safety limits.")
  }
}

function xmlEntriesToText(
  entries: Map<string, string>,
  patterns: RegExp[],
  signal: AbortSignal | undefined,
): string {
  const parts: string[] = []
  for (const [name, xml] of [...entries.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    throwIfAborted(signal)
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
    await pdf.loadingTask.destroy()
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
