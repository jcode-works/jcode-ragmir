import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { strToU8, zipSync } from "fflate"
import { DEFAULT_CONFIG } from "../../dist/defaults.js"
import { initProject } from "../../dist/index.js"
import { sha256, stableJson } from "./metrics.mjs"

export const CORPUS_PRESETS = {
  XS: 1_500,
  S: 10_000,
  M: 100_000,
  L: 1_000_000,
}

const CHUNKS_PER_TEXT_DOCUMENT = 8
const GOLDEN_QUERY_LIMIT = 100
const BULK_FORMATS = ["md", "json", "jsonl", "html", "yaml", "csv", "xml", "txt"]
const SPECIAL_FORMATS = ["docx", "xlsx", "pptx", "epub", "pdf"]
const DETERMINISTIC_ZIP_OPTIONS = { mtime: new Date("1980-01-01T00:00:00.000Z") }

export async function generateCorpus({
  root,
  targetChunks,
  seed,
  provider,
  model,
  modelRevision,
  modelPath,
  goldenCount,
}) {
  await initProject(root)
  const rawDir = path.join(root, ".ragmir", "raw", "documents")
  await mkdir(rawDir, { recursive: true })
  const config = {
    ...DEFAULT_CONFIG,
    embeddingProvider: provider,
    embeddingModel: model,
    embeddingModelRevision: modelRevision,
    embeddingModelPath: modelPath,
    transformersAllowRemoteModels: false,
    accessLog: false,
    chunkSize: 800,
    chunkOverlap: 100,
    ingestConcurrency: 4,
    embeddingBatchSize: 32,
    topK: 5,
  }
  await writeFile(
    path.join(root, ".ragmir", "config.json"),
    `${JSON.stringify(config, null, 2)}\n`,
    "utf8",
  )

  const documentCount = Math.max(
    SPECIAL_FORMATS.length + 1,
    Math.ceil(targetChunks / CHUNKS_PER_TEXT_DOCUMENT),
  )
  const random = seededRandom(seed)
  const files = []
  const textFiles = []
  const pathsByFormat = new Map()

  for (let index = 0; index < documentCount; index += 1) {
    const format =
      index < SPECIAL_FORMATS.length
        ? SPECIAL_FORMATS[index]
        : BULK_FORMATS[(index - SPECIAL_FORMATS.length) % BULK_FORMATS.length]
    const document = createDocument({ index, format, random })
    const absolutePath = path.join(rawDir, document.fileName)
    await writeFile(absolutePath, document.bytes)
    const relativePath = normalizePath(path.relative(root, absolutePath))
    const bytes = Buffer.from(document.bytes)
    files.push({
      absolutePath,
      relativePath,
      format,
      bytes: bytes.length,
      sha256: sha256(bytes),
      evidenceKey: document.evidenceKey,
    })
    if (typeof document.bytes === "string") {
      textFiles.push({ absolutePath, relativePath, original: document.bytes, format })
    }
    const formatPaths = pathsByFormat.get(format) ?? []
    formatPaths.push(relativePath)
    pathsByFormat.set(format, formatPaths)
  }

  const eligibleGoldenFiles = files.slice(
    0,
    Math.min(files.length, goldenCount, GOLDEN_QUERY_LIMIT),
  )
  const goldenQueries = eligibleGoldenFiles.map((file, index) => ({
    id: `bench-${String(index + 1).padStart(3, "0")}`,
    query: queryForFile(file, index),
    expectedPaths: [file.relativePath],
    topK: 5,
  }))
  const goldenPath = path.join(root, "golden-queries.json")
  await writeFile(
    goldenPath,
    `${JSON.stringify({ topK: 5, queries: goldenQueries }, null, 2)}\n`,
    "utf8",
  )

  const manifestFiles = files
    .map(({ relativePath, format, bytes, sha256: digest }) => ({
      relativePath,
      format,
      bytes,
      sha256: digest,
    }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  const manifest = {
    schemaVersion: 1,
    seed,
    targetChunks,
    documentCount,
    files: manifestFiles,
    goldenSha256: sha256(await readFile(goldenPath)),
  }
  const corpusHash = sha256(stableJson(manifest))
  await writeFile(
    path.join(root, "corpus-manifest.json"),
    `${JSON.stringify({ ...manifest, corpusHash }, null, 2)}\n`,
    "utf8",
  )

  return {
    root,
    rawDir,
    config,
    files,
    textFiles,
    pathsByFormat,
    goldenPath,
    goldenQueries,
    manifest,
    corpusHash,
  }
}

function createDocument({ index, format, random }) {
  const padded = String(index + 1).padStart(7, "0")
  const evidenceKey = `BENCH-DOC-${padded}-${randomToken(random, 8)}`
  const title = `Deterministic evidence document ${padded}`
  const text = createEvidenceText({ title, evidenceKey, index, random })
  const fileName = `document-${padded}.${format}`

  switch (format) {
    case "docx":
      return {
        bytes: createDocx(title, evidenceKey, text),
        evidenceKey,
        fileName,
      }
    case "xlsx":
      return {
        bytes: createXlsx(title, evidenceKey, text),
        evidenceKey,
        fileName,
      }
    case "pptx":
      return {
        bytes: createPptx(title, evidenceKey, text),
        evidenceKey,
        fileName,
      }
    case "epub":
      return {
        bytes: createEpub(title, evidenceKey, text),
        evidenceKey,
        fileName,
      }
    case "pdf":
      return {
        bytes: createTextPdf(`${title} ${evidenceKey}`),
        evidenceKey,
        fileName,
      }
    case "json":
      return {
        bytes: `${JSON.stringify({ title, evidenceKey, content: text }, null, 2)}\n`,
        evidenceKey,
        fileName,
      }
    case "jsonl":
      return {
        bytes: `${text
          .split("\n\n")
          .map((content, section) => JSON.stringify({ evidenceKey, section, content }))
          .join("\n")}\n`,
        evidenceKey,
        fileName,
      }
    case "html":
      return {
        bytes: `<!doctype html><html><body><h1>${escapeXml(title)}</h1><p>${escapeXml(
          evidenceKey,
        )}</p>${text
          .split("\n\n")
          .map((paragraph) => `<p>${escapeXml(paragraph)}</p>`)
          .join("")}</body></html>\n`,
        evidenceKey,
        fileName,
      }
    case "yaml":
      return {
        bytes: `title: ${title}\nevidenceKey: ${evidenceKey}\ncontent: |\n${text
          .split("\n")
          .map((line) => `  ${line}`)
          .join("\n")}\n`,
        evidenceKey,
        fileName,
      }
    case "csv":
      return {
        bytes: `section,evidence,content\n${text
          .split("\n\n")
          .map(
            (paragraph, section) =>
              `${section},${evidenceKey},"${paragraph.replaceAll('"', '""').replaceAll("\n", " ")}"`,
          )
          .join("\n")}\n`,
        evidenceKey,
        fileName,
      }
    case "xml":
      return {
        bytes: `<document><title>${escapeXml(title)}</title><evidence>${escapeXml(
          evidenceKey,
        )}</evidence><content>${escapeXml(text)}</content></document>\n`,
        evidenceKey,
        fileName,
      }
    case "txt":
      return { bytes: `${title}\n${evidenceKey}\n\n${text}\n`, evidenceKey, fileName }
    default:
      return {
        bytes: `# ${title}\n\nEvidence key: ${evidenceKey}\n\n${text}\n`,
        evidenceKey,
        fileName,
      }
  }
}

