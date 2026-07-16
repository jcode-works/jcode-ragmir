import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { findProjectConfig, loadConfig } from "./config.js"
import { mutateProjectConfig, readProjectConfigObject } from "./project-config-file.js"

export interface SourceEntriesResult {
  /** Where the listed entries come from: always config.json now. */
  sourcesFile: string
  entries: string[]
}

export interface AddSourceEntriesOptions {
  cwd?: string
  entries: readonly string[]
}

export interface AddSourceEntriesResult {
  /** config.json path the entries were written to. */
  sourcesFile: string
  added: string[]
  skipped: string[]
}

/**
 * List the configured source entries. Sources live in the `sources` array of
 * `.ragmir/config.json` (the primary mechanism). A legacy `.ragmir/sources.txt`
 * is still read and merged when present so existing projects keep working, but
 * it is never created or written by these functions anymore.
 */
export async function listSourceEntries(cwd = process.cwd()): Promise<SourceEntriesResult> {
  const config = await loadConfig(cwd)
  const projectConfig = findProjectConfig(cwd)
  const configEntries = await readConfigSources(projectConfig)
  const legacyEntries = await readLegacySourcesTxt(config.sourcesFile)
  const seen = new Set<string>()
  const entries: string[] = []
  for (const entry of [...configEntries, ...legacyEntries]) {
    if (!seen.has(entry)) {
      seen.add(entry)
      entries.push(entry)
    }
  }
  return { sourcesFile: projectConfig.configPath, entries }
}

/**
 * Add source entries to the `sources` array of `.ragmir/config.json`. Does not
 * touch the legacy `sources.txt` file anymore; entries already present there
 * are treated as existing (skipped) to avoid duplicates.
 */
export async function addSourceEntries(
  options: AddSourceEntriesOptions,
): Promise<AddSourceEntriesResult> {
  const requested = normalizeRequestedEntries(options.entries)
  if (requested.length === 0) {
    throw new Error("At least one source path or glob is required.")
  }

  const config = await loadConfig(options.cwd)
  const projectConfig = findProjectConfig(options.cwd ?? process.cwd())
  const legacyEntries = await readLegacySourcesTxt(config.sourcesFile)
  const { added, skipped } = await mutateProjectConfig(projectConfig, (raw) => {
    const configEntries = configSources(raw)
    const existingEntries = new Set<string>([...configEntries, ...legacyEntries])
    const added: string[] = []
    const skipped: string[] = []

    for (const entry of requested) {
      if (existingEntries.has(entry)) {
        skipped.push(entry)
        continue
      }
      existingEntries.add(entry)
      added.push(entry)
    }
    if (added.length > 0) raw.sources = [...configEntries, ...added]
    return { changed: added.length > 0, value: { added, skipped } }
  })

  return {
    sourcesFile: projectConfig.configPath,
    added,
    skipped,
  }
}

/** Read the raw `sources` array from config.json without resolving paths. */
async function readConfigSources(projectConfig: {
  configPath: string
  projectRoot: string
}): Promise<string[]> {
  try {
    return configSources(await readProjectConfigObject(projectConfig))
  } catch {
    // Fall back to empty if the config is unreadable; loadConfig surfaces real errors elsewhere.
  }
  return []
}

function configSources(raw: Record<string, unknown>): string[] {
  return Array.isArray(raw.sources)
    ? raw.sources.filter((entry): entry is string => typeof entry === "string")
    : []
}

/** Read the legacy sources.txt read-only for backward compatibility. */
async function readLegacySourcesTxt(sourcesFile: string): Promise<string[]> {
  if (!existsSync(sourcesFile)) {
    return []
  }
  const content = await readFile(sourcesFile, "utf8")
  return parseSourceEntries(content)
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
