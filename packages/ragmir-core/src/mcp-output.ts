import type {
  CompactSearchResult,
  ExpandedCitation,
  McpOutputTool,
  ResearchEvidence,
  ResearchReport,
  SearchResult,
} from "./types.js"

export const MIN_MCP_OUTPUT_BYTES = 1_024

export interface McpOutputMetadata {
  tool: McpOutputTool
  budgetBytes: number
  retrievedBytes: number
  returnedBytes: number
  compacted: boolean
  truncated: boolean
  omittedItems: number
  expandTool: "ragmir_expand"
}

export interface McpTextResult {
  [key: string]: unknown
  content: [{ type: "text"; text: string }]
  _meta: {
    "ragmir/output": McpOutputMetadata
  }
}

export interface BudgetedMcpResult {
  result: McpTextResult
  metadata: McpOutputMetadata
}

export interface McpCitationPreview {
  citation: string
}

export type McpSearchPayload = Array<SearchResult | CompactSearchResult | McpCitationPreview>

export interface McpAskPayload {
  answer: string
  sources: McpSearchPayload
  staleWarning: string | null
}

interface CompactResearchEvidence extends Omit<ResearchEvidence, "text"> {
  snippet: string
}

interface McpResearchDetailedPayload extends Omit<ResearchReport, "evidence"> {
  evidence: Array<ResearchEvidence | CompactResearchEvidence>
}

export interface McpResearchSummaryPayload {
  queryIncluded: false
  ready: boolean
  audit: ResearchReport["audit"]
  evidence: McpCitationPreview[]
  budgets: ResearchReport["budgets"]
  omitted: {
    generatedQueries: number
    securityWarnings: number
    sourceDiagnostics: number
    evidence: number
    codeEvidence: number
    gaps: number
    nextSteps: number
  }
}

export type McpResearchPayload = McpResearchDetailedPayload | McpResearchSummaryPayload

export interface McpExpandedPassagePreview {
  chunkIndex: number
  citation: string
  text: string
}

export interface McpExpandedCitationSummary {
  found: boolean
  chunkIndex: number
  contextRadius: number
  requestedCitation?: string
  relativePath?: string
  metadataOmitted: boolean
  passages: McpExpandedPassagePreview[]
  omittedPassages: number
}

export type McpExpandedCitationPayload = ExpandedCitation | McpExpandedCitationSummary

interface ReducedPayload<T> {
  value: T
  omittedItems: number
  truncated: boolean
}

interface BudgetMcpJsonOptions<T> {
  tool: McpOutputTool
  maxBytes: number
  fullValue: unknown
  preferredValue: T
  compactValue?: T
  compacted: boolean
  reduce: (value: T, maxBytes: number) => ReducedPayload<T>
}

export function resolveMcpOutputBudget(configured: number, requested?: number): number {
  const configuredBudget = Math.max(MIN_MCP_OUTPUT_BYTES, Math.floor(configured))
  if (requested === undefined) {
    return configuredBudget
  }
  return Math.max(MIN_MCP_OUTPUT_BYTES, Math.min(configuredBudget, Math.floor(requested)))
}

export function budgetMcpJson<T>(options: BudgetMcpJsonOptions<T>): BudgetedMcpResult {
  const budgetBytes = Math.max(MIN_MCP_OUTPUT_BYTES, Math.floor(options.maxBytes))
  const retrievedBytes = jsonBytes(options.fullValue)
  let value = options.preferredValue
  let compacted = options.compacted

  if (
    jsonBytes(value) > budgetBytes &&
    options.compactValue !== undefined &&
    jsonBytes(options.compactValue) < jsonBytes(value)
  ) {
    value = options.compactValue
    compacted = true
  }

  const reduced = options.reduce(value, budgetBytes)
  const text = serializeJson(reduced.value)
  const returnedBytes = Buffer.byteLength(text, "utf8")
  if (returnedBytes > budgetBytes) {
    throw new Error(
      `MCP output reducer returned ${returnedBytes} bytes for a ${budgetBytes}-byte budget.`,
    )
  }

  const metadata: McpOutputMetadata = {
    tool: options.tool,
    budgetBytes,
    retrievedBytes,
    returnedBytes,
    compacted,
    truncated: reduced.truncated,
    omittedItems: reduced.omittedItems,
    expandTool: "ragmir_expand",
  }
  return {
    result: {
      content: [{ type: "text", text }],
      _meta: { "ragmir/output": metadata },
    },
    metadata,
  }
}

