import { execFile } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { strToU8, zipSync } from "fflate"
import { environmentMetadata } from "./lib/metrics.mjs"

const execFileAsync = promisify(execFile)
const here = path.dirname(fileURLToPath(import.meta.url))
const invocationRoot = process.env.INIT_CWD ?? process.cwd()
const options = parseArguments(process.argv.slice(2))
const stress = options.stress === true
const profile = stress ? "stress" : "smoke"
const paddingBytes = integerOption(options.paddingBytes, stress ? 48_000_000 : 2_000_000, "paddingBytes")
const textBytes = integerOption(options.textBytes, stress ? 1_000_000 : 200_000, "textBytes")
const budgetMiB = integerOption(options.budgetMiB, 768, "budgetMiB")
const budgetBytes = budgetMiB * 1_024 * 1_024
const formats = ["docx", "xlsx", "pptx", "epub", "pdf"]
const resultPath = path.resolve(
  invocationRoot,
  options.result ??
    path.join(
      here,
      ".results",
      `${new Date().toISOString().replaceAll(":", "-")}-parsers-${profile}.json`,
    ),
)
const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-parsers-"))
const cases = []

try {
  const padding = deterministicPadding(paddingBytes)
  for (const format of formats) {
    const validPath = path.join(root, `valid.${format}`)
    const malformedPath = path.join(root, `malformed.${format}`)
    await writeFile(validPath, createFixture(format, textBytes, padding))
    await writeFile(malformedPath, `not-a-valid-${format}`, "utf8")
    const worker = await runWorker(format, validPath, malformedPath)
    const expectedLocation = expectedEvidenceLocation(format)
    const sourceNearLimit = !stress || (worker.sourceBytes >= 45_000_000 && worker.sourceBytes <= 50_000_000)
    const passed =
      worker.peakRssBytes <= budgetBytes &&
      worker.evidenceFound &&
      worker.malformed.rejected &&
      sourceNearLimit &&
      sameLocation(worker.evidenceLocation, expectedLocation)
    cases.push({ ...worker, budgetBytes, sourceNearLimit, expectedLocation, passed })
    await rm(validPath, { force: true })
    await rm(malformedPath, { force: true })
  }

  const report = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    profile,
    claimEligible: stress,
    environment: environmentMetadata(),
    configuration: { formats, paddingBytes, textBytes, budgetMiB },
    cases,
    passed: cases.every((entry) => entry.passed),
  }
  await mkdir(path.dirname(resultPath), { recursive: true })
  await writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  process.stdout.write(`${JSON.stringify({ resultPath, ...report }, null, 2)}\n`)
  if (!report.passed) {
    process.exitCode = 1
  }
} finally {
  if (options.keep === true) {
    process.stderr.write(`Parser fixtures preserved at ${root}\n`)
  } else {
    await rm(root, { recursive: true, force: true })
  }
}

async function runWorker(format, validPath, malformedPath) {
  const workerPath = path.join(here, "parser-worker.mjs")
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [workerPath, format, validPath, malformedPath],
    { cwd: invocationRoot, maxBuffer: 8 * 1_024 * 1_024 },
  )
  const line = stdout
    .trim()
    .split("\n")
    .findLast((entry) => entry.length > 0)
  if (!line) {
    throw new Error(`Parser worker returned no result for ${format}.`)
  }
  const result = JSON.parse(line)
  if (
    typeof result !== "object" ||
    result === null ||
    typeof result.peakRssBytes !== "number" ||
    typeof result.wallMs !== "number" ||
    typeof result.malformed !== "object" ||
    result.malformed === null
  ) {
    throw new Error(`Parser worker returned an invalid result for ${format}.`)
  }
  return { ...result, stderr: stderr.trim() }
}

function createFixture(format, textBytes, padding) {
  const evidence = paddedEvidence(format, textBytes)
  switch (format) {
    case "docx":
      return createDocx(evidence, padding)
    case "xlsx":
      return createXlsx(evidence, padding)
    case "pptx":
      return createPptx(evidence, padding)
    case "epub":
      return createEpub(evidence, padding)
    case "pdf":
      return createPdf(evidence, padding)
    default:
      throw new Error(`Unsupported parser benchmark format ${format}.`)
  }
}

