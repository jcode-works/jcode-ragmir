import { createHash } from "node:crypto"
import type { Stats } from "node:fs"
import { createReadStream, existsSync } from "node:fs"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import fg from "fast-glob"
import { DEFAULT_CONFIG, LEGACY_KB_DIR, LEGACY_PRIVATE_DIR, RAGMIR_DIR } from "./defaults.js"
import { operationSignal, throwIfAborted } from "./operation.js"
import {
  readSourceFingerprintCache,
  reusableSourceFingerprint,
  type SourceFileIdentity,
  type SourceFingerprintRecord,
  sourceFingerprintRecord,
  writeSourceFingerprintCache,
} from "./source-fingerprint-cache.js"
import type {
  Config,
  OperationOptions,
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
  `**/${RAGMIR_DIR}/**`,
]
const GLOB_PATTERN_CHARS = /[*?[{]/u

interface SourceInputs {
  roots: string[]
  patterns: string[]
  ignorePatterns: string[]
}

type SourceEntryStats = Pick<Stats, "size" | "mtimeMs" | "ctimeMs" | "dev" | "ino" | "mode">

interface SourceCandidate {
  absolutePath: string
  info: SourceEntryStats
  source: string
  relativePath: string
  extension: string
}

interface SourceGlobEntry {
  path: string
  stats?: SourceEntryStats
}

export interface SourceInventoryOptions extends OperationOptions {
  writeFingerprintCache?: boolean
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

export async function listSourceFiles(
  config: Config,
  options: OperationOptions = {},
): Promise<SourceFile[]> {
  return (await inventorySourceFiles(config, options)).supportedFiles
}

export async function inventorySourceFiles(
  config: Config,
  options: SourceInventoryOptions = {},
): Promise<SourceInventory> {
  const signal = operationSignal(options)
  throwIfAborted(signal)
  const inputs = await sourceInputs(config, signal)
  throwIfAborted(signal)
  const excludedPaths = new Set(
    inputs.ignorePatterns.length === 0
      ? []
      : await fg(inputs.ignorePatterns, {
          cwd: config.projectRoot,
          absolute: true,
          onlyFiles: true,
          dot: true,
          followSymbolicLinks: false,
          unique: true,
        }),
  )
  throwIfAborted(signal)
  const candidates = new Map<string, SourceCandidate>()
  const skippedFiles = new Map<string, SkippedSourceFile>()
  const discoveredPaths = new Set<string>()
  const allowedExtensions = supportedExtensions(config)

  const recordSourceCandidate = (
    absolutePath: string,
    info: SourceEntryStats,
    source: string,
  ): void => {
    throwIfAborted(signal)
    if (excludedPaths.has(absolutePath)) {
      return
    }
    const relativePath = path.relative(config.projectRoot, absolutePath)
    if (GENERATED_SOURCE_READMES.has(relativePath)) {
      return
    }
    discoveredPaths.add(absolutePath)

    const extension = path.extname(absolutePath).toLowerCase()
    const skipped = skippedSourceFile(absolutePath, relativePath, source, extension, info.size)

    if (skipped) {
      skippedFiles.set(absolutePath, skipped)
      return
    }

    if (!isSupportedSourceFile(absolutePath, extension, allowedExtensions)) {
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

    if (!candidates.has(absolutePath)) {
      candidates.set(absolutePath, { absolutePath, info, source, relativePath, extension })
    }
  }

  for (const root of inputs.roots) {
    throwIfAborted(signal)
    if (!existsSync(root)) {
      continue
    }

    const rootInfo = await stat(root)
    throwIfAborted(signal)
    const entries: SourceGlobEntry[] = rootInfo.isDirectory()
      ? ((await fg("**/*", {
          cwd: root,
          absolute: true,
          onlyFiles: true,
          dot: true,
          followSymbolicLinks: false,
          ignore: [
            ...DEFAULT_FAST_GLOB_IGNORES,
            ...ignorePatternsForRoot(root, config.projectRoot, inputs.ignorePatterns),
          ],
          objectMode: true,
          stats: true,
          unique: true,
        })) as SourceGlobEntry[])
      : [{ path: root, stats: sourceEntryStats(rootInfo) }]
    throwIfAborted(signal)

    for (const entry of entries) {
      throwIfAborted(signal)
      const absolutePath = path.isAbsolute(entry.path) ? entry.path : path.resolve(root, entry.path)
      const info = entry.stats ?? sourceEntryStats(await stat(absolutePath))
      const relativePath = path.relative(config.projectRoot, absolutePath)
      const source = rootInfo.isDirectory()
        ? path.relative(root, absolutePath) || path.basename(absolutePath)
        : relativePath || path.basename(absolutePath)
      recordSourceCandidate(absolutePath, info, source)
    }
  }

  if (inputs.patterns.length > 0) {
    throwIfAborted(signal)
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
    })) as SourceGlobEntry[]
    throwIfAborted(signal)

    for (const entry of entries) {
      throwIfAborted(signal)
      const absolutePath = path.isAbsolute(entry.path)
        ? entry.path
        : path.resolve(config.projectRoot, entry.path)
      const info = entry.stats ?? sourceEntryStats(await stat(absolutePath))
      const relativePath = path.relative(config.projectRoot, absolutePath)
      recordSourceCandidate(absolutePath, info, relativePath || path.basename(absolutePath))
    }
  }

  const cachedFingerprints =
    config.sourceFingerprintMode === "strict"
      ? new Map<string, SourceFingerprintRecord>()
      : await readSourceFingerprintCache(config)
  const usableCache = cachedFingerprints ?? new Map<string, SourceFingerprintRecord>()
  const nextFingerprints = new Map<string, SourceFingerprintRecord>()
  const files = new Map<string, SourceFile>()
  const verifiedAt = new Date().toISOString()
  let contentBytesRead = 0
  let hashedFiles = 0
  let reusedFingerprints = 0

  await mapLimit([...candidates.values()], config.ingestConcurrency, signal, async (candidate) => {
    const identity = sourceFileIdentity(candidate.absolutePath, candidate.info)
    const reusable = reusableSourceFingerprint(
      usableCache.get(candidate.absolutePath),
      identity,
      config.sourceFingerprintMode,
    )
    let checksum: string
    if (reusable) {
      checksum = reusable.checksum
      reusedFingerprints += 1
      nextFingerprints.set(candidate.absolutePath, reusable)
    } else {
      const hashed = await checksumFile(candidate.absolutePath, signal)
      const currentIdentity = sourceFileIdentity(
        candidate.absolutePath,
        sourceEntryStats(await stat(candidate.absolutePath)),
      )
      if (!sameSourceFileIdentity(identity, currentIdentity)) {
        throw new Error(
          `Source file changed while it was being hashed: ${candidate.relativePath}. Retry ingestion.`,
        )
      }
      checksum = hashed.checksum
      hashedFiles += 1
      contentBytesRead += hashed.bytesRead
      nextFingerprints.set(
        candidate.absolutePath,
        sourceFingerprintRecord(identity, checksum, verifiedAt),
      )
    }
    files.set(candidate.absolutePath, {
      absolutePath: candidate.absolutePath,
      relativePath: candidate.relativePath,
      source: candidate.source,
      extension: candidate.extension,
      bytes: candidate.info.size,
      mtimeMs: candidate.info.mtimeMs,
      checksum,
    })
  })

  if (options.writeFingerprintCache !== false) {
    await writeSourceFingerprintCache(
      [...nextFingerprints.values()].sort((left, right) =>
        left.absolutePath.localeCompare(right.absolutePath),
      ),
      config,
    )
  }

  throwIfAborted(signal)
  return {
    discoveredFiles: discoveredPaths.size,
    supportedFiles: [...files.values()].sort((a, b) =>
      a.relativePath.localeCompare(b.relativePath),
    ),
    skippedFiles: [...skippedFiles.values()].sort((a, b) =>
      a.relativePath.localeCompare(b.relativePath),
    ),
    contentBytesRead,
    hashedFiles,
    reusedFingerprints,
  }
}

async function checksumFile(
  filePath: string,
  signal: AbortSignal | undefined,
): Promise<{ checksum: string; bytesRead: number }> {
  const hash = createHash("sha256")
  let bytesRead = 0
  throwIfAborted(signal)
  try {
    for await (const chunk of createReadStream(filePath, signal ? { signal } : undefined)) {
      throwIfAborted(signal)
      hash.update(chunk)
      bytesRead += chunk.length
    }
  } catch (error) {
    throwIfAborted(signal)
    throw error
  }
  throwIfAborted(signal)
  return { checksum: hash.digest("hex"), bytesRead }
}

async function mapLimit<T>(
  values: T[],
  limit: number,
  signal: AbortSignal | undefined,
  worker: (value: T) => Promise<void>,
): Promise<void> {
  let index = 0
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (index < values.length) {
      throwIfAborted(signal)
      const current = values[index]
      index += 1
      if (current !== undefined) {
        await worker(current)
        throwIfAborted(signal)
      }
    }
  })
  await Promise.all(workers)
}