export function fitSearchPayload(
  value: McpSearchPayload,
  maxBytes: number,
): ReducedPayload<McpSearchPayload> {
  if (jsonBytes(value) <= maxBytes) {
    return { value, omittedItems: 0, truncated: false }
  }
  for (let length = value.length - 1; length >= 1; length -= 1) {
    const candidate = value.slice(0, length)
    if (jsonBytes(candidate) <= maxBytes) {
      return {
        value: candidate,
        omittedItems: value.length - candidate.length,
        truncated: true,
      }
    }
  }

  const citations = value.map(toCitationPreview)
  for (let length = citations.length; length >= 1; length -= 1) {
    const candidate = citations.slice(0, length)
    if (jsonBytes(candidate) <= maxBytes) {
      return {
        value: candidate,
        omittedItems: value.length - candidate.length,
        truncated: true,
      }
    }
  }
  return { value: [], omittedItems: value.length, truncated: value.length > 0 }
}

export function fitAskPayload(
  value: McpAskPayload,
  maxBytes: number,
): ReducedPayload<McpAskPayload> {
  if (jsonBytes(value) <= maxBytes) {
    return { value, omittedItems: 0, truncated: false }
  }

  for (let length = value.sources.length - 1; length >= 1; length -= 1) {
    const candidate = { ...value, sources: value.sources.slice(0, length) }
    if (jsonBytes(candidate) <= maxBytes) {
      return {
        value: candidate,
        omittedItems: value.sources.length - candidate.sources.length,
        truncated: true,
      }
    }
  }

  const minimal: McpAskPayload = {
    answer: "Use the cited source and expand it when more context is needed.",
    sources: value.sources[0] ? [toCitationPreview(value.sources[0])] : [],
    staleWarning: null,
  }
  if (jsonBytes(minimal) > maxBytes) {
    minimal.sources = []
  }
  return {
    value: minimal,
    omittedItems: Math.max(0, value.sources.length - minimal.sources.length),
    truncated: true,
  }
}

export function fitResearchPayload(
  value: McpResearchPayload,
  maxBytes: number,
): ReducedPayload<McpResearchPayload> {
  if (jsonBytes(value) <= maxBytes) {
    return { value, omittedItems: 0, truncated: false }
  }

  if (isResearchSummary(value)) {
    const withoutEvidence: McpResearchSummaryPayload = {
      ...value,
      evidence: [],
      omitted: {
        ...value.omitted,
        evidence: value.omitted.evidence + value.evidence.length,
      },
    }
    return {
      value: withoutEvidence,
      omittedItems: value.evidence.length,
      truncated: true,
    }
  }

  const candidate = cloneResearchPayload(value)
  let omittedItems = 0
  while (jsonBytes(candidate) > maxBytes && removeResearchDetail(candidate)) {
    omittedItems += 1
  }
  if (jsonBytes(candidate) <= maxBytes) {
    return { value: candidate, omittedItems, truncated: true }
  }

  const firstEvidence = value.evidence[0]
  const minimal: McpResearchSummaryPayload = {
    queryIncluded: false,
    ready: candidate.ready,
    audit: candidate.audit,
    evidence: firstEvidence ? [toCitationPreview(firstEvidence)] : [],
    budgets: candidate.budgets,
    omitted: {
      generatedQueries: value.generatedQueries.length,
      securityWarnings: value.securityWarnings.length,
      sourceDiagnostics:
        value.sourceDiagnostics.duplicateCandidates.length +
        value.sourceDiagnostics.archiveCandidates.length +
        value.sourceDiagnostics.mirrorCandidates.length,
      evidence: Math.max(0, value.evidence.length - (firstEvidence ? 1 : 0)),
      codeEvidence: value.codeEvidence.length,
      gaps: value.gaps.length,
      nextSteps: value.nextSteps.length,
    },
  }
  if (jsonBytes(minimal) > maxBytes) {
    minimal.evidence = []
    minimal.omitted.evidence = value.evidence.length
  }
  return {
    value: minimal,
    omittedItems:
      omittedItems + Object.values(minimal.omitted).reduce((total, count) => total + count, 0),
    truncated: true,
  }
}

