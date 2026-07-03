import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { loadConfig } from "./config.js"
import { SOURCES_FILE_HEADER } from "./defaults.js"

export interface SourceEntriesResult {
  sourcesFile: string
  entries: string[]
}

export interface AddSourceEntriesOptions {
  cwd?: string
  entries: readonly string[]
}

export interface AddSourceEntriesResult {
  sourcesFile: string
  added: string[]
  skipped: string[]
}

export async function listSourceEntries(cwd = process.cwd()): Promise<SourceEntriesResult> {
  const config = await loadConfig(cwd)
  const content = await readSourcesFile(config.sourcesFile)
  return {
    sourcesFile: config.sourcesFile,
    entries: content ? parseSourceEntries(content) : [],
  }
}

export async function addSourceEntries(
  options: AddSourceEntriesOptions,
): Promise<AddSourceEntriesResult> {
  const entries = normalizeRequestedEntries(options.entries)
  if (entries.length === 0) {
    throw new Error("At least one source path or glob is required.")
  }

  const config = await loadConfig(options.cwd)
  const content = await readSourcesFile(config.sourcesFile)
  const existingEntries = new Set(content ? parseSourceEntries(content) : [])
  const added: string[] = []
  const skipped: string[] = []

  for (const entry of entries) {
    if (existingEntries.has(entry)) {
      skipped.push(entry)
      continue
    }
    existingEntries.add(entry)
    added.push(entry)
  }

  if (added.length > 0) {
    await mkdir(path.dirname(config.sourcesFile), { recursive: true })
    await writeFile(config.sourcesFile, nextSourcesFileContent(content, added), "utf8")
  }

  return {
    sourcesFile: config.sourcesFile,
    added,
    skipped,
  }
}

async function readSourcesFile(sourcesFile: string): Promise<string | null> {
  if (!existsSync(sourcesFile)) {
    return null
  }
  return readFile(sourcesFile, "utf8")
}

function parseSourceEntries(content: string): string[] {
  return content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
}

function normalizeRequestedEntries(entries: readonly string[]): string[] {
  const normalized: string[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    const trimmed = entry.trim()
    if (!trimmed || seen.has(trimmed)) {
      continue
    }
    seen.add(trimmed)
    normalized.push(trimmed)
  }
  return normalized
}

function nextSourcesFileContent(currentContent: string | null, added: readonly string[]): string {
  const base = currentContent === null ? SOURCES_FILE_HEADER.join("\n") : currentContent.trimEnd()
  return `${base ? `${base}\n` : ""}${added.join("\n")}\n`
}
