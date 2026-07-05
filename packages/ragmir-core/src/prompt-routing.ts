export type PromptRouteTool =
  | "none"
  | "ragmir_status"
  | "ragmir_search"
  | "ragmir_ask"
  | "ragmir_research"

export interface PromptRouteDecision {
  shouldUseRagmir: boolean
  confidence: number
  tool: PromptRouteTool
  query: string | null
  reason: string
  matchedSignals: string[]
  safeguards: string[]
}

interface PromptSignal {
  label: string
  pattern: RegExp
  weight: number
}

const MINIMUM_RAGMIR_CONFIDENCE = 0.55
const MAXIMUM_QUERY_LENGTH = 1_200

const POSITIVE_SIGNALS: PromptSignal[] = [
  {
    label: "explicit Ragmir request",
    pattern: /\b(ragmir|ragmir_(search|ask|research)|local rag|knowledge base)\b/iu,
    weight: 0.45,
  },
  {
    label: "MCP local context request",
    pattern:
      /\bmcp\b.+\b(ragmir|local|repo|repository|context|knowledge|docs|agent|agents)\b|\b(ragmir|local|repo|repository|context|knowledge|docs|agent|agents)\b.+\bmcp\b/iu,
    weight: 0.28,
  },
  {
    label: "current repository context",
    pattern: /\b(this|current|local|target)\s+(repo|repository|project|workspace|codebase)\b/iu,
    weight: 0.35,
  },
  {
    label: "source path or supported file",
    pattern:
      /(?:^|\s)(?:[\w.-]+\/[\w./-]+|\.[\w-]+\/[\w./-]+|[\w-]+\.(?:md|mdx|txt|ts|tsx|js|jsx|json|jsonl|yaml|yml|toml|csv|pdf|docx|xlsx|pptx|rs|go|py|java|rb|php|astro))(?:\s|$)/iu,
    weight: 0.34,
  },
  {
    label: "local documents or cited evidence",
    pattern:
      /\b(local|private|confidential|internal|source|sources|document|documents|docs|evidence|citation|citations|cited|passage|passages)\b/iu,
    weight: 0.25,
  },
  {
    label: "question about local evidence",
    pattern:
      /\b(what|how|why|where|which|comment|pourquoi|quel|quelle)\b.+\b(local|private|confidential|source|sources|document|documents|docs|evidence|citation|citations)\b/iu,
    weight: 0.25,
  },
  {
    label: "architecture or implementation investigation",
    pattern:
      /\b(architecture|implementation plan|release readiness|migration|refactor|audit|review|risk|risks|decision|decisions|history|previous|existing behavior|how does .+ work)\b/iu,
    weight: 0.26,
  },
  {
    label: "agent needs grounded context",
    pattern:
      /\b(agent|agents|codex|claude|claude code|cline|opencode|kimi)\b.+\b(context|evidence|docs|repo|repository|knowledge)\b/iu,
    weight: 0.28,
  },
  {
    label: "retrieve exact source",
    pattern: /\b(find|search|where is|which file|what file|show me|cite|quote|source)\b/iu,
    weight: 0.2,
  },
]

