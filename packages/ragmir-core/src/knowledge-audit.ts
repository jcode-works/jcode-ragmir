import { lineNumberForOffset, lineStartOffsets } from "./chunking.js"
import { stripCitationCoordinates } from "./citation.js"
import { markdownFrontmatter } from "./document-structure.js"
import { type LinkedPassage, linkResolver, linksInPassages } from "./markdown-links.js"
import { canonicalUserPath } from "./source-paths.js"
import type { KnowledgeAuditReport, KnowledgeFinding } from "./types.js"

/** An indexed passage of a Markdown page, with what the audit reads from it. */
export interface KnowledgePassage extends LinkedPassage {
  contextPath: string
  citation: string
}

export interface KnowledgePage {
  path: string
  passages: KnowledgePassage[]
}

/** What the index holds now, for the files and passages the pages refer to. */
export interface KnowledgeIndex {
  /** Every indexed path with the SHA-256 checksum of its content. */
  checksums: ReadonlyMap<string, string>
  /** The current citation and evidence id of each cited passage, keyed by `path#chunk`. */
  passages: ReadonlyMap<string, { citation: string; evidence: string }>
}

/** A Ragmir citation written in a page, as an agent copies it from a search result. */
export interface WrittenCitation {
  citation: string
  /** The indexed passage it names, `path#chunk`. */
  key: string
  line: number
  evidence?: string
}

