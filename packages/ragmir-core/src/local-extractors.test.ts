import { execFileSync } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  extractLegacyWordText,
  inspectLocalExtractors,
  parseLegacyWordEngine,
  portableRunnerCommand,
} from "./ocr.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

function available(command: string, args: string[]): boolean {
  try {
    execFileSync(command, args, { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

describe("local extractors", () => {
  it("writes extractor commands with a project-relative runner", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-portable-runner-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".ragmir"), { recursive: true })
    await writeFile(path.join(root, ".ragmir", "run.cjs"), "", "utf8")

    expect(
      await portableRunnerCommand(root, ["ocr", "extract-image", "--input", "{input}"]),
    ).toEqual(["node", ".ragmir/run.cjs", "ocr", "extract-image", "--input", "{input}"])
  })

  it("names supported legacy Word engines and reports tool availability", async () => {
    expect(parseLegacyWordEngine("SOFFICE")).toBe("soffice")
    expect(() => parseLegacyWordEngine("word")).toThrow(/textutil, antiword, catdoc, soffice/u)

    const status = await inspectLocalExtractors()
    expect(status.legacyWord.engines).toHaveProperty("textutil")
    expect(typeof status.imageOcr.available).toBe("boolean")
  })

  it.runIf(process.platform === "darwin" && available("textutil", ["-help"]))(
    "extracts legacy Word text with textutil",
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-legacy-word-"))
      tempDirs.push(root)
      const source = path.join(root, "memo.txt")
      const document = path.join(root, "memo.doc")
      await writeFile(source, "Quarterly retention policy: keep invoices for ten years.\n", "utf8")
      execFileSync("textutil", ["-convert", "doc", source, "-output", document])

      const text = await extractLegacyWordText({ input: document, engine: "textutil" })

      expect(text).toContain("keep invoices for ten years")
    },
  )
})