function createDocx(evidence, padding) {
  return officeZip(
    {
      "[Content_Types].xml": strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
      "_rels/.rels": strToU8(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ),
      "word/document.xml": strToU8(
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${escapeXml(evidence)}</w:t></w:r></w:p></w:body></w:document>`,
      ),
    },
    padding,
  )
}

function createXlsx(evidence, padding) {
  const rows = evidence
    .match(/.{1,512}/gu)
    ?.map(
      (value, index) =>
        `<row r="${index + 1}"><c r="A${index + 1}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c></row>`,
    )
    .join("")
  return officeZip(
    {
      "[Content_Types].xml": strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
      ),
      "_rels/.rels": strToU8(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      ),
      "xl/workbook.xml": strToU8(
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Evidence" sheetId="1" r:id="rId1"/></sheets></workbook>',
      ),
      "xl/_rels/workbook.xml.rels": strToU8(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      ),
      "xl/worksheets/sheet1.xml": strToU8(
        `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows ?? ""}</sheetData></worksheet>`,
      ),
    },
    padding,
  )
}

function createPptx(evidence, padding) {
  const entries = {}
  for (const [index, text] of splitText(evidence, 16_000).entries()) {
    entries[`ppt/slides/slide${index + 1}.xml`] = strToU8(
      `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><a:p><a:r><a:t>${escapeXml(text)}</a:t></a:r></a:p></p:sld>`,
    )
  }
  return officeZip(entries, padding)
}

function createEpub(evidence, padding) {
  const entries = {}
  for (const [index, text] of splitText(evidence, 16_000).entries()) {
    entries[`OPS/chapter-${String(index + 1).padStart(3, "0")}.xhtml`] = strToU8(
      `<html><body><p>${escapeXml(text)}</p></body></html>`,
    )
  }
  return officeZip(entries, padding)
}

function officeZip(entries, padding) {
  return zipSync({ ...entries, "payload/padding.bin": [padding, { level: 0 }] })
}

function createPdf(evidence, padding) {
  const pageTexts = splitText(evidence, 10_000)
  const pageReferences = pageTexts.map((_text, index) => `${4 + index * 2} 0 R`).join(" ")
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "ascii"),
    Buffer.from(
      `<< /Type /Pages /Kids [${pageReferences}] /Count ${pageTexts.length} >>`,
      "ascii",
    ),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", "ascii"),
  ]
  for (const [index, pageText] of pageTexts.entries()) {
    const contentObject = 5 + index * 2
    const content = Buffer.from(pdfTextContent(pageText), "utf8")
    objects.push(
      Buffer.from(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObject} 0 R >>`,
        "ascii",
      ),
      Buffer.concat([
        Buffer.from(`<< /Length ${content.length} >>\nstream\n`, "ascii"),
        content,
        Buffer.from("\nendstream", "ascii"),
      ]),
    )
  }
  objects.push(
    Buffer.concat([
      Buffer.from(`<< /Length ${padding.length} >>\nstream\n`, "ascii"),
      padding,
      Buffer.from("\nendstream", "ascii"),
    ]),
  )
  return createPdfObjects(objects)
}

function pdfTextContent(text) {
  const commands = splitText(text, 100).map((segment) => {
    const escaped = segment
      .replaceAll("\\", "\\\\")
      .replaceAll("(", "\\(")
      .replaceAll(")", "\\)")
    return `(${escaped}) Tj\n0 -12 Td`
  })
  return `BT /F1 10 Tf 36 760 Td\n${commands.join("\n")}\nET`
}

function createPdfObjects(objects) {
  const header = Buffer.from("%PDF-1.7\n", "ascii")
  const offsets = []
  let offset = header.length
  const serialized = objects.map((object, index) => {
    const value = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`, "ascii"),
      object,
      Buffer.from("\nendobj\n", "ascii"),
    ])
    offsets.push(offset)
    offset += value.length
    return value
  })
  const xrefOffset = offset
  const xref = Buffer.from(
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
      .map((value) => `${String(value).padStart(10, "0")} 00000 n \n`)
      .join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
    "ascii",
  )
  return Buffer.concat([header, ...serialized, xref])
}

function paddedEvidence(format, bytes) {
  const prefix = `PARSER-EVIDENCE-${format} stable citation payload `
  return `${prefix}${"0123456789abcdef ".repeat(Math.ceil((bytes - prefix.length) / 17))}`.slice(0, bytes)
}

function splitText(value, size) {
  return value.match(new RegExp(`.{1,${size}}`, "gu")) ?? []
}

function deterministicPadding(bytes) {
  const block = Buffer.allocUnsafe(Math.min(bytes, 1_048_576))
  let state = 0x9e3779b9
  for (let index = 0; index < block.length; index += 1) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    block[index] = state & 0xff
  }
  const output = Buffer.allocUnsafe(bytes)
  for (let offset = 0; offset < bytes; offset += block.length) {
    block.copy(output, offset, 0, Math.min(block.length, bytes - offset))
  }
  return output
}

function expectedEvidenceLocation(format) {
  switch (format) {
    case "docx":
      return { kind: null, start: null, cellStart: null, pageStart: null }
    case "xlsx":
      return { kind: "sheet", start: 1, cellStart: "A1", pageStart: null }
    case "pptx":
      return { kind: "slide", start: 1, cellStart: null, pageStart: null }
    case "epub":
      return { kind: "epub", start: 1, cellStart: null, pageStart: null }
    case "pdf":
      return { kind: "page", start: 1, cellStart: null, pageStart: 1 }
    default:
      throw new Error(`Unsupported parser benchmark format ${format}.`)
  }
}

function sameLocation(actual, expected) {
  return (
    actual !== null &&
    actual.kind === expected.kind &&
    actual.start === expected.start &&
    actual.cellStart === expected.cellStart &&
    actual.pageStart === expected.pageStart
  )
}

function escapeXml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

function parseArguments(values) {
  const parsed = {}
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (value === "--") {
      continue
    }
    if (value === "--stress" || value === "--keep") {
      parsed[value.slice(2)] = true
      continue
    }
    if (!value?.startsWith("--")) {
      throw new Error(`Unknown argument ${JSON.stringify(value)}.`)
    }
    const next = values[index + 1]
    if (!next || next.startsWith("--")) {
      throw new Error(`${value} requires a value.`)
    }
    parsed[toCamelCase(value.slice(2))] = next
    index += 1
  }
  return parsed
}

function integerOption(value, fallback, name) {
  const selected = value === undefined ? fallback : Number(value)
  if (!Number.isSafeInteger(selected) || selected <= 0) {
    throw new Error(`${name} must be a positive integer.`)
  }
  return selected
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/gu, (_match, letter) => letter.toUpperCase())
}