// `docs/runbook.md:L12-L18#4` or `specs/brief.pdf:p3#2`: a file path with an extension that starts
// with a letter, optional coordinates without spaces, and the chunk suffix that makes it a citation.
const CITATION_PATTERN =
  /(?<![\w./@-])(?:[\w@.-]+\/)*[\w@-][\w@.-]*\.[A-Za-z][A-Za-z\d]{0,9}(?::[^\s#`'"()<>[\]]+)?#\d+(?!\w)/gu

/**
 * Audit Markdown pages as a knowledge base, deterministically and without writing anything:
 * broken links, wikilinks to missing pages, pages nothing links to, duplicate titles, Ragmir
 * citations that no longer match the index, and derived pages whose declared sources changed or
 * disappeared. `assumeRemoved` reports what removing pages would break.
 */
export function auditKnowledge(
  pages: readonly KnowledgePage[],
  index: KnowledgeIndex,
  options: { assumeRemoved?: readonly string[]; previewLimit: number },
): KnowledgeAuditReport {
  const finding = <Item>(items: readonly Item[]): KnowledgeFinding<Item> => ({
    count: items.length,
    items: items.slice(0, options.previewLimit),
  })
  const graph = linkGraph(pages, [...index.checksums.keys()])
  const citations = pages.flatMap((page) =>
    writtenCitations(page).map((written) => ({ source: page.path, ...written })),
  )
  const brokenCitations = citations.flatMap(({ source, citation, key, line, evidence }) => {
    const current = index.passages.get(key)
    const status: "changed" | "missing" | null =
      current === undefined
        ? "missing"
        : current.citation !== citation || (evidence !== undefined && evidence !== current.evidence)
          ? "changed"
          : null
    return status === null ? [] : [{ source, line, citation, status }]
  })
  const derived = pages.flatMap((page) => {
    const sources = markdownFrontmatter(pageText(page.passages))?.sources ?? []
    const paths = sources.flatMap((source) => (source.path === undefined ? [] : [source]))
    return paths.length === 0 ? [] : [{ path: page.path, sources: paths }]
  })
  const stalePages = derived.flatMap(({ path, sources }) => {
    const changedSources = sources
      .filter((source) => {
        const checksum = index.checksums.get(source.path ?? "")
        return source.sha256 !== undefined && checksum !== undefined && checksum !== source.sha256
      })
      .map((source) => source.path ?? "")
    return changedSources.length === 0 ? [] : [{ path, changedSources }]
  })
  const lostSources = derived
    .filter(({ sources }) => sources.every((source) => !index.checksums.has(source.path ?? "")))
    .map(({ path }) => ({ path }))
  const titles = new Map<string, { title: string; paths: string[] }>()
  for (const page of pages) {
    const title = pageTitle(page)
    const entry = titles.get(title.toLowerCase()) ?? { title, paths: [] }
    if (title !== "")
      titles.set(title.toLowerCase(), { ...entry, paths: [...entry.paths, page.path] })
  }
  const report: KnowledgeAuditReport = {
    pages: pages.length,
    links: graph.links,
    citations: citations.length,
    findings: {
      brokenLinks: finding(graph.brokenLinks),
      missingPages: finding(graph.missingPages),
      unlinkedPages: finding(graph.unlinkedPages.map((path) => ({ path }))),
      duplicateTitles: finding([...titles.values()].filter((entry) => entry.paths.length > 1)),
      brokenCitations: finding(brokenCitations),
      stalePages: finding(stalePages),
      lostSources: finding(lostSources),
    },
  }
  const removed = new Set(options.assumeRemoved ?? [])
  if (removed.size === 0) {
    return report
  }
  const remaining = graphAfterRemoval(pages, index, removed)
  const brokenBefore = new Set(graph.brokenLinks.map(linkKey))
  const unlinkedBefore = new Set(graph.unlinkedPages)
  return {
    ...report,
    assumeRemoved: {
      paths: [...removed],
      brokenLinks: finding(
        remaining.brokenLinks.filter((link) => !brokenBefore.has(linkKey(link))),
      ),
      unlinkedPages: finding(
        remaining.unlinkedPages
          .filter((path) => !unlinkedBefore.has(path))
          .map((path) => ({ path })),
      ),
    },
  }
}

/** The Ragmir citations a page writes, in its text or in its front matter `sources`. */
export function writtenCitations(page: KnowledgePage): WrittenCitation[] {
  const found = new Map<string, WrittenCitation>()
  for (const passage of page.passages) {
    const lineStarts = lineStartOffsets(passage.text, undefined)
    const firstLine = typeof passage.lineStart === "number" ? passage.lineStart : 1
    for (const match of passage.text.matchAll(CITATION_PATTERN)) {
      const key = citationKey(match[0])
      if (key !== null && !found.has(match[0])) {
        const line = firstLine + lineNumberForOffset(lineStarts, match.index) - 1
        found.set(match[0], { citation: match[0], key, line })
      }
    }
  }
  for (const source of markdownFrontmatter(pageText(page.passages))?.sources ?? []) {
    const key = source.citation === undefined ? null : citationKey(source.citation)
    if (source.citation === undefined || key === null) continue
    const written = found.get(source.citation) ?? { citation: source.citation, key, line: 1 }
    found.set(
      source.citation,
      source.evidence === undefined ? written : { ...written, evidence: source.evidence },
    )
  }
  return [...found.values()]
}

/** `path#chunk` of the passage a citation names, or null when it is not a Ragmir citation. */
function citationKey(citation: string): string | null {
  const suffix = /#(\d+)$/u.exec(citation)
  if (!suffix) {
    return null
  }
  const filePath = stripCitationCoordinates(canonicalUserPath(citation.slice(0, suffix.index)))
  return filePath === "" ? null : `${filePath}#${suffix[1]}`
}

interface LinkGraph {
  links: number
  brokenLinks: Array<{
    source: string
    line: number
    target: string
    citation: string
    suggestion?: string
  }>
  missingPages: Array<{ target: string; references: number; sources: string[] }>
  unlinkedPages: string[]
}

function linkGraph(pages: readonly KnowledgePage[], indexedPaths: readonly string[]): LinkGraph {
  const resolve = linkResolver(indexedPaths)
  const pagePaths = new Set(pages.map((page) => page.path))
  const linkedFrom = new Map<string, Set<string>>()
  const missing = new Map<string, { target: string; references: number; sources: Set<string> }>()
  const brokenLinks: LinkGraph["brokenLinks"] = []
  let links = 0
  for (const page of pages) {
    for (const { link, line, passage } of linksInPassages(page.passages)) {
      links += 1
      const resolved = resolve(link, page.path)
      if (resolved !== null) {
        if (resolved !== page.path && pagePaths.has(resolved)) {
          linkedFrom.set(resolved, (linkedFrom.get(resolved) ?? new Set()).add(page.path))
        }
        continue
      }
      if (link.wikilink) {
        const key = link.target.toLowerCase()
        const entry = missing.get(key) ?? { target: link.target, references: 0, sources: new Set() }
        entry.references += 1
        entry.sources.add(page.path)
        missing.set(key, entry)
        continue
      }
      // A fix is offered only when one indexed file carries the target's name.
      const suggestion = resolve({ ...link, wikilink: true }, page.path)
      brokenLinks.push({
        source: page.path,
        line,
        target: link.target,
        citation: passage.citation,
        ...(suggestion === null ? {} : { suggestion }),
      })
    }
  }
  return {
    links,
    brokenLinks,
    missingPages: [...missing.values()]
      .sort(
        (left, right) =>
          right.references - left.references || left.target.localeCompare(right.target),
      )
      .map((entry) => ({ ...entry, sources: [...entry.sources] })),
    unlinkedPages: pages.map((page) => page.path).filter((path) => !linkedFrom.has(path)),
  }
}

function graphAfterRemoval(
  pages: readonly KnowledgePage[],
  index: KnowledgeIndex,
  removed: ReadonlySet<string>,
): LinkGraph {
  return linkGraph(
    pages.filter((page) => !removed.has(page.path)),
    [...index.checksums.keys()].filter((path) => !removed.has(path)),
  )
}

function linkKey(link: { source: string; line: number; target: string }): string {
  return `${link.source}\0${link.line}\0${link.target}`
}

/** A page's title: its front matter title, else its level-1 heading. */
function pageTitle(page: KnowledgePage): string {
  const first = page.passages.find((passage) => passage.chunkIndex === 0) ?? page.passages[0]
  return first?.contextPath.split(" > ")[0]?.trim() ?? ""
}

/** A page's text rebuilt from its passages, which overlap and may skip whitespace between them. */
function pageText(passages: readonly KnowledgePassage[]): string {
  let text = ""
  for (const passage of [...passages].sort((left, right) => left.chunkIndex - right.chunkIndex)) {
    const start = typeof passage.charStart === "number" ? passage.charStart : text.length
    if (start >= text.length) {
      text += "\n".repeat(start - text.length) + passage.text
    } else if (start + passage.text.length > text.length) {
      text += passage.text.slice(text.length - start)
    }
  }
  return text
}
