import { createHash } from "node:crypto"
import type { Stats } from "node:fs"
import { createReadStream, existsSync } from "node:fs"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import fg from "fast-glob"
import picomatch from "picomatch"
import { DEFAULT_CONFIG, LEGACY_KB_DIR, LEGACY_PRIVATE_DIR, RAGMIR_DIR } from "./defaults.js"
import { activeIngestionMetrics } from "./ingestion-metrics.js"
import { operationSignal, throwIfAborted } from "./operation.js"
import {
  readSourceFingerprintCache,
  reusableSourceFingerprint,
  type SourceFileIdentity,
  type SourceFingerprintRecord,
  sourceFingerprintRecord,
  writeSourceFingerprintCache,
} from "./source-fingerprint-cache.js"
import {
  canonicalRelativePath,
  canonicalSourcePath,
  compareCodePoints,
  isCaseInsensitiveFileSystem,
  resolveExistingPath,
  sourcePathKey,
  unicodeGlobVariants,
} from "./source-paths.js"
import type {
  Config,
  OperationOptions,
  SkippedSourceFile,
  SkippedSourceReason,
  SourceFile,
  SourceInventory,
  SourceRuleDiagnostics,
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
/**
 * Tool state, dependency caches, lockfiles, and generated bundles that drown out project knowledge.
 * They are skipped unless `defaultExcludes` is false or a source entry names the directory itself.
 */
export const DEFAULT_EXCLUDED_DIRECTORIES = [
  ".agents",
  ".angular",
  ".cache",
  ".claude",
  ".cline",
  ".codex",
  ".cursor",
  ".dart_tool",
  ".expo",
  ".gitnexus",
  ".gradle",
  ".idea",
  ".kimi",
  ".mypy_cache",
  ".next",
  ".nuxt",
  ".nyc_output",
  ".opencode",
  ".parcel-cache",
  ".pnpm-store",
  ".pytest_cache",
  ".ruff_cache",
  ".svelte-kit",
  ".terraform",
  ".tox",
  ".turbo",
  ".venv",
  ".windsurf",
  ".yarn",
  "__pycache__",
  "bower_components",
  "coverage",
  "DerivedData",
  "Pods",
] as const
export const DEFAULT_EXCLUDED_FILES = [
  "*.map",
  "*.min.css",
  "*.min.js",
  "*.min.mjs",
  "bun.lock",
  "bun.lockb",
  "Cargo.lock",
  "composer.lock",
  "deno.lock",
  "flake.lock",
  "Gemfile.lock",
  "go.sum",
  "gradle.lockfile",
  "mix.lock",
  "npm-shrinkwrap.json",
  "package-lock.json",
  "packages.lock.json",
  "Pipfile.lock",
  "pnpm-lock.yaml",
  "Podfile.lock",
  "poetry.lock",
  "pubspec.lock",
  "uv.lock",
  "yarn.lock",
] as const
const GLOB_PATTERN_CHARS = /[*?[{]/u

interface SourceRoot {
  /** On-disk spelling, which can differ from the configured entry by Unicode form or case. */
  path: string
  relativePath: string
}

interface SourceInputs {
  roots: SourceRoot[]
  patterns: string[]
  ignorePatterns: string[]
  unresolvedRoots: string[]
}

interface SourceDiscovery {
  candidates: SourceCandidate[]
  skippedFiles: SkippedSourceFile[]
  discoveredFiles: number
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
  const discovery = await discoverSourceCandidates(config, signal)
  const candidates = new Map(
    discovery.candidates.map((candidate) => [candidate.absolutePath, candidate]),
  )
  throwIfAborted(signal)
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
        compareCodePoints(left.absolutePath, right.absolutePath),
      ),
      config,
    )
  }

  throwIfAborted(signal)
  return {
    discoveredFiles: discovery.discoveredFiles,
    supportedFiles: [...files.values()].sort((a, b) =>
      compareCodePoints(a.relativePath, b.relativePath),
    ),
    skippedFiles: discovery.skippedFiles,
    contentBytesRead,
    hashedFiles,
    reusedFingerprints,
  }
}

export interface DiscoveredSourceFile {
  absolutePath: string
  relativePath: string
  bytes: number
  mtimeMs: number
  identity: SourceFileIdentity
}

export interface SourceDiscoveryResult {
  files: DiscoveredSourceFile[]
  skippedFiles: SkippedSourceFile[]
  discoveredFiles: number
}

