export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
}

export function tokenize(text: string): string[] {
  return normalizeForMatch(text).match(/[\p{L}\p{N}]{2,}/gu) ?? []
}
