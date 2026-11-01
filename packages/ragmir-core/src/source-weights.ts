import path from "node:path"
import picomatch from "picomatch"
import { identifierParts, normalizeForMatch, shareStem, stemPrefix } from "./text.js"
import { memoizeByText } from "./text-memo.js"
import type { Config } from "./types.js"

/**
 * Ranking priors that slightly demote files agents rarely need as primary evidence: tests restate
 * the code they cover and snapshots repeat generated output. They only reorder close candidates;
 * `pathPriors: false` turns them off and `sourceWeights` can override any pattern. Agent
 * instruction files stay neutral: in many projects they hold the rules a question is about.
 */
const DEFAULT_PATH_PRIORS: Readonly<Record<string, number>> = {
  "**/__tests__/**": 0.85,
  "**/*.{test,spec}.*": 0.85,
  "**/test/**": 0.85,
  "**/tests/**": 0.85,
  "**/*{Test,Tests,IT}.{java,kt,scala,groovy}": 0.85,
  "**/*_test.{go,py,rb,exs}": 0.85,
  "**/test_*.py": 0.85,
  "**/__snapshots__/**": 0.7,
  "**/*.snap": 0.7,
}

interface CompiledWeight {
  matches: (relativePath: string) => boolean
  weight: number
}

/** One weight function per distinct weight table, so its per-path memo outlives each query. */
const weightFunctions = new Map<string, (relativePath: string) => number>()

/**
 * Ranking multiplier for a source path: the product of every matching path prior and configured
 * source weight. A configured pattern that repeats a prior replaces it.
 */
export function sourceWeightOf(
  config: Pick<Config, "pathPriors" | "sourceWeights">,
): (relativePath: string) => number {
  const entries = {
    ...(config.pathPriors ? DEFAULT_PATH_PRIORS : {}),
    ...config.sourceWeights,
  }
  const key = JSON.stringify(entries)
  let weightOf = weightFunctions.get(key)
  if (!weightOf) {
    const weights: CompiledWeight[] = Object.entries(entries)
      .filter(([, weight]) => weight !== 1)
      .map(([pattern, weight]) => ({
        matches: picomatch(pattern, { dot: true, nocase: true, basename: !pattern.includes("/") }),
        weight,
      }))
    // Every chunk of a file, in every query, shares its path: match the patterns once per path.
    weightOf =
      weights.length === 0
        ? () => 1
        : memoizeByText((relativePath) => {
            let weight = 1
            for (const entry of weights) {
              if (entry.matches(relativePath)) weight *= entry.weight
            }
            return weight
          })
    weightFunctions.set(key, weightOf)
  }
  return weightOf
}

const LOCALE_CONTAINERS = new Set([
  "i18n",
  "intl",
  "l10n",
  "lang",
  "langs",
  "language",
  "languages",
  "locale",
  "locales",
  "messages",
  "nls",
  "strings",
  "translation",
  "translations",
])
const TRANSLATION_EXTENSIONS = new Set([
  ".arb",
  ".ftl",
  ".json",
  ".po",
  ".pot",
  ".properties",
  ".resx",
  ".strings",
  ".toml",
  ".xlf",
  ".xliff",
  ".yaml",
  ".yml",
])
const DOCUMENT_EXTENSIONS = new Set([".html", ".md", ".mdx", ".rst", ".txt", ".adoc"])
// ISO 639-1 codes, so `id/`, `db/`, or `ui/` folders only collapse in a translation context.
const LANGUAGE_CODES = new Set(
  (
    "aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv cy " +
    "da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu " +
    "hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb " +
    "lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om " +
    "or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw " +
    "ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu"
  ).split(" "),
)
const LOCALE_PATTERN = /^([a-z]{2})(?:[-_]([A-Za-z]{4}))?(?:[-_]([A-Za-z]{2}|\d{3}))?$/u
const ANDROID_VALUES_PATTERN = /^values-([a-z]{2})(?:-r[A-Z]{2})?$/u
const APPLE_LPROJ_PATTERN = /^([a-z]{2})(?:[-_][A-Za-z]{2,4})?\.lproj$/u

/**
 * Key shared by the translations of one document: `messages/fr.json` and `messages/en.json`, or
 * `docs/fr/guide.md` and `docs/en/guide.md`, collapse to one key so they take one result slot.
 */