function createEvidenceText({ title, evidenceKey, index, random }) {
  const multilingual = [
    "Local retrieval keeps cited evidence available without a hosted document store.",
    "La recherche locale conserve des preuves citées sans stockage documentaire hébergé.",
    "การค้นหาในเครื่องเก็บหลักฐานอ้างอิงไว้โดยไม่ใช้คลาวด์",
    "本地检索保留可引用的证据并避免托管文档存储。",
  ]
  const sections = []
  for (let section = 0; section < CHUNKS_PER_TEXT_DOCUMENT; section += 1) {
    const sectionKey = `${evidenceKey}-SECTION-${String(section + 1).padStart(2, "0")}`
    const tokens = Array.from({ length: 70 }, () => randomToken(random, 7)).join(" ")
    sections.push(
      [
        `## ${title} section ${section + 1}`,
        `Evidence identifier ${sectionKey}.`,
        multilingual[(index + section) % multilingual.length],
        `Deterministic workload tokens: ${tokens}.`,
      ].join("\n"),
    )
  }
  return sections.join("\n\n")
}

function queryForFile(file, index) {
  const prefixes = [
    "Find the exact evidence identifier",
    "Retrouve la preuve exacte",
    "ค้นหาหลักฐานรหัส",
    "查找精确证据标识符",
  ]
  return `${prefixes[index % prefixes.length]} ${file.evidenceKey}`
}

function seededRandom(seed) {
  let state = createHash("sha256").update(String(seed)).digest().readUInt32LE(0)
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    return state / 0x1_0000_0000
  }
}

function randomToken(random, length) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz"
  return Array.from({ length }, () => alphabet[Math.floor(random() * alphabet.length)]).join("")
}

function createDocx(title, evidenceKey, text) {
  const paragraphs = [title, evidenceKey, ...text.split("\n\n")]
    .map(
      (paragraph) =>
        `<w:p><w:r><w:t xml:space="preserve">${escapeXml(paragraph)}</w:t></w:r></w:p>`,
    )
    .join("")
  return zipSync({
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    "_rels/.rels": strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ),
    "word/document.xml": strToU8(
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}</w:body></w:document>`,
    ),
  }, DETERMINISTIC_ZIP_OPTIONS)
}

function createXlsx(title, evidenceKey, text) {
  const values = [title, evidenceKey, ...text.split("\n\n")]
  const rows = values
    .map(
      (value, index) =>
        `<row r="${index + 1}"><c r="A${index + 1}" t="inlineStr"><is><t>${escapeXml(
          value,
        )}</t></is></c></row>`,
    )
    .join("")
  return zipSync({
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    ),
    "_rels/.rels": strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ),
    "xl/workbook.xml": strToU8(
      '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Evidence" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    "xl/worksheets/sheet1.xml": strToU8(
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`,
    ),
  }, DETERMINISTIC_ZIP_OPTIONS)
}

function createPptx(title, evidenceKey, text) {
  const slideText = escapeXml(`${title} ${evidenceKey} ${text}`)
  return zipSync({
    "ppt/slides/slide1.xml": strToU8(
      `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${slideText}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    ),
  }, DETERMINISTIC_ZIP_OPTIONS)
}

function createEpub(title, evidenceKey, text) {
  return zipSync({
    "OEBPS/chapter-1.xhtml": strToU8(
      `<html><body><h1>${escapeXml(title)}</h1><p>${escapeXml(evidenceKey)}</p><p>${escapeXml(
        text,
      )}</p></body></html>`,
    ),
  }, DETERMINISTIC_ZIP_OPTIONS)
}

function createTextPdf(text) {
  const escaped = text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)")
  const content = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`
  return createPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ])
}

function createPdf(objects) {
  let pdf = "%PDF-1.4\n"
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xrefOffset = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  return pdf
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function normalizePath(value) {
  return value.split(path.sep).join("/")
}
