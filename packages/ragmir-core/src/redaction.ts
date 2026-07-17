import type {
  Config,
  ParsedDocument,
  ParsedRegion,
  RedactionCount,
  RedactionPattern,
} from "./types.js"

const BUILT_IN_PATTERNS: RedactionPattern[] = [
  {
    name: "private_key",
    pattern: "-----BEGIN [A-Z ]*PRIVATE KEY-----[\\s\\S]*?-----END [A-Z ]*PRIVATE KEY-----",
    flags: "g",
  },
  {
    name: "jwt",
    pattern: "\\beyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\b",
    flags: "g",
  },
  {
    name: "stripe_secret_key",
    pattern: "\\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\\b",
    flags: "g",
  },
  {
    name: "gitlab_token",
    pattern: "\\bglpat-[A-Za-z0-9_-]{18,}\\b",
    flags: "g",
  },
  {
    name: "bearer_token",
    pattern: "\\b(?:Bearer|bearer)\\s+[A-Za-z0-9_-]{32,}\\b",
    flags: "g",
  },
  {
    name: "api_token",
    pattern:
      "\\b(?:sk|pk|ghp|gho|github_pat|npm)_[A-Za-z0-9_=-]{20,}\\b|\\b[A-Za-z0-9_-]{32,}\\.[A-Za-z0-9_-]{16,}\\.[A-Za-z0-9_-]{16,}\\b",
    flags: "g",
  },
  {
    name: "openai_api_key",
    pattern: "\\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\\b",
    flags: "g",
  },
  {
    name: "aws_access_key_id",
    pattern: "\\b(?:AKIA|ASIA)[0-9A-Z]{16}\\b",
    flags: "g",
  },
  {
    name: "google_api_key",
    pattern: "\\bAIza[0-9A-Za-z_-]{35}\\b",
    flags: "g",
  },
  {
    name: "slack_token",
    pattern: "\\bxox[baprs]-[0-9A-Za-z-]{10,}\\b",
    flags: "g",
  },
  {
    name: "sendgrid_api_key",
    pattern: "\\bSG\\.[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]{43}\\b",
    flags: "g",
  },
  {
    name: "url_credentials",
    pattern: "\\b[a-z][a-z0-9+.-]*://[^\\s/@]+:[^\\s/@]+@",
    flags: "gi",
  },
  {
    name: "email",
    pattern: "\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b",
    flags: "gi",
  },
  {
    name: "iban",
    pattern: "\\b[A-Z]{2}\\d{2}[A-Z0-9]{11,30}\\b",
    flags: "gi",
  },
  {
    name: "credit_card",
    pattern: "\\b(?:\\d[ -]*?){13,19}\\b",
    flags: "g",
    verify: "luhn",
  },
]

export function redactText(
  input: string,
  config: Config,
): { text: string; counts: RedactionCount[] } {
  if (!config.redaction.enabled) {
    return { text: input, counts: [] }
  }

  let text = input
  const counts: RedactionCount[] = []
  const patterns = [
    ...(config.redaction.builtIn ? BUILT_IN_PATTERNS : []),
    ...config.redaction.patterns,
  ]

  for (const pattern of patterns) {
    const regexp = compilePattern(pattern)
    const verifier = pattern.verify === "luhn" ? matchesLuhn : undefined
    let count = 0
    text = text.replace(regexp, (match) => {
      if (verifier && !verifier(match)) {
        return match
      }
      count += 1
      return pattern.replacement ?? `[REDACTED_${pattern.name.toUpperCase()}]`
    })
    if (count > 0) {
      counts.push({ name: pattern.name, count })
    }
  }

  return { text, counts }
}

export function redactDocument(
  document: ParsedDocument,
  config: Config,
): { document: ParsedDocument; counts: RedactionCount[] } {
  const sourceRegions = document.regions ?? pageRegions(document)
  if (sourceRegions.length === 0) {
    const redacted = redactText(document.text, config)
    return {
      document: {
        ...document,
        text: redacted.text,
        sourceLineCoordinates:
          document.sourceLineCoordinates === true && redacted.counts.length === 0,
      },
      counts: redacted.counts,
    }
  }

  let text = ""
  let cursor = 0
  const regions: ParsedRegion[] = []
  const counts = new Map<string, number>()
  const appendRedacted = (value: string): void => {
    const redacted = redactText(value, config)
    text += redacted.text
    for (const count of redacted.counts) {
      counts.set(count.name, (counts.get(count.name) ?? 0) + count.count)
    }
  }

  for (const region of [...sourceRegions].sort((left, right) => left.charStart - right.charStart)) {
    if (region.charStart < cursor || region.charEnd < region.charStart) {
      throw new Error("Parsed source regions must be ordered and non-overlapping.")
    }
    appendRedacted(document.text.slice(cursor, region.charStart))
    const charStart = text.length
    appendRedacted(document.text.slice(region.charStart, region.charEnd))
    regions.push({ ...region, charStart, charEnd: text.length })
    cursor = region.charEnd
  }
  appendRedacted(document.text.slice(cursor))

  const redactionCounts = [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, count]) => ({ name, count }))
  const pages = document.pages
    ? regions.flatMap((region) =>
        region.location.kind === "page"
          ? [
              {
                pageNumber: region.location.start,
                charStart: region.charStart,
                charEnd: region.charEnd,
              },
            ]
          : [],
      )
    : undefined
  return {
    document: {
      ...document,
      text,
      regions,
      ...(pages ? { pages } : {}),
      sourceLineCoordinates:
        document.sourceLineCoordinates === true && redactionCounts.length === 0,
    },
    counts: redactionCounts,
  }
}

function pageRegions(document: ParsedDocument): ParsedRegion[] {
  return (document.pages ?? []).map((page) => ({
    charStart: page.charStart,
    charEnd: page.charEnd,
    contextPath: `Page ${page.pageNumber}`,
    location: { kind: "page", start: page.pageNumber, end: page.pageNumber },
  }))
}

/**
 * Luhn checksum used by credit card numbers. Applied as a match-then-verify on
 * the `credit_card` pattern so numeric runs that are not valid card numbers
 * (version numbers, account IDs, hex runs) are left untouched instead of being
 * over-redacted.
 */
function matchesLuhn(candidate: string): boolean {
  const digits = candidate.replace(/\D/gu, "")
  if (digits.length < 13 || digits.length > 19) {
    return false
  }
  let sum = 0
  let shouldDouble = false
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let value = Number.parseInt(digits[index] ?? "", 10)
    if (shouldDouble) {
      value *= 2
      if (value > 9) {
        value -= 9
      }
    }
    sum += value
    shouldDouble = !shouldDouble
  }
  return sum % 10 === 0
}

export function totalRedactions(counts: RedactionCount[]): number {
  return counts.reduce((total, entry) => total + entry.count, 0)
}

function compilePattern(pattern: RedactionPattern): RegExp {
  const flags = pattern.flags?.includes("g") ? pattern.flags : `${pattern.flags ?? ""}g`
  return new RegExp(pattern.pattern, flags)
}
