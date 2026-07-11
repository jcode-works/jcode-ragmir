export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
}

export function tokenize(text: string): string[] {
  const normalized = normalizeForMatch(text)
  const tokens: string[] = []
  const segmenter = new Intl.Segmenter("und", { granularity: "word" })

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
