import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const filesSource = readFileSync(fileURLToPath(new URL("./files.ts", import.meta.url)), "utf8")
const guide = readFileSync(
  fileURLToPath(new URL("../../../docs/supported-formats.md", import.meta.url)),
  "utf8",
)

function setEntries(name: string): string[] {
  const match = new RegExp(`${name} = new Set\\(\\[([\\s\\S]*?)\\]\\)`, "u").exec(filesSource)
  if (!match?.[1]) {
    throw new Error(`Missing ${name} in files.ts`)
  }
  return [...match[1].matchAll(/"([^"]+)"/gu)].map((entry) => entry[1] ?? "")
}

describe("supported formats guide", () => {
  it("lists every extension and file name Ragmir indexes", () => {
    const listed = new Set(
      [...guide.matchAll(/`([^`]+)`/gu)].map((entry) => (entry[1] ?? "").toLowerCase()),
    )
    const missing = [
      ...setEntries("DEFAULT_SUPPORTED_EXTENSIONS"),
      ...setEntries("OCR_IMAGE_EXTENSIONS"),
      ...setEntries("LEGACY_WORD_EXTENSIONS"),
      ...setEntries("DEFAULT_SUPPORTED_FILE_NAMES"),
      // `Dockerfile.*` documents every `dockerfile.` variant.
      ...setEntries("DEFAULT_SUPPORTED_NAME_PREFIXES").map((prefix) => `${prefix}*`),
    ].filter((entry) => !listed.has(entry))

    expect(missing).toEqual([])
  })
})
