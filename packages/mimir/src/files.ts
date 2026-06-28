import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import fg from "fast-glob"
import type { Config, SourceFile } from "./types.js"

export const DEFAULT_SUPPORTED_EXTENSIONS = new Set([
  ".atom",
  ".c",
  ".cfg",
  ".conf",
  ".cpp",
  ".cs",
  ".css",
  ".csv",
  ".docx",
  ".go",
  ".h",
  ".htm",
  ".html",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".jsonl",
  ".jsx",
  ".log",
  ".md",
  ".mdx",
  ".ndjson",
  ".odp",
  ".ods",
  ".odt",
  ".pdf",
  ".php",
  ".pptx",
  ".properties",
  ".py",
  ".rb",
  ".rs",
  ".rss",
  ".rtf",
  ".sql",
  ".text",
  ".toml",
  ".ts",
  ".tsv",
  ".tsx",
  ".txt",
  ".xml",
  ".xlsx",
  ".yaml",
  ".yml",
])

export async function listSourceFiles(config: Config): Promise<SourceFile[]> {
  const roots = await sourceRoots(config)
  const files = new Map<string, SourceFile>()

  for (const root of roots) {
    if (!existsSync(root)) {
      continue
    }

    const entries = await fg("**/*", {
      cwd: root,
      absolute: true,
      onlyFiles: true,
      dot: false,
      followSymbolicLinks: false,
      ignore: ["**/.git/**", "**/node_modules/**", "**/.kb/**", "**/.mimir/**"],
    })

    for (const absolutePath of entries) {
      const extension = path.extname(absolutePath).toLowerCase()
      if (!supportedExtensions(config).has(extension)) {
        continue
      }

      const info = await stat(absolutePath)
      const buffer = await readFile(absolutePath)
      files.set(absolutePath, {
        absolutePath,
        relativePath: path.relative(config.projectRoot, absolutePath),
        source: path.relative(root, absolutePath) || path.basename(absolutePath),
        extension,
        bytes: info.size,
        mtimeMs: info.mtimeMs,
        checksum: createHash("sha256").update(buffer).digest("hex"),
      })
    }
  }

  return [...files.values()].sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

export function supportedExtensions(config: Config): Set<string> {
  return new Set([...DEFAULT_SUPPORTED_EXTENSIONS, ...config.includeExtensions])
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
