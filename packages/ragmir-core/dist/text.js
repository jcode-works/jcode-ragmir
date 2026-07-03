export function normalizeForMatch(text) {
    return text
        .toLowerCase()
        .normalize("NFKD")
        .replace(/\p{Diacritic}/gu, "");
}
export function tokenize(text) {
    return normalizeForMatch(text).match(/[\p{L}\p{N}]{2,}/gu) ?? [];
}
//# sourceMappingURL=text.js.map