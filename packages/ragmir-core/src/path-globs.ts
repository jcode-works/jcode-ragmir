/**
 * Path filters for search and the source catalog accept folders, files, and globs such as
 * `docs/**\/*.md` or `**\/*.pdf`. A glob becomes a regular expression without lookarounds, so the same
 * source runs in JavaScript and in the index's SQL filter (`regexp_like`).
 */

const GLOB_CHARACTERS = /[*?[{]/u
const REGEX_SPECIAL = /[.+^$()|\\]/u

export function isPathGlob(value: string): boolean {
  return GLOB_CHARACTERS.test(value)
}

/**
 * Anchored regular expression for a glob: `**` crosses folders, `*` and `?` stay within one path
 * segment, `{a,b}` lists alternatives, and `[...]` keeps its character class.
 */
export function pathGlobRegexSource(glob: string): string {
  let source = ""
  let braceDepth = 0
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index] ?? ""
    if (character === "*") {
      if (glob[index + 1] === "*") {
        const slashAfter = glob[index + 2] === "/"
        const atSegmentStart = index === 0 || glob[index - 1] === "/"
        index += slashAfter ? 2 : 1
        // `**/` matches zero or more folders; a trailing `**` matches anything below.
        source += atSegmentStart && slashAfter ? "(?:.*/)?" : ".*"
        continue
      }
      source += "[^/]*"
      continue
    }
    if (character === "?") {
      source += "[^/]"
      continue
    }
    if (character === "[") {
      const end = glob.indexOf("]", index + 1)
      if (end > index + 1) {
        const body = glob
          .slice(index + 1, end)
          .replace(/^!/u, "^")
          .replace(/\\/gu, "\\\\")
        source += `[${body}]`
        index = end
        continue
      }
      source += "\\["
      continue
    }
    if (character === "{") {
      braceDepth += 1
      source += "(?:"
      continue
    }
    if (character === "}" && braceDepth > 0) {
      braceDepth -= 1
      source += ")"
      continue
    }
    if (character === "," && braceDepth > 0) {
      source += "|"
      continue
    }
    source +=
      REGEX_SPECIAL.test(character) || character === "{" || character === "}" || character === "]"
        ? `\\${character}`
        : character
  }
  return `^${source}${")".repeat(braceDepth)}$`
}

/** Whether a project-relative path is the given file, sits under the given folder, or matches the glob. */
export function pathMatchesFilter(relativePath: string, filter: string): boolean {
  if (isPathGlob(filter)) {
    return new RegExp(pathGlobRegexSource(filter), "u").test(relativePath)
  }
  const prefix = filter.replace(/\/+$/u, "")
  return relativePath === prefix || relativePath.startsWith(`${prefix}/`)
}
