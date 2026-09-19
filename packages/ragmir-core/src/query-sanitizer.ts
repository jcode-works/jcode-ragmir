import { RagmirError } from "./errors.js"

export const MAX_RETRIEVAL_QUERY_LENGTH = 20_000

export interface SanitizedQuery {
  query: string
  changed: boolean
  method: "passthrough" | "normalized"
  originalLength: number
}

export function sanitizeRetrievalQuery(input: string): SanitizedQuery {
  if (input.length > MAX_RETRIEVAL_QUERY_LENGTH) {
    throw new RagmirError(
      "INVALID_ARGUMENT",
      `query must contain at most ${MAX_RETRIEVAL_QUERY_LENGTH} characters. Split the request into focused searches.`,
    )
  }
  const query = compactWhitespace(stripLoneSurrogates(input))
  const changed = query !== input
  return {
    query,
    changed,
    method: changed ? "normalized" : "passthrough",
    originalLength: input.length,
  }
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
