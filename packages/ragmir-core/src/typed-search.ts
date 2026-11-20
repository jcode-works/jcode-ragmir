import { z } from "zod"
import { RagmirError } from "./errors.js"
import { coverageWords } from "./ranking.js"
import { shareStem, tokenize } from "./text.js"
import type { SearchFormulation } from "./types.js"

const MAX_SEARCH_FORMULATIONS = 5
const MAX_FORMULATION_CHARACTERS = 2_000

// Messages complete the field path, as in `searches[0].query must not be empty.`
const formulationSchema = z
  .object(
    {
      type: z.enum(["lex", "vec", "hyde"], { error: "must be lex, vec, or hyde." }),
      query: z
        .string({ error: "must be a string." })
        .trim()
        .min(1, { error: "must not be empty." })
        .max(MAX_FORMULATION_CHARACTERS, {
          error: `must contain at most ${MAX_FORMULATION_CHARACTERS} characters.`,
        }),
    },
    { error: "must be an object with only type and query." },
  )
  .strict()
  .superRefine((formulation, context) => {
    const problem = formulation.type === "lex" ? lexSyntaxProblem(formulation.query) : null
    if (problem !== null) {
      context.addIssue({ code: "custom", message: problem, path: ["query"] })
    }
  })

/** The formulations a search accepts, as the library, MCP, LangChain, and golden files check them. */
export const searchFormulationsSchema = z
  .array(formulationSchema, { error: "must be a list of formulations." })
  .max(MAX_SEARCH_FORMULATIONS, {
    error: `must hold at most ${MAX_SEARCH_FORMULATIONS} formulations.`,
  })

/** A `lex` formulation split into what the keyword index can express. */
export interface LexFormulation {
  type: "lex"
  text: string
  /** Folded words that rank passages, as a question's words do. */
  words: string[]
  /** Quoted phrases, as written, that every returned passage holds. */
  phrases: string[]
  /** Folded words no returned passage holds, nor any word sharing their stem. */
  excludedWords: string[]
  /** Phrases, as written, that no returned passage holds. */
  excludedPhrases: string[]
}

export type PreparedFormulation = LexFormulation | { type: "vec" | "hyde"; text: string }

/**
 * Validate the agent's formulations of one need. Lex syntax stays inside `lex`: a natural-language
 * question keeps its quotes and hyphens as plain text, so nothing changes without formulations.
 */
export function prepareFormulations(
  formulations: readonly SearchFormulation[] | undefined,
): PreparedFormulation[] {
  if (formulations === undefined) {
    return []
  }
  const parsed = searchFormulationsSchema.safeParse(formulations)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const field = (issue?.path ?? []).reduce<string>(
      (label, key) => (typeof key === "number" ? `${label}[${key}]` : `${label}.${String(key)}`),
      "searches",
    )
    throw new RagmirError("INVALID_ARGUMENT", `${field} ${issue?.message ?? "is invalid."}`)
  }
  return parsed.data.map(({ type, query: text }) =>
    type === "lex" ? parseLexFormulation(text) : { type, text },
  )
}

/**
 * Why one formulation is invalid, as a message completing its name (`must not be empty.`), or null
 * when it is valid. The CLI checks each `--lex`, `--vec`, and `--hyde` value with it.
 */
export function formulationProblem(formulation: SearchFormulation): string | null {
  const parsed = formulationSchema.safeParse(formulation)
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? "is invalid.")
}

/** Why a `lex` search cannot run as written, or null when it can. */
function lexSyntaxProblem(text: string): string | null {
  if (/[\r\n]/u.test(text)) {
    return "must be one line: send one lex search per line."
  }
  if ((text.match(/"/gu) ?? []).length % 2 === 1) {
    return 'leaves a quote open: close every "phrase".'
  }
  const lex = parseLexFormulation(text)
  return lex.words.length === 0 && lex.phrases.length === 0
    ? "only excludes: add a word or a quoted phrase to find."
    : null
}

/**
 * `word` ranks, `"exact phrase"` must appear, `-word` and `-"phrase"` must not. A hyphen inside a
 * word (`real-time`, `DEC-0054`) keeps it whole: only a leading hyphen excludes, and an excluded
 * word of several parts is excluded as a phrase.
 */
export function parseLexFormulation(text: string): LexFormulation {
  const lex: LexFormulation = {
    type: "lex",
    text,
    words: [],
    phrases: [],
    excludedWords: [],
    excludedPhrases: [],
  }
  for (const match of text.matchAll(/(-?)"([^"]*)"|(-?)([^\s"]+)/gu)) {
    const excluded = (match[1] ?? match[3]) === "-"
    const written = (match[2] ?? match[4] ?? "").trim()
    const words = tokenize(written)
    if (words.length === 0) {
      continue
    }
    if (match[2] !== undefined || (excluded && words.length > 1)) {
      const phrases = excluded ? lex.excludedPhrases : lex.phrases
      phrases.push(written)
    } else {
      const target = excluded ? lex.excludedWords : lex.words
      target.push(...words)
    }
  }
  return lex
}

/** Plain words of a formulation, without lex syntax, for a keyword scan and for excerpt focus. */
export function formulationKeywords(formulation: PreparedFormulation): string {
  return formulation.type === "lex"
    ? [...formulation.words, ...formulation.phrases].join(" ")
    : formulation.text
}

/** Whether a passage holds every phrase a `lex` formulation requires (the scan fallback). */
export function holdsRequiredPhrases(lex: LexFormulation, text: string): boolean {
  const words = phraseSpace(text)
  return lex.phrases.every((phrase) => words.includes(phraseSpace(phrase)))
}

/**
 * Exclusions apply to the fused ranking, not only to the keyword list: a passage that another
 * formulation or the question found still holds the excluded word.
 */
export function exclusionMatcher(
  formulations: readonly PreparedFormulation[],
): ((text: string) => boolean) | null {
  const lexes = formulations.filter((formulation) => formulation.type === "lex")
  const words = lexes.flatMap((lex) => lex.excludedWords)
  const phrases = lexes.flatMap((lex) => lex.excludedPhrases).map(phraseSpace)
  if (words.length === 0 && phrases.length === 0) {
    return null
  }
  return (text) => {
    if (phrases.length > 0) {
      const textWords = phraseSpace(text)
      if (phrases.some((phrase) => textWords.includes(phrase))) return true
    }
    const passageWords = [...coverageWords(text)]
    return words.some((word) => passageWords.some((passageWord) => shareStem(word, passageWord)))
  }
}

/** Folded words in order, padded with spaces so a phrase matches whole words only. */
function phraseSpace(text: string): string {
  return ` ${tokenize(text).join(" ")} `
}