export function localeDocumentKey(relativePath: string): string {
  const segments = relativePath.split("/")
  const fileName = segments.pop() ?? ""
  const directories = segments.map((segment, index) =>
    isLocaleDirectory(segment, index > 0 ? segments[index - 1] : undefined) ? "{locale}" : segment,
  )
  const extension = path.posix.extname(fileName)
  const stem = extension ? fileName.slice(0, -extension.length) : fileName
  const parent = segments.at(-1)
  const fileKey = localeFileStem(stem, extension.toLowerCase(), parent)
  return [...directories, `${fileKey}${extension}`].join("/")
}

function isLocaleDirectory(segment: string, parent: string | undefined): boolean {
  if (ANDROID_VALUES_PATTERN.test(segment) || APPLE_LPROJ_PATTERN.test(segment)) {
    return true
  }
  const locale = LOCALE_PATTERN.exec(segment)
  if (!locale || !LANGUAGE_CODES.has(locale[1] ?? "")) {
    return false
  }
  // `fr-FR/` is unambiguous; a bare `fr/` needs a translation parent such as `locales/`.
  return locale[2] !== undefined || locale[3] !== undefined || isLocaleContainer(parent)
}

function localeFileStem(stem: string, extension: string, parent: string | undefined): string {
  if (isLocaleCode(stem) && (TRANSLATION_EXTENSIONS.has(extension) || isLocaleContainer(parent))) {
    return "{locale}"
  }
  // README.fr.md, messages_fr.properties, Resources.fr-FR.resx
  const suffix = /^(.+?)([._-])([a-z]{2}(?:[-_][A-Za-z]{2,4})?)$/u.exec(stem)
  if (
    suffix &&
    isLocaleCode(suffix[3] ?? "") &&
    (TRANSLATION_EXTENSIONS.has(extension) || DOCUMENT_EXTENSIONS.has(extension)) &&
    (suffix[2] === "." || TRANSLATION_EXTENSIONS.has(extension))
  ) {
    return `${suffix[1]}${suffix[2]}{locale}`
  }
  return stem
}

function isLocaleCode(value: string): boolean {
  const locale = LOCALE_PATTERN.exec(value)
  return locale !== null && LANGUAGE_CODES.has(locale[1] ?? "")
}

function isLocaleContainer(segment: string | undefined): boolean {
  return segment !== undefined && LOCALE_CONTAINERS.has(segment.toLowerCase())
}

