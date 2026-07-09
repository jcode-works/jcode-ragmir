const MAX_RETRIEVAL_QUERY_LENGTH = 250
const TAIL_RETRIEVAL_QUERY_LENGTH = 200
const MIN_RETRIEVAL_QUERY_LENGTH = 10

export interface SanitizedQuery {
  query: string
  changed: boolean
  method: "passthrough" | "question" | "labeled-tail" | "tail-sentence" | "tail"
  originalLength: number
}

const QUERY_LABEL_PATTERN =
  /(?:^|\n)\s*(?:question|query|search|recherche|demande|user|utilisateur)\s*:\s*(.+)$/giu

export function sanitizeRetrievalQuery(input: string): SanitizedQuery {
  const normalized = stripLoneSurrogates(input).replace(/\s+/gu, " ").trim()
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
  const cleaned = stripLoneSurrogates(query).replace(/\s+/gu, " ").trim()
  const bounded = cleaned.slice(0, MAX_RETRIEVAL_QUERY_LENGTH).trim()
  return {
    query: bounded,
    changed: bounded !== input,
    method,
    originalLength: input.length,
  }
}

function finalQuestion(text: string): string | null {
  const matches = [...text.matchAll(/[^.?!\n]{10,}\?/gu)]
  for (const match of matches.reverse()) {
    const value = match[0]?.trim()
    if (isUsableRetrievalQuery(value)) {
      return value
    }
  }
  return null
}

function labeledTail(text: string): string | null {
  const matches = [...text.matchAll(QUERY_LABEL_PATTERN)]
  for (const match of matches.reverse()) {
    const value = match[1]?.trim()
    if (isUsableRetrievalQuery(value)) {
      return value
    }
  }
  return null
}

function finalSentence(text: string): string | null {
  const sentences = text.match(/[^.?!\n]{10,}[.?!]?/gu) ?? []
  for (const sentence of sentences.reverse()) {
    const value = sentence.trim()
    if (isUsableRetrievalQuery(value)) {
      return value
    }
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
    /[\p{L}\p{N}]/u.test(value)
  )
}

function stripLoneSurrogates(value: string): string {
  return value.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/gu,
    "",
  )
}