/**
 * Discover indexable source files with their size and modification time, without reading content.
 * Freshness checks compare this O(files) view with the index manifest.
 */
export async function discoverSourceFiles(
  config: Config,
  options: OperationOptions = {},
): Promise<SourceDiscoveryResult> {
  const signal = operationSignal(options)
  const discovery = await discoverSourceCandidates(config, signal)
  return {
    files: discovery.candidates
      .map((candidate) => ({
        absolutePath: candidate.absolutePath,
        relativePath: candidate.relativePath,
        bytes: candidate.info.size,
        mtimeMs: candidate.info.mtimeMs,
        identity: sourceFileIdentity(candidate.absolutePath, candidate.info),
      }))
      .sort((left, right) => compareCodePoints(left.relativePath, right.relativePath)),
    skippedFiles: discovery.skippedFiles,
    discoveredFiles: discovery.discoveredFiles,
  }
}

/** Explain source rules that silently select nothing or leave excluded content reachable. */
export async function sourceRuleDiagnostics(
  config: Config,
  supportedFiles: readonly SourceFile[],
  options: OperationOptions = {},
): Promise<SourceRuleDiagnostics> {
  const signal = operationSignal(options)
  const inputs = await sourceInputs(config, signal)
  const caseInsensitive = isCaseInsensitiveFileSystem(config.projectRoot)
  const supportedPaths = supportedFiles.map((file) => file.relativePath)
  const unmatchedPatterns = inputs.patterns.filter((pattern) => {
    const matches = picomatch(pattern, { dot: true, nocase: caseInsensitive })
    return !supportedPaths.some((relativePath) => matches(relativePath))
  })
  const indexedByChecksum = new Map<string, string>()
  for (const file of supportedFiles) {
    if (!indexedByChecksum.has(file.checksum)) {
      indexedByChecksum.set(file.checksum, file.relativePath)
    }
  }
  const unmatchedExclusions: string[] = []
  const excludedCopies: SourceRuleDiagnostics["excludedCopies"] = []
  for (const pattern of inputs.ignorePatterns) {
    throwIfAborted(signal)
    if (GLOB_PATTERN_CHARS.test(pattern)) {
      continue
    }
    const resolved = resolveExistingPath(path.resolve(config.projectRoot, pattern), caseInsensitive)
    if (resolved === null) {
      unmatchedExclusions.push(pattern)
      continue
    }
    const info = await stat(resolved)
    if (!info.isFile() || info.size > config.maxFileBytes) {
      continue
    }
    const { checksum } = await checksumFile(resolved, signal)
    const indexedCopy = indexedByChecksum.get(checksum)
    if (indexedCopy !== undefined) {
      excludedCopies.push({ excluded: pattern, indexedCopy })
    }
  }
  const portabilityWarnings = config.sources.flatMap((entry) => {
    const value = entry.trim().replace(/^!/u, "").trim()
    if (!value || value.startsWith("#")) {
      return []
    }
    if (value.includes("\\")) {
      return [
        `Source entry "${entry}" uses backslashes; write forward slashes so the config works on macOS, Linux, and Windows.`,
      ]
    }
    if (path.isAbsolute(value)) {
      return [
        `Source entry "${entry}" is absolute; a project-relative path keeps the config portable across machines.`,
      ]
    }
    return []
  })
  return {
    unmatchedSources: inputs.unresolvedRoots,
    unmatchedPatterns,
    unmatchedExclusions,
    excludedCopies,
    portabilityWarnings,
  }
}