export function fitExpandedCitation(
  value: McpExpandedCitationPayload,
  maxBytes: number,
): ReducedPayload<McpExpandedCitationPayload> {
  if (jsonBytes(value) <= maxBytes) {
    return { value, omittedItems: 0, truncated: false }
  }
  if ("metadataOmitted" in value) {
    const withoutPassages: McpExpandedCitationSummary = {
      ...value,
      passages: [],
      omittedPassages: value.omittedPassages + value.passages.length,
    }
    return {
      value: withoutPassages,
      omittedItems: value.passages.length,
      truncated: true,
    }
  }

  const prioritized = [...value.passages].sort(
    (left, right) =>
      Math.abs(left.chunkIndex - value.chunkIndex) -
        Math.abs(right.chunkIndex - value.chunkIndex) || left.chunkIndex - right.chunkIndex,
  )
  const baseValue = fitExpandedSummaryMetadata(value, maxBytes)
  const target = prioritized.find((passage) => passage.chunkIndex === value.chunkIndex)
  let passages: McpExpandedPassagePreview[] = []
  if (target) {
    const targetPreview = expandedPassagePreview(target)
    const targetOnly: McpExpandedCitationSummary = {
      ...baseValue,
      passages: [targetPreview],
      omittedPassages: value.passages.length - 1,
    }
    if (jsonBytes(targetOnly) <= maxBytes) {
      passages = [targetPreview]
    } else {
      const fittedTarget = fitExpandedTarget(
        baseValue,
        targetPreview,
        value.passages.length,
        maxBytes,
      )
      if (!fittedTarget) {
        return {
          value: baseValue,
          omittedItems: value.passages.length,
          truncated: true,
        }
      }
      passages = fittedTarget.passages
    }
  }

  for (const passage of prioritized.filter((candidate) => candidate !== target)) {
    const candidate = {
      ...baseValue,
      passages: [...passages, expandedPassagePreview(passage)].sort(
        (left, right) => left.chunkIndex - right.chunkIndex,
      ),
      omittedPassages: value.passages.length - passages.length - 1,
    }
    if (jsonBytes(candidate) <= maxBytes) {
      passages.push(expandedPassagePreview(passage))
    }
  }
  if (passages.length > 0) {
    return {
      value: {
        ...baseValue,
        passages: passages.sort((left, right) => left.chunkIndex - right.chunkIndex),
        omittedPassages: value.passages.length - passages.length,
      },
      omittedItems: value.passages.length - passages.length,
      truncated: true,
    }
  }

  return {
    value: baseValue,
    omittedItems: value.passages.length,
    truncated: true,
  }
}

function cloneResearchPayload(value: McpResearchDetailedPayload): McpResearchDetailedPayload {
  return {
    ...value,
    generatedQueries: [...value.generatedQueries],
    securityWarnings: [...value.securityWarnings],
    sourceDiagnostics: {
      duplicateCandidates: [...value.sourceDiagnostics.duplicateCandidates],
      archiveCandidates: [...value.sourceDiagnostics.archiveCandidates],
      mirrorCandidates: [...value.sourceDiagnostics.mirrorCandidates],
    },
    evidence: [...value.evidence],
    codeEvidence: [...value.codeEvidence],
    gaps: [...value.gaps],
    nextSteps: [...value.nextSteps],
  }
}

function removeResearchDetail(value: McpResearchDetailedPayload): boolean {
  const arrays = [
    value.sourceDiagnostics.duplicateCandidates,
    value.sourceDiagnostics.archiveCandidates,
    value.sourceDiagnostics.mirrorCandidates,
    value.codeEvidence,
    value.evidence,
    value.generatedQueries,
    value.securityWarnings,
    value.gaps,
    value.nextSteps,
  ]
  const largest = arrays.reduce<unknown[] | null>(
    (current, items) => (items.length > (current?.length ?? 0) ? items : current),
    null,
  )
  if (!largest || largest.length === 0) {
    return false
  }
  largest.pop()
  return true
}

