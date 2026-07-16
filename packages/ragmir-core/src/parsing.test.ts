import { existsSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { strToU8, zipSync } from "fflate"
import { afterEach, describe, expect, it, vi } from "vitest"
import { MAX_EXTERNAL_TEXT_STDIO_BYTES } from "./limits.js"
import { parseFile } from "./parsing.js"
import type { SourceFile } from "./types.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("parseFile", () => {
  it("extracts text from docx files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-docx-"))
    tempDirs.push(root)
    const filePath = path.join(root, "brief.docx")
    await writeFile(
      filePath,
      createDocxPackage(
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Confidential briefing</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Risk owner</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>',
      ),
    )

    const parsed = await parseFile(sourceFile(root, filePath, ".docx"))

    expect(parsed.text).toContain("Confidential briefing")
    expect(parsed.text).toContain("Risk owner")
  })

  it("uses an opt-in text command for legacy Word files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-doc-"))
    tempDirs.push(root)
    const filePath = path.join(root, "legacy.doc")
    const docScriptPath = path.join(root, "doc-wrapper.mjs")
    await writeFile(filePath, "fake legacy Word bytes", "utf8")
    await writeFile(
      docScriptPath,
      "process.stdout.write('Legacy Word text for ' + process.env.RAGMIR_LEGACY_WORD_PATH + ' ' + process.argv.at(-1))\n",
      "utf8",
    )

    const parsed = await parseFile(sourceFile(root, filePath, ".doc"), {
      legacyWordCommand: [process.execPath, docScriptPath, "{input}"],
      legacyWordTimeoutMs: 5_000,
    })

    expect(parsed.text).toContain("Legacy Word text for")
    expect(parsed.text).toContain("legacy.doc")
  })

  it("should terminate an external extractor when parsing is aborted", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-doc-abort-"))
    tempDirs.push(root)
    const filePath = path.join(root, "legacy.doc")
    const markerPath = path.join(root, "extractor-ready")
    const docScriptPath = path.join(root, "doc-wrapper.mjs")
    await writeFile(filePath, "fake legacy Word bytes", "utf8")
    await writeFile(
      docScriptPath,
      [
        'import { writeFileSync } from "node:fs"',
        `writeFileSync(${JSON.stringify(markerPath)}, "ready")`,
        "setInterval(() => {}, 1_000)",
      ].join("\n"),
      "utf8",
    )
    const controller = new AbortController()
    const parsing = parseFile(sourceFile(root, filePath, ".doc"), {
      legacyWordCommand: [process.execPath, docScriptPath, "{input}"],
      legacyWordTimeoutMs: 5_000,
      signal: controller.signal,
    })
    try {
      await vi.waitFor(() => expect(existsSync(markerPath)).toBe(true), {
        timeout: 5_000,
      })

      controller.abort()

      await expect(parsing).rejects.toMatchObject({ code: "ABORTED" })
    } finally {
      controller.abort()
      await parsing.catch(() => undefined)
    }
  })

  it("extracts shared strings and values from xlsx files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-xlsx-"))
    tempDirs.push(root)
    const filePath = path.join(root, "dataset.xlsx")
    await writeFile(
      filePath,
      createXlsxPackage([
        {
          name: "Finance & Ops",
          rows: [["Invoice", "", 24000, "Paid"]],
        },
      ]),
    )

    const parsed = await parseFile(sourceFile(root, filePath, ".xlsx"))

    expect(parsed.text).toContain("# Finance & Ops")
    expect(parsed.text).toContain("Invoice\t\t24000\tPaid")
  })

  it.each([
    { extension: ".docx" },
    { extension: ".xlsx" },
  ])("should reject $extension archives when they exceed Office entry limits", async ({
    extension,
  }) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-office-limit-"))
    tempDirs.push(root)
    const filePath = path.join(root, `oversized${extension}`)
    const entries = Object.fromEntries(
      Array.from({ length: 513 }, (_entry, index) => [
        `payload/entry-${index}.xml`,
        strToU8("<root>bounded</root>"),
      ]),
    )
    await writeFile(filePath, zipSync(entries))

    await expect(parseFile(sourceFile(root, filePath, extension))).rejects.toThrow(
      "Archive text payload exceeds Ragmir safety limits.",
    )
  })

  it("extracts text from pptx slides and speaker notes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-pptx-"))
    tempDirs.push(root)
    const filePath = path.join(root, "deck.pptx")
    await writeFile(
      filePath,
      zipSync({
        "ppt/slides/slide1.xml": strToU8(
          '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Roadmap slide</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
        ),
        "ppt/notesSlides/notesSlide1.xml": strToU8(
          '<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Speaker note insight</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>',
        ),
      }),
    )

    const parsed = await parseFile(sourceFile(root, filePath, ".pptx"))

    expect(parsed.text).toContain("Roadmap slide")
    expect(parsed.text).toContain("Speaker note insight")
  })

  it("extracts text from PDF files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-pdf-"))
    tempDirs.push(root)
    const filePath = path.join(root, "brief.pdf")
    await writeFile(filePath, createTextPdf())

    const parsed = await parseFile(sourceFile(root, filePath, ".pdf"))

    expect(parsed.text).toContain("Synthetic confidential PDF")
    expect(parsed.pages).toEqual([
      expect.objectContaining({ pageNumber: 1, charStart: 0, charEnd: parsed.text.length }),
    ])
  })

  it("uses an opt-in OCR command when PDF text extraction is empty", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-pdf-ocr-"))
    tempDirs.push(root)
    const filePath = path.join(root, "scan.pdf")
    const ocrScriptPath = path.join(root, "ocr-wrapper.mjs")
    await writeFile(filePath, createBlankPdf())
    await writeFile(
      ocrScriptPath,
      "process.stdout.write('OCR text for ' + process.env.RAGMIR_PDF_PATH)\n",
      "utf8",
    )

    const parsed = await parseFile(sourceFile(root, filePath, ".pdf"), {
      pdfOcrCommand: [process.execPath, ocrScriptPath, "{input}"],
      pdfOcrTimeoutMs: 5_000,
    })

    expect(parsed.text).toContain("OCR text for")
    expect(parsed.text).toContain("scan.pdf")
  })

  it("preserves embedded text and OCRs only blank pages in mixed PDFs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-pdf-mixed-"))
    tempDirs.push(root)
    const filePath = path.join(root, "mixed.pdf")
    const ocrScriptPath = path.join(root, "ocr-page-wrapper.mjs")
    await writeFile(filePath, createMixedPdf())
    await writeFile(
      ocrScriptPath,
      "process.stdout.write('Scanned evidence from page ' + process.env.RAGMIR_PDF_PAGE)\n",
      "utf8",
    )

    const parsed = await parseFile(sourceFile(root, filePath, ".pdf"), {
      pdfOcrCommand: [process.execPath, ocrScriptPath, "{input}", "{page}"],
      pdfOcrTimeoutMs: 5_000,
    })

    expect(parsed.text).toContain("Embedded evidence on page one")
    expect(parsed.text).toContain("Scanned evidence from page 2")
    expect(parsed.pages).toHaveLength(2)
    expect(parsed.pages?.[0]?.pageNumber).toBe(1)
    expect(parsed.pages?.[1]?.pageNumber).toBe(2)
  })

  it("uses an opt-in OCR command for image files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-image-ocr-"))
    tempDirs.push(root)
    const filePath = path.join(root, "diagram.png")
    const ocrScriptPath = path.join(root, "image-ocr-wrapper.mjs")
    await writeFile(filePath, "fake image bytes", "utf8")
    await writeFile(
      ocrScriptPath,
      "process.stdout.write('Image OCR text for ' + process.env.RAGMIR_IMAGE_PATH + ' ' + process.argv.at(-1))\n",
      "utf8",
    )

    const parsed = await parseFile(sourceFile(root, filePath, ".png"), {
      imageOcrCommand: [process.execPath, ocrScriptPath, "{input}"],
      imageOcrTimeoutMs: 5_000,
    })

    expect(parsed.text).toContain("Image OCR text for")
    expect(parsed.text).toContain("diagram.png")
  })

  it("should stop an external extractor when combined output exceeds the safety limit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-extractor-limit-"))
    tempDirs.push(root)
    const filePath = path.join(root, "diagram.png")
    const scriptPath = path.join(root, "large-output.mjs")
    await writeFile(filePath, "fake image bytes", "utf8")
    await writeFile(
      scriptPath,
      `process.stdout.write(Buffer.alloc(${MAX_EXTERNAL_TEXT_STDIO_BYTES + 1}, 65))\n`,
      "utf8",
    )

    await expect(
      parseFile(sourceFile(root, filePath, ".png"), {
        imageOcrCommand: [process.execPath, scriptPath, "{input}"],
        imageOcrTimeoutMs: 10_000,
      }),
    ).rejects.toThrow("OCR command produced too much output.")
  })

  it("extracts text from epub html entries", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-epub-"))
    tempDirs.push(root)
    const filePath = path.join(root, "brief.epub")
    await writeFile(
      filePath,
      zipSync({
        "OPS/chapter.xhtml": strToU8("<html><body><h1>Sovereign report</h1></body></html>"),
      }),
    )

    const parsed = await parseFile(sourceFile(root, filePath, ".epub"))

    expect(parsed.text).toContain("SOVEREIGN REPORT")
  })

  it("rejects archives with too many text entries", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-archive-limit-"))
    tempDirs.push(root)
    const filePath = path.join(root, "bomb.epub")
    const entries = Object.fromEntries(
      Array.from({ length: 520 }, (_entry, index) => [
        `OPS/chapter-${index}.xhtml`,
        strToU8("<html><body>Too many entries</body></html>"),
      ]),
    )
    await writeFile(filePath, zipSync(entries))

    await expect(parseFile(sourceFile(root, filePath, ".epub"))).rejects.toThrow(
      "Archive text payload exceeds Ragmir safety limits.",
    )
  })

  it("omits long embedded base64 payloads from text files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-base64-"))
    tempDirs.push(root)
    const filePath = path.join(root, "notes.md")
    const base64Payload = "A".repeat(320)
    await writeFile(
      filePath,
      `Useful context before.\n![diagram](data:image/png;base64,${base64Payload})\nUseful context after.\n`,
      "utf8",
    )

    const parsed = await parseFile(sourceFile(root, filePath, ".md"))

    expect(parsed.text).toContain("Useful context before.")
    expect(parsed.text).toContain("Useful context after.")
    expect(parsed.text).not.toContain(base64Payload)
  })
})

