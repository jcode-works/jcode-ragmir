export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
}

const wordSegmenters = new Map<string, Intl.Segmenter>()
const IDENTIFIER_WORD_PATTERN = /[\p{L}\p{N}]+/gu
const IDENTIFIER_PART_BOUNDARY = /\p{Ll}\p{Lu}|\p{Lu}\p{Lu}\p{Ll}|\p{L}\p{N}|\p{N}\p{L}/u

export function tokenize(text: string, locale = "und"): string[] {
  const normalized = normalizeForMatch(text)
  const tokens: string[] = []
  const segmenter = wordSegmenter(locale)

  for (const segment of segmenter.segment(normalized)) {
    if (!segment.isWordLike) {
      continue
    }
    const token = segment.segment
    if (token.length >= 2 || /[^\p{Script=Latin}\p{N}]/u.test(token)) {
      tokens.push(token)
    }
  }

  return tokens
}

function wordSegmenter(locale: string): Intl.Segmenter {
  const cached = wordSegmenters.get(locale)
  if (cached) {
    return cached
  }
  const segmenter = new Intl.Segmenter(locale, { granularity: "word" })
  wordSegmenters.set(locale, segmenter)
  return segmenter
}

/**
 * Split camelCase, PascalCase, acronym, and letter-digit identifiers into lowercase parts, such as
 * `parseHTTPResponse` into `parse`, `http`, and `response`. Whole identifiers stay in the source text.
 */
export function identifierParts(text: string): string[] {
  const parts = new Set<string>()
  for (const match of text.matchAll(IDENTIFIER_WORD_PATTERN)) {
    const word = match[0]
    if (!IDENTIFIER_PART_BOUNDARY.test(word)) {
      continue
    }
    const wordParts = word
      .replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2")
      .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, "$1 $2")
      .replace(/(\p{L})(\p{N})/gu, "$1 $2")
      .replace(/(\p{N})(\p{L})/gu, "$1 $2")
      .split(" ")
      .filter((part) => part.length > 1)
    if (wordParts.length > 1) {
      for (const part of wordParts) {
        parts.add(part.toLowerCase())
      }
    }
  }
  return [...parts]
}
