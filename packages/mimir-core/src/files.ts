import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import fg from "fast-glob"
import { DEFAULT_CONFIG, LEGACY_KB_DIR, LEGACY_PRIVATE_DIR, MIMIR_DIR } from "./defaults.js"
import type {
  Config,
  SkippedSourceFile,
  SkippedSourceReason,
  SourceFile,
  SourceInventory,
} from "./types.js"

const GENERATED_SOURCE_READMES = new Set([
  `${DEFAULT_CONFIG.rawDir}/README.md`,
  `${LEGACY_PRIVATE_DIR}/README.md`,
])
const NO_EXTENSION = "(none)"
const SENSITIVE_FILE_NAMES = new Set([
  ".htpasswd",
  ".netrc",
  ".npmrc",
  ".pgpass",
  ".pypirc",
  "credentials",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_rsa",
])
const SENSITIVE_EXTENSIONS = new Set([
  ".asc",
  ".cer",
  ".crt",
  ".der",
  ".gpg",
  ".jks",
  ".kdbx",
  ".key",
  ".keystore",
  ".ovpn",
  ".p12",
  ".p8",
  ".pem",
  ".pfx",
  ".ppk",
])
export const OCR_IMAGE_EXTENSIONS = new Set([
  ".avif",
  ".bmp",
  ".gif",
  ".heic",
  ".heif",
  ".jpeg",
  ".jpg",
  ".png",
  ".tif",
  ".tiff",
  ".webp",
])
const LEGACY_WORD_EXTENSIONS = new Set([".doc"])
const LEGACY_EXCEL_EXTENSIONS = new Set([".xls"])
const TRANSCRIPTION_EXTENSIONS = new Set([
  ".aac",
  ".aiff",
  ".flac",
  ".m4a",
  ".mkv",
  ".mov",
  ".mp3",
  ".mp4",
  ".ogg",
  ".wav",
  ".webm",
])
const DEFAULT_SUPPORTED_FILE_NAMES = new Set([
  ".dockerignore",
  ".gitignore",
  ".npmignore",
  "dockerfile",
  "gemfile",
  "gradlew",
  "makefile",
  "mvnw",
  "procfile",
  "rakefile",
])
export const DEFAULT_FAST_GLOB_IGNORES = [
  "**/.git/**",
  "**/node_modules/**",
  `**/${LEGACY_KB_DIR}/**`,
  `**/${MIMIR_DIR}/**`,
]
const GLOB_PATTERN_CHARS = /[*?[{]/u

interface SourceInputs {
  roots: string[]
  patterns: string[]
  ignorePatterns: string[]
}

interface SourceEntryStats {
  size: number
  mtimeMs: number
}

export const DEFAULT_SUPPORTED_EXTENSIONS = new Set([
  ".atom",
  ".adoc",
  ".astro",
  ".bash",
  ".bat",
  ".c",
  ".cjs",
  ".cfg",
  ".cmd",
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
  ".example",
  ".exemple",
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
  ".mmd",
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
  const inputs = await sourceInputs(config)
  const files = new Map<string, SourceFile>()
  const skippedFiles = new Map<string, SkippedSourceFile>()
  let discoveredFiles = 0

  const recordSourceFile = async (
    absolutePath: string,
    info: SourceEntryStats,
    source: string,
  ): Promise<void> => {
    const relativePath = path.relative(config.projectRoot, absolutePath)
    if (GENERATED_SOURCE_READMES.has(relativePath)) {
      return
    }
    discoveredFiles += 1

    const extension = path.extname(absolutePath).toLowerCase()
    const skipped = skippedSourceFile(absolutePath, relativePath, source, extension, info.size)

    if (skipped) {
      skippedFiles.set(absolutePath, skipped)
      return
    }

    if (!isSupportedSourceFile(absolutePath, extension, config)) {
      const normalizedExtension = extension || NO_EXTENSION
      skippedFiles.set(absolutePath, {
        relativePath,
        source,
        extension: normalizedExtension,
        bytes: info.size,
        reason: "unsupported-extension",
        recommendation: skippedRecommendation("unsupported-extension", normalizedExtension),
      })
      return
    }

    if (info.size > config.maxFileBytes) {
      const normalizedExtension = extension || NO_EXTENSION
      skippedFiles.set(absolutePath, {
        relativePath,
        source,
        extension: normalizedExtension,
        bytes: info.size,
        reason: "oversized",
        recommendation: skippedRecommendation("oversized", normalizedExtension),
      })
      return
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

  for (const root of inputs.roots) {
    if (!existsSync(root)) {
      continue
    }

    const rootInfo = await stat(root)
    const entries = rootInfo.isDirectory()
      ? ((await fg("**/*", {
          cwd: root,
          absolute: true,
          onlyFiles: true,
          dot: true,
          followSymbolicLinks: false,
          ignore: DEFAULT_FAST_GLOB_IGNORES,
          objectMode: true,
          stats: true,
          unique: true,
        })) as Array<{ path: string; stats?: { size: number; mtimeMs: number } }>)
      : [{ path: root, stats: { size: rootInfo.size, mtimeMs: rootInfo.mtimeMs } }]

    for (const entry of entries) {
      const absolutePath = path.isAbsolute(entry.path) ? entry.path : path.resolve(root, entry.path)
      const info = entry.stats ?? (await stat(absolutePath))
      const relativePath = path.relative(config.projectRoot, absolutePath)
      const source = rootInfo.isDirectory()
        ? path.relative(root, absolutePath) || path.basename(absolutePath)
        : relativePath || path.basename(absolutePath)
      await recordSourceFile(absolutePath, info, source)
    }
  }

  if (inputs.patterns.length > 0) {
    const entries = (await fg(inputs.patterns, {
      cwd: config.projectRoot,
      absolute: true,
      onlyFiles: true,
      dot: true,
      followSymbolicLinks: false,
      ignore: [...DEFAULT_FAST_GLOB_IGNORES, ...inputs.ignorePatterns],
      objectMode: true,
      stats: true,
      unique: true,
    })) as Array<{ path: string; stats?: { size: number; mtimeMs: number } }>

    for (const entry of entries) {
      const absolutePath = path.isAbsolute(entry.path)
        ? entry.path
        : path.resolve(config.projectRoot, entry.path)
      const info = entry.stats ?? (await stat(absolutePath))
      const relativePath = path.relative(config.projectRoot, absolutePath)
      await recordSourceFile(absolutePath, info, relativePath || path.basename(absolutePath))
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
  return new Set([
    ...DEFAULT_SUPPORTED_EXTENSIONS,
    ...(config.imageOcrCommand.length > 0 ? OCR_IMAGE_EXTENSIONS : []),
    ...(config.legacyWordCommand.length > 0 ? LEGACY_WORD_EXTENSIONS : []),
    ...config.includeExtensions,
  ])
}

function isSupportedSourceFile(absolutePath: string, extension: string, config: Config): boolean {
  if (supportedExtensions(config).has(extension)) {
    return true
  }
  return DEFAULT_SUPPORTED_FILE_NAMES.has(path.basename(absolutePath).toLowerCase())
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

async function sourceInputs(config: Config): Promise<SourceInputs> {
  const roots = [config.rawDir]
  const patterns: string[] = []
  const ignorePatterns: string[] = []

  const classifyEntry = (entry: string): void => {
    const trimmed = entry.trim()
    if (!trimmed || trimmed.startsWith("#")) {
      return
    }
    if (trimmed.startsWith("!")) {
      ignorePatterns.push(sourcePattern(config.projectRoot, trimmed.slice(1).trim()))
      return
    }
    if (GLOB_PATTERN_CHARS.test(trimmed)) {
      patterns.push(sourcePattern(config.projectRoot, trimmed))
      return
    }
    roots.push(path.isAbsolute(trimmed) ? trimmed : path.resolve(config.projectRoot, trimmed))
  }

  // Inline `sources` from config.json are the primary mechanism; the legacy
  // sources.txt file is still read when present so existing projects keep working.
  for (const entry of config.sources) {
    classifyEntry(entry)
  }

  if (existsSync(config.sourcesFile)) {
    const content = await readFile(config.sourcesFile, "utf8")
    for (const line of content.split(/\r?\n/u)) {
      classifyEntry(line)
    }
  }

  return { roots, patterns, ignorePatterns }
}

function sourcePattern(projectRoot: string, input: string): string {
  if (path.isAbsolute(input)) {
    return path.relative(projectRoot, input).replaceAll(path.sep, "/")
  }
  return input.replaceAll(path.sep, "/")
}

export function isSensitiveFilePath(absolutePath: string): boolean {
  const baseName = path.basename(absolutePath).toLowerCase()
  const extension = path.extname(absolutePath).toLowerCase()
  return (
    isEnvFileName(baseName) ||
    SENSITIVE_FILE_NAMES.has(baseName) ||
    SENSITIVE_EXTENSIONS.has(extension)
  )
}

function isEnvFileName(baseName: string): boolean {
  return baseName === ".env" || baseName.startsWith(".env.")
}

export function countSkippedByReason(
  files: Array<{ reason: SkippedSourceReason }>,
  reason: SkippedSourceReason,
): number {
  return files.filter((file) => file.reason === reason).length
}

function skippedSourceFile(
  absolutePath: string,
  relativePath: string,
  source: string,
  extension: string,
  bytes: number,
): SkippedSourceFile | null {
  if (!isSensitiveFilePath(absolutePath)) {
    return null
  }
  return {
    relativePath,
    source,
    extension: extension || NO_EXTENSION,
    bytes,
    reason: "sensitive-name",
    recommendation: skippedRecommendation("sensitive-name", extension || NO_EXTENSION),
  }
}

function skippedRecommendation(reason: SkippedSourceReason, extension: string): string {
  if (reason === "sensitive-name") {
    return "Review manually; secret-like files are skipped to avoid indexing credentials or private keys."
  }
  if (reason === "oversized") {
    return "Split, compress, or raise maxFileBytes only after confirming the file is safe and useful."
  }
  if (OCR_IMAGE_EXTENSIONS.has(extension)) {
    return "Configure imageOcrCommand for local image OCR, save extracted text as a supported text file, or convert to an OCRed PDF before ingesting."
  }
  if (LEGACY_WORD_EXTENSIONS.has(extension)) {
    return "Configure legacyWordCommand for local legacy Word extraction, or convert to DOCX, PDF, HTML, or text before ingesting."
  }
  if (LEGACY_EXCEL_EXTENSIONS.has(extension)) {
    return "Convert legacy XLS workbooks to XLSX, CSV, PDF, HTML, or text before ingesting."
  }
  if (TRANSCRIPTION_EXTENSIONS.has(extension)) {
    return "Transcribe to text, VTT, or SRT before ingesting."
  }
  return "Convert to a supported text, PDF, Office, OpenDocument, EPUB, or HTML format; use includeExtensions only for UTF-8 text files."
}
