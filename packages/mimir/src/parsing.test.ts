import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { strToU8, zipSync } from "fflate"
import { afterEach, describe, expect, it } from "vitest"
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
    const root = await mkdtemp(path.join(os.tmpdir(), "mimir-docx-"))
    tempDirs.push(root)
    const filePath = path.join(root, "brief.docx")
    await writeFile(
      filePath,
      zipSync({
        "word/document.xml": strToU8(
          "<w:document><w:body><w:p><w:r><w:t>Confidential briefing</w:t></w:r></w:p></w:body></w:document>",
        ),
      }),
    )

    const parsed = await parseFile(sourceFile(root, filePath, ".docx"))

    expect(parsed.text).toContain("Confidential briefing")
  })

  it("extracts shared strings and values from xlsx files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mimir-xlsx-"))
    tempDirs.push(root)
    const filePath = path.join(root, "dataset.xlsx")
    await writeFile(
      filePath,
      zipSync({
        "xl/sharedStrings.xml": strToU8("<sst><si><t>Invoice</t></si><si><t>Paid</t></si></sst>"),
        "xl/worksheets/sheet1.xml": strToU8(
          '<worksheet><sheetData><row><c t="s"><v>0</v></c><c><v>24000</v></c><c t="s"><v>1</v></c></row></sheetData></worksheet>',
        ),
      }),
    )

    const parsed = await parseFile(sourceFile(root, filePath, ".xlsx"))

    expect(parsed.text).toContain("Invoice\t24000\tPaid")
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
