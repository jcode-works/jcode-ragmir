import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { findProjectConfig, loadConfig, type ProjectConfigFile } from "./config.js"
import { mutateProjectConfig, readProjectConfigObject } from "./project-config-file.js"

export interface SourceEntriesResult {
  /**
   * Config file the listed entries come from: the machine-local `.ragmir/config.json` when it sets
   * `sources`, else the committed `ragmir.config.json`.
   */
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
 * List the source entries the project indexes: the `sources` array of `.ragmir/config.json`, or
 * of the committed `ragmir.config.json` when the local file does not set one (a local array
 * replaces the shared one as a whole). A legacy `.ragmir/sources.txt` is still read and merged when
 * present so existing projects keep working, but these functions never create or write it.
 */
export async function listSourceEntries(cwd = process.cwd()): Promise<SourceEntriesResult> {
  const config = await loadConfig(cwd)
  const projectConfig = findProjectConfig(cwd)
  const effective = await readEffectiveConfigSources(projectConfig)
  const legacyEntries = await readLegacySourcesTxt(config.sourcesFile)
  const seen = new Set<string>()
  const entries: string[] = []
  for (const entry of [...effective.entries, ...legacyEntries]) {
    if (!seen.has(entry)) {
      seen.add(entry)
      entries.push(entry)
    }
  }
  return { sourcesFile: effective.file, entries }
}

/**
 * Add source entries to the `sources` array of the config file CLI changes write to. When the
 * local `.ragmir/config.json` does not set `sources` yet, the new array starts from the shared
 * `ragmir.config.json` sources, so adding an entry never drops the team's list. Does not touch the
 * legacy `sources.txt` file anymore; entries already present there are treated as existing
 * (skipped) to avoid duplicates.
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
  const sharedEntries = await readSharedConfigSources(projectConfig)
  const { added, skipped } = await mutateProjectConfig(projectConfig, (raw) => {
    const configEntries = Array.isArray(raw.sources) ? configSources(raw) : (sharedEntries ?? [])
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

/**
 * Read the raw `sources` array that applies to the project, without resolving paths: the one the
 * CLI writes to when it sets `sources`, else the shared config's.
 */
async function readEffectiveConfigSources(
  projectConfig: ProjectConfigFile,
): Promise<{ file: string; entries: string[] }> {
  try {
    const raw = await readProjectConfigObject(projectConfig)
    if (Array.isArray(raw.sources)) {
      return { file: projectConfig.configPath, entries: configSources(raw) }
    }
  } catch {
    // Fall back to empty if the config is unreadable; loadConfig surfaces real errors elsewhere.
    return { file: projectConfig.configPath, entries: [] }
  }
  const sharedEntries = await readSharedConfigSources(projectConfig)
  return sharedEntries !== null && projectConfig.sharedConfigPath !== null
    ? { file: projectConfig.sharedConfigPath, entries: sharedEntries }
    : { file: projectConfig.configPath, entries: [] }
}

/**
 * The shared `ragmir.config.json` sources when the CLI writes to a separate local file, or null
 * when there is no separate shared file or it sets no `sources`.
 */
async function readSharedConfigSources(projectConfig: ProjectConfigFile): Promise<string[] | null> {
  const sharedPath = projectConfig.sharedConfigPath
  if (sharedPath === null || sharedPath === projectConfig.configPath) {
    return null
  }
  try {
    const raw = await readProjectConfigObject({
      configPath: sharedPath,
      projectRoot: projectConfig.projectRoot,
    })
    return Array.isArray(raw.sources) ? configSources(raw) : null
  } catch {
    // loadConfig reports an unreadable shared config with its real error.
    return null
  }
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