function sourceFile(root: string, absolutePath: string, extension: string): SourceFile {
  return {
    absolutePath,
    relativePath: path.relative(root, absolutePath),
    source: path.basename(absolutePath),
    extension,
    bytes: 0,
    mtimeMs: 0,
    checksum: "test",
  }
}

function createDocxPackage(documentXml: string): Uint8Array {
  return zipSync({
    "[Content_Types].xml": strToU8(
      [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
        '<Default Extension="xml" ContentType="application/xml"/>',
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
        "</Types>",
      ].join(""),
    ),
    "_rels/.rels": strToU8(
      [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
        "</Relationships>",
      ].join(""),
    ),
    "word/document.xml": strToU8(documentXml),
  })
}

function createXlsxPackage(sheets: Array<{ name: string; rows: Array<Array<string | number>> }>) {
  const workbookRelationships = sheets
    .map(
      (_sheet, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
    )
    .join("")
  const workbookSheets = sheets
    .map(
      (sheet, index) =>
        `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
    )
    .join("")
  const worksheetFiles = Object.fromEntries(
    sheets.map((sheet, index) => [
      `xl/worksheets/sheet${index + 1}.xml`,
      strToU8(
        `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet.rows
          .map((row, rowIndex) => `<row r="${rowIndex + 1}">${rowToXml(row, rowIndex + 1)}</row>`)
          .join("")}</sheetData></worksheet>`,
      ),
    ]),
  )

  return zipSync({
    "[Content_Types].xml": strToU8(
      [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
        '<Default Extension="xml" ContentType="application/xml"/>',
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
        ...sheets.map(
          (_sheet, index) =>
            `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        ),
        "</Types>",
      ].join(""),
    ),
    "_rels/.rels": strToU8(
      [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>',
        "</Relationships>",
      ].join(""),
    ),
    "xl/workbook.xml": strToU8(
      [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
        `<sheets>${workbookSheets}</sheets>`,
        "</workbook>",
      ].join(""),
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
        workbookRelationships,
        "</Relationships>",
      ].join(""),
    ),
    ...worksheetFiles,
  })
}