export function supportedExtensions(config: Config): Set<string> {
  return new Set([
    ...DEFAULT_SUPPORTED_EXTENSIONS,
    ...(config.imageOcrCommand.length > 0 ? OCR_IMAGE_EXTENSIONS : []),
    ...(config.legacyWordCommand.length > 0 ? LEGACY_WORD_EXTENSIONS : []),
    ...config.includeExtensions,
  ])
}

function isSupportedSourceFile(
  absolutePath: string,
  extension: string,
  allowedExtensions: Set<string>,
): boolean {
  if (allowedExtensions.has(extension)) {
    return true
  }
  return DEFAULT_SUPPORTED_FILE_NAMES.has(path.basename(absolutePath).toLowerCase())
}

function sourceEntryStats(stats: Stats): SourceEntryStats {
  return {
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    ctimeMs: stats.ctimeMs,
    dev: stats.dev,
    ino: stats.ino,
    mode: stats.mode,
  }
}

function sourceFileIdentity(absolutePath: string, info: SourceEntryStats): SourceFileIdentity {
  return { absolutePath, ...info }
}

function sameSourceFileIdentity(left: SourceFileIdentity, right: SourceFileIdentity): boolean {
  return (
    left.absolutePath === right.absolutePath &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode
  )
}

function ignorePatternsForRoot(root: string, projectRoot: string, patterns: string[]): string[] {
  const relativeRoot = path.relative(projectRoot, root).replaceAll(path.sep, "/")
  if (!relativeRoot) {
    return patterns
  }
  const prefix = `${relativeRoot}/`
  return patterns.flatMap((pattern) => {
    if (pattern.startsWith(prefix)) {
      return [pattern.slice(prefix.length)]
    }
    return pattern.startsWith("*") ? [pattern] : []
  })
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

async function sourceInputs(
  config: Config,
  signal: AbortSignal | undefined,
): Promise<SourceInputs> {
  throwIfAborted(signal)
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
    let content: string
    try {
      content = await readFile(config.sourcesFile, { encoding: "utf8", signal })
    } catch (error) {
      throwIfAborted(signal)
      throw error
    }
    throwIfAborted(signal)
    for (const line of content.split(/\r?\n/u)) {
      throwIfAborted(signal)
      classifyEntry(line)
    }
  }

  throwIfAborted(signal)
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