const NEGATIVE_SIGNALS: PromptSignal[] = [
  {
    label: "simple language rewrite",
    pattern: /^(translate|traduis|rewrite|rephrase|corrige|fix grammar|improve this sentence)\b/iu,
    weight: 0.35,
  },
  {
    label: "simple runtime fact",
    pattern: /\b(current time|current date|today's date|date du jour|heure actuelle|weather)\b/iu,
    weight: 0.3,
  },
  {
    label: "general concept request",
    pattern: /^(what is|explain|define|c'est quoi|explique)\b/iu,
    weight: 0.18,
  },
]

const STATUS_PATTERNS =
  /\b(status|doctor|ready|readiness|setup|configured|index fresh|stale index)\b/iu
const RESEARCH_PATTERNS =
  /\b(audit|review|plan|strategy|architecture|investigate|debug|risk|risks|release readiness|migration|refactor|summari[sz]e|synthesi[sz]e|compare|why)\b/iu
const SEARCH_PATTERNS =
  /\b(find|search|where is|which file|what file|show me|cite|quote|exact|passage|source)\b/iu
const QUESTION_PATTERNS = /\b(how|why|what|when|where|who|comment|pourquoi|quoi|quel|quelle)\b|\?/iu

export function routePrompt(prompt: string): PromptRouteDecision {
  const query = normalizePrompt(prompt)
  if (query.length === 0) {
    return {
      shouldUseRagmir: false,
      confidence: 0,
      tool: "none",
      query: null,
      reason: "The prompt is empty.",
      matchedSignals: [],
      safeguards: defaultSafeguards(),
    }
  }

  const positiveMatches = matchingSignals(query, POSITIVE_SIGNALS)
  const negativeMatches = matchingSignals(query, NEGATIVE_SIGNALS)
  const confidence = confidenceScore(positiveMatches, negativeMatches)
  const shouldUseRagmir =
    positiveMatches.some((signal) => signal.label === "explicit Ragmir request") ||
    confidence >= MINIMUM_RAGMIR_CONFIDENCE
  const tool = shouldUseRagmir ? selectPromptRouteTool(query) : "none"

  return {
    shouldUseRagmir,
    confidence,
    tool,
    query: shouldUseRagmir ? query : null,
    reason: routeReason(shouldUseRagmir, positiveMatches, negativeMatches),
    matchedSignals: [
      ...positiveMatches.map((signal) => signal.label),
      ...negativeMatches.map((signal) => `negative: ${signal.label}`),
    ],
    safeguards: defaultSafeguards(),
  }
}

function normalizePrompt(prompt: string): string {
  return prompt.trim().replace(/\s+/gu, " ").slice(0, MAXIMUM_QUERY_LENGTH)
}

function matchingSignals(prompt: string, signals: readonly PromptSignal[]): PromptSignal[] {
  return signals.filter((signal) => signal.pattern.test(prompt))
}

function confidenceScore(
  positiveMatches: readonly PromptSignal[],
  negativeMatches: readonly PromptSignal[],
): number {
  const positiveWeight = positiveMatches.reduce((total, signal) => total + signal.weight, 0)
  const negativeWeight = negativeMatches.reduce((total, signal) => total + signal.weight, 0)
  return roundConfidence(Math.max(0, Math.min(0.95, 0.12 + positiveWeight - negativeWeight)))
}

function roundConfidence(value: number): number {
  return Math.round(value * 100) / 100
}

function selectPromptRouteTool(prompt: string): PromptRouteTool {
  if (RESEARCH_PATTERNS.test(prompt)) {
    return "ragmir_research"
  }
  if (STATUS_PATTERNS.test(prompt)) {
    return "ragmir_status"
  }
  if (SEARCH_PATTERNS.test(prompt)) {
    return "ragmir_search"
  }
  if (QUESTION_PATTERNS.test(prompt)) {
    return "ragmir_ask"
  }
  return "ragmir_search"
}

function routeReason(
  shouldUseRagmir: boolean,
  positiveMatches: readonly PromptSignal[],
  negativeMatches: readonly PromptSignal[],
): string {
  if (shouldUseRagmir) {
    const labels = positiveMatches.map((signal) => signal.label).join(", ")
    return `The prompt appears to need local project evidence: ${labels}.`
  }
  if (negativeMatches.length > 0 && positiveMatches.length === 0) {
    const labels = negativeMatches.map((signal) => signal.label).join(", ")
    return `The prompt looks self-contained and matched non-Ragmir signals: ${labels}.`
  }
  return "The prompt does not strongly indicate that local Ragmir evidence is needed."
}

function defaultSafeguards(): string[] {
  return [
    "No prompt text is stored by this router.",
    "Use Ragmir only through the local CLI, library, or MCP server.",
    "Prefer compact cited retrieval before exposing long private passages.",
  ]
}
