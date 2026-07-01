import type { Config, RedactionCount, RedactionPattern } from "./types.js"

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
    name: "api_token",
    pattern:
      "\\b(?:sk|pk|ghp|gho|github_pat|npm)_[A-Za-z0-9_=-]{20,}\\b|\\b[A-Za-z0-9_-]{32,}\\.[A-Za-z0-9_-]{16,}\\.[A-Za-z0-9_-]{16,}\\b",
    flags: "g",
  },
  {
    name: "email",
    pattern: "\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b",
    flags: "gi",
  },
  {
    name: "iban",
    pattern: "\\b[A-Z]{2}\\d{2}[A-Z0-9]{11,30}\\b",
    flags: "g",
  },
  {
    name: "credit_card",
    pattern: "\\b(?:\\d[ -]*?){13,19}\\b",
    flags: "g",
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
    let count = 0
    text = text.replace(regexp, () => {
      count += 1
      return pattern.replacement ?? `[REDACTED_${pattern.name.toUpperCase()}]`
    })
    if (count > 0) {
      counts.push({ name: pattern.name, count })
    }
  }

  return { text, counts }
}

export function totalRedactions(counts: RedactionCount[]): number {
  return counts.reduce((total, entry) => total + entry.count, 0)
}

function compilePattern(pattern: RedactionPattern): RegExp {
  const flags = pattern.flags?.includes("g") ? pattern.flags : `${pattern.flags ?? ""}g`
  return new RegExp(pattern.pattern, flags)
}