function fitExpandedTarget(
  value: McpExpandedCitationSummary,
  target: McpExpandedPassagePreview,
  passageCount: number,
  maxBytes: number,
): McpExpandedCitationSummary | null {
  const characters = [...target.text]
  let low = 0
  let high = characters.length
  let best: McpExpandedCitationSummary | null = null
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const text =
      middle < characters.length ? `${characters.slice(0, middle).join("")}...` : target.text
    const candidate: McpExpandedCitationSummary = {
      ...value,
      passages: [{ ...target, text }],
      omittedPassages: passageCount - 1,
    }
    if (jsonBytes(candidate) <= maxBytes) {
      best = candidate
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return best
}

function fitExpandedSummaryMetadata(
  value: ExpandedCitation,
  maxBytes: number,
): McpExpandedCitationSummary {
  const summary: McpExpandedCitationSummary = {
    found: value.found,
    chunkIndex: value.chunkIndex,
    contextRadius: value.contextRadius,
    requestedCitation: value.requestedCitation,
    relativePath: value.relativePath,
    metadataOmitted: false,
    passages: [],
    omittedPassages: value.passages.length,
  }
  if (jsonBytes(summary) <= maxBytes) {
    return summary
  }
  const { relativePath: _relativePath, ...summaryWithoutRelativePath } = summary
  const withoutRelativePath: McpExpandedCitationSummary = {
    ...summaryWithoutRelativePath,
    metadataOmitted: true,
  }
  if (jsonBytes(withoutRelativePath) <= maxBytes) {
    return withoutRelativePath
  }
  return {
    found: value.found,
    chunkIndex: value.chunkIndex,
    contextRadius: value.contextRadius,
    metadataOmitted: true,
    passages: [],
    omittedPassages: value.passages.length,
  }
}

function expandedPassagePreview(
  passage: ExpandedCitation["passages"][number],
): McpExpandedPassagePreview {
  return {
    chunkIndex: passage.chunkIndex,
    citation: passage.citation,
    text: passage.text,
  }
}

function toCitationPreview(value: { citation: string }): McpCitationPreview {
  return { citation: value.citation }
}

function isResearchSummary(value: McpResearchPayload): value is McpResearchSummaryPayload {
  return "queryIncluded" in value
}

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(serializeJson(value), "utf8")
}

function serializeJson(value: unknown): string {
  return JSON.stringify(value)
}

export interface BoundedJsonMetadata {
  source: string
  budgetBytes: number
  retrievedBytes: number
  returnedBytes: number
  compacted: boolean
  truncated: boolean
  omittedItems: number
}

export interface BoundedJsonOutput {
  text: string
  metadata: BoundedJsonMetadata
}

export interface CompactJsonValue {
  value: unknown
  omittedItems: number
}

export function fitMcpJsonOutput(
  value: unknown,
  maxBytes: number,
  source: string,
  compact?: CompactJsonValue,
): BoundedJsonOutput {
  const budgetBytes = Math.max(MIN_MCP_OUTPUT_BYTES, Math.floor(maxBytes))
  const fullText = JSON.stringify(value) ?? "null"
  const retrievedBytes = Buffer.byteLength(fullText, "utf8")
  if (retrievedBytes <= budgetBytes) {
    return fittedJsonOutput(source, budgetBytes, fullText, retrievedBytes, false, 0)
  }

  if (!compact) {
    throw new Error(`MCP output ${source} requires a semantic compact payload.`)
  }
  const compactText = JSON.stringify(compact.value) ?? "null"
  const compactBytes = Buffer.byteLength(compactText, "utf8")
  if (compactBytes > budgetBytes) {
    throw new Error(
      `MCP compact output ${source} returned ${compactBytes} bytes for a ${budgetBytes}-byte budget.`,
    )
  }
  return fittedJsonOutput(
    source,
    budgetBytes,
    compactText,
    retrievedBytes,
    true,
    compact.omittedItems,
  )
}

function fittedJsonOutput(
  source: string,
  budgetBytes: number,
  text: string,
  retrievedBytes: number,
  truncated: boolean,
  omittedItems: number,
): BoundedJsonOutput {
  return {
    text,
    metadata: {
      source,
      budgetBytes,
      retrievedBytes,
      returnedBytes: Buffer.byteLength(text, "utf8"),
      compacted: truncated,
      truncated,
      omittedItems,
    },
  }
}
