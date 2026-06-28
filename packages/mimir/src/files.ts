import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import fg from "fast-glob"
import { PRIVATE_DIR } from "./defaults.js"
import type { Config, SkippedSourceFile, SourceFile, SourceInventory } from "./types.js"

const GENERATED_SOURCE_README = `${PRIVATE_DIR}/README.md`
const NO_EXTENSION = "(none)"
const SENSITIVE_FILE_NAMES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".npmrc",
  ".pypirc",
  ".netrc",
  ".pgpass",
])
const SENSITIVE_EXTENSIONS = new Set([
  ".crt",
  ".der",
  ".gpg",
  ".jks",
  ".key",
  ".keystore",
  ".p12",
  ".pem",
  ".pfx",
])

export const DEFAULT_SUPPORTED_EXTENSIONS = new Set([
  ".atom",
  ".adoc",
  ".astro",
  ".bash",
  ".c",
  ".cjs",
  ".cfg",
  ".conf",
  ".cpp",
  ".cs",
  ".css",
  ".csv",
  ".cts",
  ".diff",
  ".docx",
  ".eml",
  ".epub",
  ".go",
  ".h",
  ".hpp",
  ".htm",
  ".html",
  ".ics",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".jsonl",
  ".jsx",
  ".ipynb",
  ".log",
  ".markdown",
  ".md",
  ".mdown",
  ".mdx",
  ".mjs",
  ".mts",
  ".ndjson",
  ".odp",
  ".ods",
  ".odt",
  ".patch",
  ".pdf",
  ".php",
  ".pptx",
  ".properties",
  ".ps1",
  ".py",
  ".rb",
  ".rst",
  ".rs",
  ".rss",
  ".rtf",
  ".scss",
  ".srt",
  ".svelte",
  ".svg",
  ".sh",
  ".sql",
  ".tex",
  ".text",
  ".toml",
  ".ts",
  ".tsv",
  ".tsx",
  ".txt",
  ".vtt",
  ".vue",
  ".xml",
  ".xlsx",
  ".yaml",
  ".yml",
])

export async function listSourceFiles(config: Config): Promise<SourceFile[]> {
  return (await inventorySourceFiles(config)).supportedFiles
}

export async function inventorySourceFiles(config: Config): Promise<SourceInventory> {
  const roots = await sourceRoots(config)
  const files = new Map<string, SourceFile>()
  const skippedFiles = new Map<string, SkippedSourceFile>()
  let discoveredFiles = 0

  for (const root of roots) {
    if (!existsSync(root)) {
      continue
    }

    const entries = (await fg("**/*", {
      cwd: root,
      absolute: true,
      onlyFiles: true,
      dot: false,
      followSymbolicLinks: false,
      ignore: ["**/.git/**", "**/node_modules/**", "**/.kb/**", "**/.mimir/**"],
      objectMode: true,
      stats: true,
      unique: true,
    })) as Array<{ path: string; stats?: { size: number; mtimeMs: number } }>

    for (const entry of entries) {
      const absolutePath = path.isAbsolute(entry.path) ? entry.path : path.resolve(root, entry.path)
      const relativePath = path.relative(config.projectRoot, absolutePath)
      if (relativePath === GENERATED_SOURCE_README) {
        continue
      }
      discoveredFiles += 1

      const extension = path.extname(absolutePath).toLowerCase()
      const info = entry.stats ?? (await stat(absolutePath))
      const source = path.relative(root, absolutePath) || path.basename(absolutePath)
      const skipped = skippedSourceFile(absolutePath, relativePath, source, extension, info.size)

      if (skipped) {
        skippedFiles.set(absolutePath, skipped)
        continue
      }

      if (!supportedExtensions(config).has(extension)) {
        skippedFiles.set(absolutePath, {
          relativePath,
          source,
          extension: extension || NO_EXTENSION,
          bytes: info.size,
          reason: "unsupported-extension",
        })
        continue
      }

      if (info.size > config.maxFileBytes) {
        skippedFiles.set(absolutePath, {
          relativePath,
          source,
          extension: extension || NO_EXTENSION,
          bytes: info.size,
          reason: "oversized",
        })
        continue
      }

      const buffer = await readFile(absolutePath)
      files.set(absolutePath, {
        absolutePath,
        relativePath,
        source,
        extension,
        bytes: info.size,
        mtimeMs: info.mtimeMs,
        checksum: createHash("sha256").update(buffer).digest("hex"),
      })
    }
  }

  return {
    discoveredFiles,
    supportedFiles: [...files.values()].sort((a, b) =>
      a.relativePath.localeCompare(b.relativePath),
    ),
    skippedFiles: [...skippedFiles.values()].sort((a, b) =>
      a.relativePath.localeCompare(b.relativePath),
    ),
  }
}

export function supportedExtensions(config: Config): Set<string> {
  return new Set([...DEFAULT_SUPPORTED_EXTENSIONS, ...config.includeExtensions])
}

export function summarizeUnsupportedExtensions(
  skippedFiles: SkippedSourceFile[],
): Array<{ extension: string; count: number }> {
  const counts = new Map<string, number>()
  for (const file of skippedFiles) {
    if (file.reason !== "unsupported-extension") {
      continue
    }
    counts.set(file.extension, (counts.get(file.extension) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([extension, count]) => ({ extension, count }))
}

async function sourceRoots(config: Config): Promise<string[]> {
  const roots = [config.rawDir]
  if (!existsSync(config.sourcesFile)) {
    return roots
  }

  const content = await readFile(config.sourcesFile, "utf8")
  for (const line of content.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) {
      continue
    }
    roots.push(path.isAbsolute(trimmed) ? trimmed : path.resolve(config.projectRoot, trimmed))
  }

  return roots
}

function skippedSourceFile(
  absolutePath: string,
  relativePath: string,
  source: string,
  extension: string,
  bytes: number,
): SkippedSourceFile | null {
  const baseName = path.basename(absolutePath).toLowerCase()
  if (!SENSITIVE_FILE_NAMES.has(baseName) && !SENSITIVE_EXTENSIONS.has(extension)) {
    return null
  }
  return {
    relativePath,
    source,
    extension: extension || NO_EXTENSION,
    bytes,
    reason: "sensitive-name",
  }
}
