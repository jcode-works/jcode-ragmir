import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { addSourceEntries, listSourceEntries } from "./sources.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("source entries", () => {
  it("writes entries to the config.json sources array without duplicates", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-sources-"))
    tempDirs.push(root)

    const result = await addSourceEntries({
      cwd: root,
      entries: ["../apps/*/README.md", "../apps/*/docs/**/*.md", "../apps/*/README.md"],
    })

    expect(result.added).toEqual(["../apps/*/README.md", "../apps/*/docs/**/*.md"])
    expect(result.skipped).toEqual([])

    // Entries must land in config.json, NOT in sources.txt.
    const configPath = path.join(root, ".ragmir", "config.json")
    const config = JSON.parse(await readFile(configPath, "utf8"))
    expect(config.sources).toEqual(["../apps/*/README.md", "../apps/*/docs/**/*.md"])
    expect(existsSync(path.join(root, ".ragmir", "sources.txt"))).toBe(false)

    const second = await addSourceEntries({
      cwd: root,
      entries: ["../apps/*/README.md", "!../apps/**/node_modules/**"],
    })

    expect(second.added).toEqual(["!../apps/**/node_modules/**"])
    expect(second.skipped).toEqual(["../apps/*/README.md"])
    await expect(listSourceEntries(root)).resolves.toEqual({
      sourcesFile: configPath,
      entries: ["../apps/*/README.md", "../apps/*/docs/**/*.md", "!../apps/**/node_modules/**"],
    })
  })

  it("merges legacy sources.txt entries read-only and never writes to it", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-sources-legacy-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".ragmir"), { recursive: true })
    // Pre-existing legacy file is read for backward compatibility.
    await writeFile(
      path.join(root, ".ragmir", "sources.txt"),
      "# Existing notes\n\n../docs/**/*.md\n",
      "utf8",
    )

    const listed = await listSourceEntries(root)
    expect(listed.entries).toEqual(["../docs/**/*.md"])

    // Adding a new entry writes to config.json, leaving the legacy file untouched.
    await addSourceEntries({ cwd: root, entries: ["../apps/*/README.md"] })

    const config = JSON.parse(await readFile(path.join(root, ".ragmir", "config.json"), "utf8"))
    expect(config.sources).toEqual(["../apps/*/README.md"])

    // Legacy file is unchanged (read-only).
    await expect(readFile(path.join(root, ".ragmir", "sources.txt"), "utf8")).resolves.toBe(
      "# Existing notes\n\n../docs/**/*.md\n",
    )

    // listSourceEntries merges config + legacy, deduplicated.
    const merged = await listSourceEntries(root)
    expect(merged.entries).toEqual(["../apps/*/README.md", "../docs/**/*.md"])
  })
})
