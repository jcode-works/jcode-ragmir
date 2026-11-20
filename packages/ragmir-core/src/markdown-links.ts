import path from "node:path"
import { lineNumberForOffset, lineStartOffsets } from "./chunking.js"
import { markdownFenceSpans } from "./document-structure.js"

/** A link a Markdown page writes to another file of the project. */
export interface MarkdownLink {
  /** Line of the link in the page, from 1. */
  line: number
  /** Character offset of the link in the text it was read from. */
  offset: number
  /** The target as written, without its `#anchor` or query. */
  target: string
  /** `[[target]]` (Obsidian), resolved by file name; otherwise a relative path. */
  wikilink: boolean
}

// `[text](target "title")` and `![alt](target)`: the target stops at whitespace or `)`, unless
// written between angle brackets, which may hold spaces.
const INLINE_LINK_PATTERN =
  /!?\[(?:[^\]\\\n]|\\.)*\]\(\s*(?:<([^>\n]+)>|([^)\s<>]+))(?:\s+[^)]*)?\)/gu
// `[label]: target` reference definitions, on their own line.
const REFERENCE_DEFINITION_PATTERN = /^ {0,3}\[[^\]\n]+\]:[ \t]*(?:<([^>\n]+)>|([^\s<>]+))/gmu
// `[[target]]`, `[[target#heading]]`, `[[target|alias]]`, and `![[embed]]`.
const WIKILINK_PATTERN = /!?\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/gu
// URLs, mail and other schemes, protocol-relative URLs, and anchors within the page.
const EXTERNAL_TARGET_PATTERN = /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/iu
const INLINE_CODE_PATTERN = /(`+)[\s\S]*?\1/gu

/**
 * The project links a Markdown page writes, in order: inline and reference links, Obsidian
 * wikilinks, and embeds. Links inside fenced or inline code are text, not links, and external
 * URLs, mail addresses, and in-page anchors are skipped.
 */
export function markdownLinks(text: string): MarkdownLink[] {
  const masked = withoutCode(text)
  const lineStarts = lineStartOffsets(text, undefined)
  const links: MarkdownLink[] = []
  const add = (offset: number, written: string | undefined, wikilink: boolean): void => {
    const target = linkTarget(written ?? "", wikilink)
    if (target !== null) {
      links.push({ offset, line: lineNumberForOffset(lineStarts, offset), target, wikilink })
    }
  }
  for (const pattern of [INLINE_LINK_PATTERN, REFERENCE_DEFINITION_PATTERN]) {
    for (const match of masked.matchAll(pattern)) add(match.index, match[1] ?? match[2], false)
  }
  for (const match of masked.matchAll(WIKILINK_PATTERN)) add(match.index, match[1], true)
  return links.sort((left, right) => left.offset - right.offset)
}

/** An indexed passage of a Markdown page, as far as its links are concerned. */
export interface LinkedPassage {
  relativePath: string
  chunkIndex: number
  text: string
  /** First source line of the passage, when it has line coordinates. */
  lineStart?: number | null
  /** Offset of the passage in its page, when known. */
  charStart?: number | null
}

/**
 * The links written in indexed passages, each once although neighbouring chunks overlap, with its
 * line in the page and the first passage that holds it.
 */
export function linksInPassages<Passage extends LinkedPassage>(
  passages: readonly Passage[],
): Array<{ link: MarkdownLink; line: number; passage: Passage }> {
  const found = new Map<string, { link: MarkdownLink; line: number; passage: Passage }>()
  for (const passage of [...passages].sort((left, right) => left.chunkIndex - right.chunkIndex)) {
    const firstLine = typeof passage.lineStart === "number" ? passage.lineStart : 1
    for (const link of markdownLinks(passage.text)) {
      const line = firstLine + link.line - 1
      // Overlapping chunks hold the same link at the same offset of the page.
      const key =
        typeof passage.charStart === "number"
          ? `${passage.relativePath}\0${passage.charStart + link.offset}`
          : `${passage.relativePath}\0${line}\0${link.target}`
      if (!found.has(key)) found.set(key, { link, line, passage })
    }
  }
  return [...found.values()]
}

/**
 * Resolve links against the indexed files: a relative link by its path from the page (`.md` may be
 * omitted), a wikilink by its path from the project root or else by its file name, Obsidian's
 * shortest-path rule picking among files that share it. Null when the target is not indexed, lies
 * outside the project, or is ambiguous.
 */
export function linkResolver(
  indexedPaths: Iterable<string>,
): (link: MarkdownLink, fromPath: string) => string | null {
  const paths = new Set(indexedPaths)
  const byName = new Map<string, string[]>()
  for (const indexed of paths) {
    const name = fileName(indexed)
    byName.set(name, [...(byName.get(name) ?? []), indexed])
  }
  const indexedPath = (candidate: string): string | null => {
    const normalized = path.posix.normalize(candidate)
    if (normalized.startsWith("../") || normalized === "..") {
      return null
    }
    return [normalized, `${normalized}.md`].find((option) => paths.has(option)) ?? null
  }
  return (link, fromPath) => {
    if (!link.wikilink) {
      return indexedPath(
        link.target.startsWith("/")
          ? link.target.slice(1)
          : path.posix.join(path.posix.dirname(fromPath), link.target),
      )
    }
    const direct = indexedPath(link.target)
    if (direct !== null) {
      return direct
    }
    const named = byName.get(fileName(link.target)) ?? []
    const depth = (candidate: string): number => candidate.split("/").length
    const shortest = Math.min(...named.map(depth))
    const closest = named.filter((candidate) => depth(candidate) === shortest)
    return closest.length === 1 ? (closest[0] ?? null) : null
  }
}

function linkTarget(written: string, wikilink: boolean): string | null {
  const trimmed = written.trim()
  if (trimmed === "" || (!wikilink && EXTERNAL_TARGET_PATTERN.test(trimmed))) {
    return null
  }
  const withoutAnchor = wikilink ? trimmed : (trimmed.split(/[#?]/u)[0] ?? "")
  let decoded = withoutAnchor
  try {
    decoded = decodeURI(withoutAnchor)
  } catch {
    // A malformed escape stays as written.
  }
  const target = decoded.replace(/\\/gu, "/")
  return target === "" ? null : target
}

/** The text with fenced and inline code blanked, offsets and line breaks kept. */
function withoutCode(text: string): string {
  const blank = (value: string): string => value.replace(/[^\n]/gu, " ")
  let masked = text
  for (const fence of markdownFenceSpans(text)) {
    masked =
      masked.slice(0, fence.start) +
      blank(masked.slice(fence.start, fence.end)) +
      masked.slice(fence.end)
  }
  return masked.replace(INLINE_CODE_PATTERN, blank)
}

function fileName(filePath: string): string {
  const base = path.posix.basename(filePath.replace(/\\/gu, "/"))
  const extension = path.posix.extname(base)
  return (extension === "" ? base : base.slice(0, -extension.length)).toLowerCase()
}