async function discoverSourceCandidates(
  config: Config,
  signal: AbortSignal | undefined,
): Promise<SourceDiscovery> {
  const inputs = await sourceInputs(config, signal)
  throwIfAborted(signal)
  const caseInsensitive = isCaseInsensitiveFileSystem(config.projectRoot)
  const isExcluded = sourceExclusionMatcher(inputs.ignorePatterns, caseInsensitive)
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
    const relativePath = canonicalRelativePath(config.projectRoot, absolutePath)
    if (isExcluded(relativePath) || GENERATED_SOURCE_READMES.has(relativePath)) {
      return
    }
    const key = sourcePathKey(relativePath, caseInsensitive)
    const existing = candidates.get(key)
    if (existing) {
      if (existing.absolutePath !== absolutePath) {
        // Linux and Windows can hold two names that differ only by Unicode form; both would cite
        // the same canonical path, so the second one is reported instead of silently shadowed.
        skippedFiles.set(absolutePath, {
          relativePath,
          source: canonicalSourcePath(source),
          extension: path.extname(absolutePath).toLowerCase() || NO_EXTENSION,
          bytes: info.size,
          reason: "path-collision",
          recommendation: skippedRecommendation("path-collision", ""),
        })
      }
      return
    }
    discoveredPaths.add(key)

    const extension = path.extname(absolutePath).toLowerCase()
    const canonicalSource = canonicalSourcePath(source)
    const skipped = skippedSourceFile(
      absolutePath,
      relativePath,
      canonicalSource,
      extension,
      info.size,
    )

    if (skipped) {
      skippedFiles.set(key, skipped)
      return
    }

    if (!isSupportedSourceFile(absolutePath, extension, allowedExtensions)) {
      const normalizedExtension = extension || NO_EXTENSION
      skippedFiles.set(key, {
        relativePath,
        source: canonicalSource,
        extension: normalizedExtension,
        bytes: info.size,
        reason: "unsupported-extension",
        recommendation: skippedRecommendation("unsupported-extension", normalizedExtension),
      })
      return
    }

    if (info.size > config.maxFileBytes) {
      const normalizedExtension = extension || NO_EXTENSION
      skippedFiles.set(key, {
        relativePath,
        source: canonicalSource,
        extension: normalizedExtension,
        bytes: info.size,
        reason: "oversized",
        recommendation: skippedRecommendation("oversized", normalizedExtension),
      })
      return
    }

    candidates.set(key, {
      absolutePath,
      info,
      source: canonicalSource,
      relativePath,
      extension,
    })
  }

  for (const root of inputs.roots) {
    throwIfAborted(signal)
    const rootInfo = await stat(root.path)
    throwIfAborted(signal)
    const entries: SourceGlobEntry[] = rootInfo.isDirectory()
      ? ((await fg("**/*", {
          cwd: root.path,
          absolute: true,
          onlyFiles: true,
          dot: true,
          followSymbolicLinks: false,
          caseSensitiveMatch: !caseInsensitive,
          ignore: [
            ...DEFAULT_FAST_GLOB_IGNORES,
            ...defaultExcludeGlobs(config, [root.relativePath]),
            ...unicodeGlobVariants(ignorePatternsForRoot(root.relativePath, inputs.ignorePatterns)),
          ],
          objectMode: true,
          stats: true,
          unique: true,
        })) as SourceGlobEntry[])
      : [{ path: root.path, stats: sourceEntryStats(rootInfo) }]
    throwIfAborted(signal)

    for (const entry of entries) {
      throwIfAborted(signal)
      const absolutePath = path.resolve(root.path, entry.path)
      const info = entry.stats ?? sourceEntryStats(await stat(absolutePath))
      const source = rootInfo.isDirectory()
        ? path.relative(root.path, absolutePath) || path.basename(absolutePath)
        : root.relativePath || path.basename(absolutePath)
      recordSourceCandidate(absolutePath, info, source)
    }
  }

  for (const patterns of patternGroupsByDefaultExcludes(config, inputs.patterns)) {
    throwIfAborted(signal)
    const entries = (await fg(unicodeGlobVariants(patterns), {
      cwd: config.projectRoot,
      absolute: true,
      onlyFiles: true,
      dot: true,
      followSymbolicLinks: false,
      caseSensitiveMatch: !caseInsensitive,
      ignore: [
        ...DEFAULT_FAST_GLOB_IGNORES,
        ...defaultExcludeGlobs(config, patterns),
        ...unicodeGlobVariants(inputs.ignorePatterns),
      ],
      objectMode: true,
      stats: true,
      unique: true,
    })) as SourceGlobEntry[]
    throwIfAborted(signal)

    for (const entry of entries) {
      throwIfAborted(signal)
      const absolutePath = path.resolve(config.projectRoot, entry.path)
      const info = entry.stats ?? sourceEntryStats(await stat(absolutePath))
      const relativePath = canonicalRelativePath(config.projectRoot, absolutePath)
      recordSourceCandidate(absolutePath, info, relativePath || path.basename(absolutePath))
    }
  }

  return {
    candidates: [...candidates.values()],
    skippedFiles: [...skippedFiles.values()].sort((a, b) =>
      compareCodePoints(a.relativePath, b.relativePath),
    ),
    discoveredFiles: discoveredPaths.size,
  }
}

