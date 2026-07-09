const MAX_RETRIEVAL_QUERY_LENGTH = 250
const TAIL_RETRIEVAL_QUERY_LENGTH = 200
const MIN_RETRIEVAL_QUERY_LENGTH = 10
const QUERY_LABELS = new Set([
  "question",
  "query",
  "search",
  "recherche",
  "demande",
  "user",
  "utilisateur",
])

export interface SanitizedQuery {
  query: string
  changed: boolean
  method: "passthrough" | "question" | "labeled-tail" | "tail-sentence" | "tail"
  originalLength: number
}

export function sanitizeRetrievalQuery(input: string): SanitizedQuery {
  const normalized = compactWhitespace(stripLoneSurrogates(input))
  if (normalized.length <= MAX_RETRIEVAL_QUERY_LENGTH) {
    return {
      query: normalized,
      changed: normalized !== input,
      method: "passthrough",
      originalLength: input.length,
    }
  }

  const question = finalQuestion(normalized)
  if (question !== null) {
    return sanitized(input, question, "question")
  }

  const labeled = labeledTail(input)
  if (labeled !== null) {
    return sanitized(input, labeled, "labeled-tail")
  }

  const sentence = finalSentence(normalized)
  if (sentence !== null) {
    return sanitized(input, sentence, "tail-sentence")
  }

  return sanitized(input, normalized.slice(-TAIL_RETRIEVAL_QUERY_LENGTH), "tail")
}

function sanitized(input: string, query: string, method: SanitizedQuery["method"]): SanitizedQuery {
  const cleaned = compactWhitespace(stripLoneSurrogates(query))
  const bounded = cleaned.slice(0, MAX_RETRIEVAL_QUERY_LENGTH).trim()
  return {
    query: bounded,
    changed: bounded !== input,
    method,
    originalLength: input.length,
  }
}

function finalQuestion(text: string): string | null {
  for (let end = text.length - 1; end >= 0; end -= 1) {
    if (text[end] !== "?") {
      continue
    }
    const start = previousSentenceBoundary(text, end - 1)
    const value = text.slice(start + 1, end + 1).trim()
    if (isUsableRetrievalQuery(value)) {
      return value
    }
  }
  return null
}

function labeledTail(text: string): string | null {
  const lines = text.split("\n")
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim()
    if (!line) {
      continue
    }
    const separator = line.indexOf(":")
    if (separator <= 0) {
      continue
    }
    const label = line.slice(0, separator).trim().toLowerCase()
    if (!QUERY_LABELS.has(label)) {
      continue
    }
    const value = line.slice(separator + 1).trim()
    if (isUsableRetrievalQuery(value)) {
      return value
    }
  }
  return null
}

function finalSentence(text: string): string | null {
  let end = text.length
  while (end > 0) {
    while (end > 0 && isBoundaryOrWhitespace(text[end - 1] ?? "")) {
      end -= 1
    }
    if (end <= 0) {
      break
    }
    const start = previousSentenceBoundary(text, end - 1)
    const value = text.slice(start + 1, end).trim()
    if (isUsableRetrievalQuery(value)) {
      return value
    }
    end = start
  }
  return null
}

function isUsableRetrievalQuery(value: string | undefined): value is string {
  if (value === undefined) {
    return false
  }
  return (
    value.length >= MIN_RETRIEVAL_QUERY_LENGTH &&
    value.length <= MAX_RETRIEVAL_QUERY_LENGTH &&
    hasLetterOrNumber(value)
  )
}

function stripLoneSurrogates(value: string): string {
  let output = ""
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        output += value[index] ?? ""
        output += value[index + 1] ?? ""
        index += 1
      }
      continue
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      continue
    }
    output += value[index] ?? ""
  }
  return output
}

function compactWhitespace(value: string): string {
  let output = ""
  let previousWasWhitespace = false
  for (const char of value) {
    if (char.trim() === "") {
      if (!previousWasWhitespace) {
        output += " "
      }
      previousWasWhitespace = true
      continue
    }
    output += char
    previousWasWhitespace = false
  }
  return output.trim()
}

function previousSentenceBoundary(text: string, fromIndex: number): number {
  for (let index = fromIndex; index >= 0; index -= 1) {
    if (isSentenceBoundary(text[index] ?? "")) {
      return index
    }
  }
  return -1
}

function isBoundaryOrWhitespace(char: string): boolean {
  return isSentenceBoundary(char) || char.trim() === ""
}

function isSentenceBoundary(char: string): boolean {
  return char === "." || char === "?" || char === "!" || char === "\n" || char === "\r"
}

function hasLetterOrNumber(value: string): boolean {
  for (const char of value) {
    const codePoint = char.codePointAt(0)
    if (codePoint !== undefined && codePoint >= 48 && codePoint <= 57) {
      return true
    }
    if (char.toLocaleLowerCase() !== char.toLocaleUpperCase()) {
      return true
    }
  }
  return false
}