const CODE_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cjs",
  ".cpp",
  ".cs",
  ".cts",
  ".dart",
  ".ex",
  ".exs",
  ".go",
  ".groovy",
  ".h",
  ".hpp",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".kts",
  ".mjs",
  ".mts",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".scala",
  ".svelte",
  ".swift",
  ".ts",
  ".tsx",
  ".vue",
])
const DEFINITION_PATTERNS = [
  // Types and modules across C-family, JVM, Swift, Rust, Python, Ruby, PHP, and TypeScript.
  /\b(?:class|interface|enum|record|struct|trait|object|protocol|module|namespace|type)\s+([A-Za-z_$][\w$]*)/gu,
  // Functions and methods introduced by a keyword.
  /\b(?:function|func|fn|def|fun|sub)\s+\*?\s*([A-Za-z_$][\w$]*)/gu,
  // const handler = (...) => / async function expressions.
  /\b(?:const|let|var|val)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/gu,
  // Java, C#, Kotlin, and Scala methods after visibility or modifier keywords.
  /\b(?:public|private|protected|internal|static|final|override|abstract|synchronized|suspend)\s+(?:[\w<>[\],.?]+\s+)*?([a-z_$][\w$]*)\s*\(/gu,
]
// Calibrated on a Java and TypeScript monorepo golden set: enough to lift the defining class above
// tests and notes that mention it, not enough to outrank prose that answers the question better.
const DEFINITION_BOOST_PER_PART = 0.07
const MAX_DEFINITION_BOOST = 0.2

// A question that names a file ("how is the OpenAPI document titled") usually wants that file, and
// a heading path names what its section is about: a question word there is stronger evidence than
// the same word in the body, as field weighting does without a second index. On six real indexes,
// with and without an embedding model, 10% per matching word, two at most, raised MRR@10 on most
// of them for file names and on four for headings, without changing a refusal.
const WORD_MATCH_BOOST = 0.1
const MAX_MATCHED_WORDS = 2
const MIN_MATCHED_WORD_LENGTH = 4
const NAME_SEPARATORS = /[^\p{L}\p{N}]+/u

/** Folded words of a file name: whole, by identifier part and separator, and adjacent parts joined. */
const fileNameWords = memoizeByText((relativePath: string): ReadonlySet<string> => {
  const name = path.posix.basename(relativePath, path.posix.extname(relativePath))
  const folded = normalizeForMatch(name)
  const parts = identifierParts(name)
  const words = new Set([folded, ...parts, ...folded.split(NAME_SEPARATORS)])
  for (let index = 0; index + 1 < parts.length; index += 1) {
    words.add(`${parts[index]}${parts[index + 1]}`)
  }
  words.delete("")
  return words
})

/** Folded words of a Markdown heading path or JSONPath. */
const headingWords = memoizeByText(
  (contextPath: string): ReadonlySet<string> =>
    new Set(normalizeForMatch(contextPath).split(NAME_SEPARATORS).filter(Boolean)),
)

/** A multiplier of 1 to 1.2: 10% per query word sharing a stem with a word of the row's set. */
function wordMatchBoostOf<Row>(
  queryTokens: readonly string[],
  wordsOf: (row: Row) => ReadonlySet<string> | null,
): (row: Row) => number {
  const tokens = [...new Set(queryTokens)].filter(
    (token) => token.length >= MIN_MATCHED_WORD_LENGTH,
  )
  if (tokens.length === 0) {
    return () => 1
  }
  return (row) => {
    const words = wordsOf(row)
    if (!words) {
      return 1
    }
    let matched = 0
    for (const token of tokens) {
      for (const word of words) {
        if (shareStem(token, word)) {
          matched += 1
          break
        }
      }
      if (matched === MAX_MATCHED_WORDS) {
        break
      }
    }
    return 1 + matched * WORD_MATCH_BOOST
  }
}

/**
 * Boost passages from files whose name holds words of the question, such as `OpenApiConfig.java`
 * for "how is the OpenAPI document titled".
 */
export function fileNameBoostOf(
  queryTokens: readonly string[],
): (row: { relativePath: string }) => number {
  return wordMatchBoostOf(queryTokens, (row: { relativePath: string }) =>
    fileNameWords(row.relativePath),
  )
}

/** Boost passages whose heading path or JSONPath holds words of the question. */
export function headingBoostOf(
  queryTokens: readonly string[],
): (row: { contextPath?: string | null }) => number {
  return wordMatchBoostOf(queryTokens, (row: { contextPath?: string | null }) =>
    row.contextPath ? headingWords(row.contextPath) : null,
  )
}

/** Folded names, and their identifier parts, that a code passage declares; one scan per text. */
const definedNameParts = memoizeByText((text: string): ReadonlySet<string> => {
  const parts = new Set<string>()
  for (const pattern of DEFINITION_PATTERNS) {
    pattern.lastIndex = 0
    for (const match of text.matchAll(pattern)) {
      const name = match[1]
      if (!name) continue
      parts.add(normalizeForMatch(name))
      for (const part of identifierParts(name)) parts.add(part)
    }
  }
  return parts
})

/**
 * Boost code passages that define what the question names: "how are permissions checked" should
 * reach the class that declares `PermissionService` before tests and docs that only mention it.
 * Returns a multiplier of 1 (no definition matches) up to 1.2.
 */
export function definitionBoostOf(
  queryTokens: readonly string[],
): (row: { relativePath: string; text: string; searchText: string }) => number {
  const tokens = [...new Set(queryTokens)].filter((token) => token.length >= 3)
  if (tokens.length === 0) {
    return () => 1
  }
  const prefixes = tokens.map(stemPrefix)
  return (row) => {
    if (!CODE_EXTENSIONS.has(path.posix.extname(row.relativePath).toLowerCase())) {
      return 1
    }
    // A defined name sharing a stem with a query word puts that word's stem prefix in the folded
    // keyword text, so a passage without any of them skips the definition patterns.
    if (!prefixes.some((prefix) => row.searchText.includes(prefix))) {
      return 1
    }
    const parts = definedNameParts(row.text)
    if (parts.size === 0) {
      return 1
    }
    let matched = 0
    for (const token of tokens) {
      for (const part of parts) {
        if (shareStem(token, part)) {
          matched += 1
          break
        }
      }
    }
    return 1 + Math.min(MAX_DEFINITION_BOOST, matched * DEFINITION_BOOST_PER_PART)
  }
}