/**
 * Match exclusion rules against canonical project-relative paths, independent of the on-disk
 * Unicode form, and with the volume's case rules. A rule that names a directory excludes its files,
 * as fast-glob ignore patterns do.
 */
function sourceExclusionMatcher(
  patterns: readonly string[],
  caseInsensitive: boolean,
): (relativePath: string) => boolean {
  if (patterns.length === 0) {
    return () => false
  }
  const matches = picomatch([...patterns], { dot: true, nocase: caseInsensitive })
  return (relativePath) => {
    if (matches(relativePath)) {
      return true
    }
    for (
      let index = relativePath.lastIndexOf("/");
      index > 0;
      index = relativePath.lastIndexOf("/", index - 1)
    ) {
      if (matches(relativePath.slice(0, index))) {
        return true
      }
    }
    return false
  }
}

/** Built-in exclusions, minus the ones a source entry targets explicitly. */
function defaultExcludeGlobs(config: Config, sourceEntries: readonly string[]): string[] {
  if (!config.defaultExcludes) {
    return []
  }
  const named = new Set(sourceEntries.flatMap((entry) => literalSegments(entry)))
  return [
    ...DEFAULT_EXCLUDED_DIRECTORIES.filter((directory) => !named.has(directory)).map(
      (directory) => `**/${directory}/**`,
    ),
    ...DEFAULT_EXCLUDED_FILES.filter((file) => !named.has(file)).map((file) => `**/${file}`),
  ]
}

/** Split include patterns so that one naming `.claude/` does not re-enable it for every pattern. */
function patternGroupsByDefaultExcludes(config: Config, patterns: readonly string[]): string[][] {
  const groups = new Map<string, string[]>()
  for (const pattern of patterns) {
    const key = defaultExcludeGlobs(config, [pattern]).join("\0")
    const group = groups.get(key)
    if (group) {
      group.push(pattern)
    } else {
      groups.set(key, [pattern])
    }
  }
  return [...groups.values()]
}

function literalSegments(entry: string): string[] {
  return entry
    .split("/")
    .filter((segment) => segment.length > 0 && !GLOB_PATTERN_CHARS.test(segment))
}

async function checksumFile(
  filePath: string,
  signal: AbortSignal | undefined,
): Promise<{ checksum: string; bytesRead: number }> {
  const hash = createHash("sha256")
  let bytesRead = 0
  const metrics = activeIngestionMetrics()
  metrics?.beginPhase("hashing")
  try {
    throwIfAborted(signal)
    for await (const chunk of createReadStream(filePath, signal ? { signal } : undefined)) {
      throwIfAborted(signal)
      hash.update(chunk)
      bytesRead += chunk.length
    }
    throwIfAborted(signal)
    return { checksum: hash.digest("hex"), bytesRead }
  } catch (error) {
    throwIfAborted(signal)
    throw error
  } finally {
    metrics?.endPhase("hashing")
  }
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

function ignorePatternsForRoot(relativeRoot: string, patterns: readonly string[]): string[] {
  if (!relativeRoot) {
    return [...patterns]
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
  const caseInsensitive = isCaseInsensitiveFileSystem(config.projectRoot)
  const requestedRoots = [config.rawDir]
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
    requestedRoots.push(
      path.isAbsolute(trimmed) ? trimmed : path.resolve(config.projectRoot, trimmed),
    )
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

  const roots: SourceRoot[] = []
  const unresolvedRoots: string[] = []
  for (const requested of requestedRoots) {
    // Linux and Windows compare names byte for byte, so a configured NFC folder name must still
    // reach an NFD folder copied from macOS or an archive.
    const resolved = resolveExistingPath(requested, caseInsensitive)
    if (resolved === null) {
      if (requested !== config.rawDir) {
        unresolvedRoots.push(canonicalRelativePath(config.projectRoot, requested))
      }
      continue
    }
    roots.push({
      path: resolved,
      relativePath: canonicalRelativePath(config.projectRoot, resolved),
    })
  }

  throwIfAborted(signal)
  return { roots, patterns, ignorePatterns, unresolvedRoots }
}

function sourcePattern(projectRoot: string, input: string): string {
  const pattern = path.isAbsolute(input) ? path.relative(projectRoot, input) : input
  return canonicalSourcePath(pattern).replace(/^(?:\.\/)+/u, "")
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
  if (reason === "path-collision") {
    return "Rename one of the files: their names differ only by Unicode normalization, so they would share one citation path."
  }
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
