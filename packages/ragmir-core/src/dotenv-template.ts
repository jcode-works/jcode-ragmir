// Dotenv templates (`.env.example`, `.env.sample`, `env.template`, ...) document the variables a
// project needs, but people sometimes leave a real secret in them. They index with their variable
// names and comments, every value masked, and each line kept in place so citations stay exact.
const TEMPLATE_SUFFIXES = new Set(["dist", "example", "exemple", "sample", "template"])
const MASKED = "(value omitted)"
const ASSIGNMENT = /^(\s*(?:export\s+)?)([A-Za-z_][\w.-]*)(\s*=\s*)(.*)$/u
// Key-like tokens of 20 or more characters that mix letters and digits, such as payment provider
// or cloud access keys.
const SECRET_TOKEN = /(?<![\w+/=-])(?=[\w+/=-]*\d)(?=[\w+/=-]*[A-Za-z])[\w+/=-]{20,}(?![\w+/=-])/gu
const JWT = /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]+/gu

/** Whether a file name is a dotenv template: a template suffix after `.env`, `env`, or `*.env`. */
export function isDotenvTemplateName(fileName: string): boolean {
  const name = fileName.toLowerCase()
  const lastDot = name.lastIndexOf(".")
  if (lastDot <= 0 || !TEMPLATE_SUFFIXES.has(name.slice(lastDot + 1))) {
    return false
  }
  const stem = name.slice(0, lastDot)
  return stem === ".env" || stem === "env" || stem.endsWith(".env") || stem.startsWith(".env.")
}

/** The template with every value masked; names, comments, and blank lines keep their lines. */
export function maskedDotenvText(text: string): string {
  let openQuote: string | null = null
  return text
    .split(/\r?\n/u)
    .map((line) => {
      if (openQuote) {
        // Inside a multi-line value, such as a private key: drop the line, keep the line count.
        if (line.includes(openQuote)) {
          openQuote = null
        }
        return ""
      }
      const trimmed = line.trim()
      if (trimmed === "" || trimmed.startsWith("#")) {
        return scrubbed(line)
      }
      const match = ASSIGNMENT.exec(line)
      if (!match) {
        return ""
      }
      const [, prefix = "", name = "", separator = "", raw = ""] = match
      const value = valueParts(raw)
      openQuote = value.openQuote
      const shown = value.empty ? "" : MASKED
      return `${prefix}${name}${separator}${shown}${value.comment ? ` ${scrubbed(value.comment)}` : ""}`
    })
    .join("\n")
}

function valueParts(raw: string): { empty: boolean; comment: string; openQuote: string | null } {
  const value = raw.trim()
  const quote = value[0]
  if (quote === '"' || quote === "'" || quote === "`") {
    const close = closingQuote(value, quote)
    if (close < 0) {
      return { empty: false, comment: "", openQuote: quote }
    }
    const rest = value.slice(close + 1).trim()
    return {
      empty: close === 1,
      comment: rest.startsWith("#") ? rest : "",
      openQuote: null,
    }
  }
  const hash = value.search(/\s#/u)
  const bare = hash < 0 ? value : value.slice(0, hash).trim()
  return {
    empty: bare === "",
    comment: hash < 0 ? "" : value.slice(hash).trim(),
    openQuote: null,
  }
}

function closingQuote(value: string, quote: string): number {
  for (let index = 1; index < value.length; index += 1) {
    if (value[index] === "\\") {
      index += 1
      continue
    }
    if (value[index] === quote) {
      return index
    }
  }
  return -1
}

function scrubbed(text: string): string {
  return text.replace(JWT, MASKED).replace(SECRET_TOKEN, MASKED)
}
