export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
}

const wordSegmenters = new Map<string, Intl.Segmenter>()

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
