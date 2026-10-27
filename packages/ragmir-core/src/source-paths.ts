import { randomUUID } from "node:crypto"
import { existsSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"

/**
 * Source paths are stored, filtered, and cited in one canonical form on every platform: forward
 * slashes and Unicode NFC. File systems disagree on both. Windows returns backslashes, macOS can
 * store accented names decomposed (NFD) when they come from older volumes, archives, or sync
 * clients, and Linux and Windows compare names byte for byte, so an NFC rule never matches an NFD
 * name there. Disk operations keep the real on-disk name; identity uses the canonical form.
 */
export function canonicalSourcePath(value: string): string {
  return value.split(path.sep).join("/").normalize("NFC")
}

/** Project-relative canonical path, for example `docs/Études/plan.md`. */
export function canonicalRelativePath(projectRoot: string, absolutePath: string): string {
  return canonicalSourcePath(path.relative(projectRoot, absolutePath))
}

/**
 * Normalize a path typed by a person or an agent: backslashes become forward slashes on every
 * platform, a leading `./` and trailing slashes are dropped, and the result is NFC.
 */
export function canonicalUserPath(value: string): string {
  return value
    .trim()
    .replaceAll("\\", "/")
    .replace(/^(?:\.\/)+/u, "")
    .replace(/\/+$/u, "")
    .normalize("NFC")
}

/** Both Unicode forms of a path, so filters also match rows indexed before canonical paths. */
export function unicodePathVariants(value: string): string[] {
  return [...new Set([value.normalize("NFC"), value.normalize("NFD"), value])]
}

/** Glob patterns in both Unicode forms; glob syntax is ASCII, so normalization keeps it intact. */
export function unicodeGlobVariants(patterns: readonly string[]): string[] {
  return [...new Set(patterns.flatMap((pattern) => unicodePathVariants(pattern)))]
}

const caseInsensitiveCache = new Map<string, boolean>()

/**
 * Whether names in `directory` compare case-insensitively, as on default macOS (APFS) and Windows
 * (NTFS) volumes. Path rules then match the way the operating system and Git resolve names there.
 * The probe writes and removes one empty temporary file only when no existing entry can answer.
 */
export function isCaseInsensitiveFileSystem(directory: string): boolean {
  const resolved = path.resolve(directory)
  const cached = caseInsensitiveCache.get(resolved)
  if (cached !== undefined) {
    return cached
  }
  const result = probeCaseInsensitivity(resolved)
  caseInsensitiveCache.set(resolved, result)
  return result
}

function probeCaseInsensitivity(directory: string): boolean {
  const fallback = process.platform === "darwin" || process.platform === "win32"
  try {
    if (!statSync(directory).isDirectory()) {
      return fallback
    }
    const entry = readdirSync(directory).find((name) => swapCase(name) !== name)
    if (entry !== undefined) {
      return sameEntry(path.join(directory, entry), path.join(directory, swapCase(entry)))
    }
    const probeName = `.ragmir-case-${randomUUID()}.tmp`
    const probePath = path.join(directory, probeName)
    try {
      writeFileSync(probePath, "", { flag: "wx" })
      return existsSync(path.join(directory, probeName.toUpperCase()))
    } finally {
      rmSync(probePath, { force: true })
    }
  } catch {
    return fallback
  }
}

function sameEntry(left: string, right: string): boolean {
  try {
    const leftStats = statSync(left)
    const rightStats = statSync(right)
    return leftStats.ino === rightStats.ino && leftStats.dev === rightStats.dev
  } catch {
    return false
  }
}

function swapCase(value: string): string {
  let swapped = ""
  for (const character of value) {
    const lower = character.toLowerCase()
    swapped += lower === character ? character.toUpperCase() : lower
  }
  return swapped
}

/** Key for set membership: canonical form, case-folded when the volume ignores case. */
export function sourcePathKey(canonicalPath: string, caseInsensitive: boolean): string {
  return caseInsensitive ? canonicalPath.toLowerCase() : canonicalPath
}

/**
 * Resolve the on-disk spelling of a path whose segments may differ from the stored names only by
 * Unicode normalization (or by case on a case-insensitive volume). Returns the path unchanged when
 * it already exists, the matching on-disk path otherwise, or null when no entry matches.
 */
export function resolveExistingPath(absolutePath: string, caseInsensitive = false): string | null {
  if (existsSync(absolutePath)) {
    return absolutePath
  }
  const resolved = path.resolve(absolutePath)
  const { root } = path.parse(resolved)
  const segments = resolved.slice(root.length).split(path.sep).filter(Boolean)
  let current = root
  for (const segment of segments) {
    const direct = path.join(current, segment)
    if (existsSync(direct)) {
      current = direct
      continue
    }
    let entries: string[]
    try {
      entries = readdirSync(current)
    } catch {
      return null
    }
    const wanted = comparableSegment(segment, caseInsensitive)
    const match = entries.find((entry) => comparableSegment(entry, caseInsensitive) === wanted)
    if (match === undefined) {
      return null
    }
    current = path.join(current, match)
  }
  return current
}

function comparableSegment(segment: string, caseInsensitive: boolean): string {
  const normalized = segment.normalize("NFC")
  return caseInsensitive ? normalized.toLowerCase() : normalized
}

/** Deterministic, locale-independent ordering by Unicode scalar values. */
export function compareCodePoints(left: string, right: string): number {
  let leftIndex = 0
  let rightIndex = 0
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftCodePoint = left.codePointAt(leftIndex)
    const rightCodePoint = right.codePointAt(rightIndex)
    if (leftCodePoint === undefined || rightCodePoint === undefined) {
      break
    }
    if (leftCodePoint !== rightCodePoint) {
      return leftCodePoint - rightCodePoint
    }
    leftIndex += leftCodePoint > 0xffff ? 2 : 1
    rightIndex += rightCodePoint > 0xffff ? 2 : 1
  }
  return left.length - right.length
}