function rowToXml(row: Array<string | number>, rowNumber: number): string {
  return row
    .map((value, index) => cellToXml(value, `${columnName(index + 1)}${rowNumber}`))
    .join("")
}

function cellToXml(value: string | number, reference: string): string {
  if (typeof value === "number") {
    return `<c r="${reference}"><v>${value}</v></c>`
  }
  if (value.length === 0) {
    return ""
  }
  return `<c r="${reference}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`
}

function columnName(column: number): string {
  let current = column
  let name = ""
  while (current > 0) {
    current -= 1
    name = String.fromCharCode(65 + (current % 26)) + name
    current = Math.floor(current / 26)
  }
  return name
}

function escapeXml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
}

function createTextPdf(): string {
  return `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>
endobj
4 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
5 0 obj
<< /Length 56 >>
stream
BT /F1 18 Tf 72 720 Td (Synthetic confidential PDF) Tj ET
endstream
endobj
xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000241 00000 n
0000000311 00000 n
trailer
<< /Size 6 /Root 1 0 R >>
startxref
418
%%EOF`
}

function createBlankPdf(): string {
  return `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>
endobj
xref
0 4
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
trailer
<< /Size 4 /Root 1 0 R >>
startxref
190
%%EOF`
}

function createMixedPdf(): string {
  const content = "BT /F1 18 Tf 72 720 Td (Embedded evidence on page one) Tj ET"
  return createPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ])
}

function createPdf(objects: string[]): string {
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
