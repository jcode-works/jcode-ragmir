import { queryEvidence } from "./ranking.js"
import { identifierParts, shareStem, tokenize } from "./text.js"
import type { CompactSearchResult, SearchResult } from "./types.js"

const COMPACT_SNIPPET_LENGTH = 260
// Background words refine which lines an excerpt shows without outweighing the question's own.
const INTENT_TERM_WEIGHT = 0.3
// When the best line alone is longer than the excerpt, keep a little of what precedes the match.
const MATCH_LEAD_CHARACTERS = 40
const ELLIPSIS = "..."

/** What an excerpt should show: the question, and optional background words. */
export interface ExcerptFocus {
  query?: string
  intent?: string
}

interface ExcerptTerm {
  token: string
  weight: number
}

interface Excerpt {
  text: string
  /** Source line where the excerpt starts, when the passage has line coordinates. */
  line: number | null
}

export function compactSearchResults(
  results: SearchResult[],
  maxLength = COMPACT_SNIPPET_LENGTH,
  focus: ExcerptFocus = {},
): CompactSearchResult[] {
  const terms = excerptTerms(focus)
  return results.map((result) => {
    const excerpt = focusedExcerpt(result, terms, maxLength)
    return {
      source: result.source,
      relativePath: result.relativePath,
      chunkIndex: result.chunkIndex,
      contextPath: result.contextPath,
      citation: result.citation,
      snippet: excerpt.text,
      ...(excerpt.line === null ? {} : { excerptLine: excerpt.line }),
      distance: result.distance,
      lineStart: result.lineStart,
      lineEnd: result.lineEnd,
      pageStart: result.pageStart,
      pageEnd: result.pageEnd,
      ...(result.evidence === undefined ? {} : { evidence: result.evidence }),
      ...(result.pathContext === undefined ? {} : { pathContext: result.pathContext }),
      ...(result.score === undefined ? {} : { score: result.score }),
      ...(result.sourceStatus === undefined ? {} : { sourceStatus: result.sourceStatus }),
      ...(result.weakEvidence === undefined ? {} : { weakEvidence: result.weakEvidence }),
    }
  })
}

function excerptTerms(focus: ExcerptFocus): ExcerptTerm[] {
  const terms = new Map<string, number>()
  for (const token of focus.query ? queryEvidence(focus.query).tokens : []) {
    terms.set(token, 1)
  }
  for (const token of focus.intent ? queryEvidence(focus.intent).tokens : []) {
    if (!terms.has(token)) terms.set(token, INTENT_TERM_WEIGHT)
  }
  return [...terms].map(([token, weight]) => ({ token, weight }))
}

/**
 * The excerpt an agent reads to decide which citation to expand: the lines holding the most of the
 * question's words rather than the passage's first characters, which are often a heading or an
 * introduction. A passage that matched by meaning alone keeps its opening.
 */
function focusedExcerpt(
  result: SearchResult,
  terms: readonly ExcerptTerm[],
  maxLength: number,
): Excerpt {
  const lines = result.text.split("\n")
  let bestLine = -1
  let bestScore = 0
  for (const [index, line] of lines.entries()) {
    const score = lineScore(line, terms)
    if (score > bestScore) {
      bestScore = score
      bestLine = index
    }
  }
  if (bestLine <= 0) {
    // No line holds a question word, or the first one already does: the opening is the excerpt.
    return {
      text: compactText(result.text, maxLength),
      line: bestLine === 0 ? result.lineStart : null,
    }
  }
  const line = lines[bestLine] ?? ""
  const following = lines.slice(bestLine).join("\n")
  const window =
    collapse(line).length > maxLength - ELLIPSIS.length
      ? following.slice(matchLead(line, terms))
      : following
  return {
    text: `${ELLIPSIS}${compactText(window, maxLength - ELLIPSIS.length)}`,
    line: result.lineStart === null ? null : result.lineStart + bestLine,
  }
}

function lineScore(line: string, terms: readonly ExcerptTerm[]): number {
  if (terms.length === 0 || line.trim() === "") {
    return 0
  }
  const words = new Set([...tokenize(line), ...identifierParts(line)])
  let score = 0
  for (const term of terms) {
    for (const word of words) {
      if (shareStem(term.token, word)) {
        score += term.weight
        break
      }
    }
  }
  return score
}

/** Where to start a long line: a few characters before its first question word. */
function matchLead(line: string, terms: readonly ExcerptTerm[]): number {
  const lower = line.toLowerCase()
  const positions = terms
    .map((term) => lower.indexOf(term.token))
    .filter((position) => position >= 0)
  if (positions.length === 0) {
    return 0
  }
  const start = Math.max(0, Math.min(...positions) - MATCH_LEAD_CHARACTERS)
  const space = line.lastIndexOf(" ", start)
  return space < 0 ? start : space + 1
}

function collapse(text: string): string {
  return text.replace(/\s+/gu, " ").trim()
}

function compactText(text: string, maxLength = COMPACT_SNIPPET_LENGTH): string {
  const normalized = collapse(text)
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, Math.max(0, maxLength - ELLIPSIS.length)).trimEnd()}${ELLIPSIS}`
}
