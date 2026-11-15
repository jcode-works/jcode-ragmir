import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { initProject } from "./init.js"
import { enableSemanticEmbeddings } from "./semantic-config.js"
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

  it("lists the shared sources and extends them when the local config sets none", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-sources-shared-"))
    tempDirs.push(root)
    const sharedPath = path.join(root, "ragmir.config.json")
    const localPath = path.join(root, ".ragmir", "config.json")
    await writeFile(sharedPath, JSON.stringify({ sources: ["docs/**/*.md", "!docs/archive/**"] }))
    await mkdir(path.dirname(localPath), { recursive: true })
    await writeFile(localPath, JSON.stringify({ retrievalProfile: "balanced" }))

    await expect(listSourceEntries(root)).resolves.toEqual({
      sourcesFile: sharedPath,
      entries: ["docs/**/*.md", "!docs/archive/**"],
    })

    const result = await addSourceEntries({ cwd: root, entries: ["src/**/*.ts", "docs/**/*.md"] })

    expect(result).toEqual({
      sourcesFile: localPath,
      added: ["src/**/*.ts"],
      skipped: ["docs/**/*.md"],
    })
    // The local array replaces the shared one, so it must carry the shared entries forward.
    const local = JSON.parse(await readFile(localPath, "utf8"))
    expect(local).toEqual({
      retrievalProfile: "balanced",
      sources: ["docs/**/*.md", "!docs/archive/**", "src/**/*.ts"],
    })
    expect(JSON.parse(await readFile(sharedPath, "utf8")).sources).toEqual([
      "docs/**/*.md",
      "!docs/archive/**",
    ])
    await expect(listSourceEntries(root)).resolves.toEqual({
      sourcesFile: localPath,
      entries: ["docs/**/*.md", "!docs/archive/**", "src/**/*.ts"],
    })
  })

  it("writes to the shared config when it is the only one", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-sources-shared-only-"))
    tempDirs.push(root)
    const sharedPath = path.join(root, "ragmir.config.json")
    await writeFile(sharedPath, JSON.stringify({ name: "Handbook", sources: ["docs"] }))

    await addSourceEntries({ cwd: root, entries: ["specs/**/*.pdf"] })

    expect(JSON.parse(await readFile(sharedPath, "utf8"))).toEqual({
      name: "Handbook",
      sources: ["docs", "specs/**/*.pdf"],
    })
    expect(existsSync(path.join(root, ".ragmir", "config.json"))).toBe(false)
  })

  it("should preserve concurrent updates from independent config features", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-sources-concurrent-"))
    tempDirs.push(root)
    await initProject(root)

    await Promise.all([
      addSourceEntries({ cwd: root, entries: ["../apps/a/README.md"] }),
      addSourceEntries({ cwd: root, entries: ["../apps/b/README.md"] }),
      enableSemanticEmbeddings(root),
    ])

    const config = JSON.parse(
      await readFile(path.join(root, ".ragmir", "config.json"), "utf8"),
    ) as { embeddingProvider: string; sources: string[]; transformersAllowRemoteModels: boolean }
    expect(new Set(config.sources)).toEqual(new Set(["../apps/a/README.md", "../apps/b/README.md"]))
    expect(config.embeddingProvider).toBe("transformers")
    expect(config.transformersAllowRemoteModels).toBe(false)
  })
})
