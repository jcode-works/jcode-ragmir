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

export type McpSearchPayload = Array<SearchResult | CompactSearchResult>

export interface McpAskPayload {
  answer: string
  sources: McpSearchPayload
  staleWarning: string | null
}

interface CompactResearchEvidence extends Omit<ResearchEvidence, "text"> {
  snippet: string
}

export interface McpResearchPayload extends Omit<ResearchReport, "evidence"> {
  evidence: Array<ResearchEvidence | CompactResearchEvidence>
}

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
  for (let length = value.length - 1; length >= 0; length -= 1) {
    const candidate = value.slice(0, length)
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

  for (let length = value.sources.length - 1; length >= 0; length -= 1) {
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
    answer: "Retrieval output exceeded the active MCP byte budget.",
    sources: [],
    staleWarning: null,
  }
  return {
    value: minimal,
    omittedItems: value.sources.length,
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

  const candidate = cloneResearchPayload(value)
  let omittedItems = 0
  while (jsonBytes(candidate) > maxBytes && removeResearchDetail(candidate)) {
    omittedItems += 1
  }
  if (jsonBytes(candidate) <= maxBytes) {
    return { value: candidate, omittedItems, truncated: true }
  }

  const minimal: McpResearchPayload = {
    query: compactString(candidate.query, 80),
    generatedQueries: [],
    ready: candidate.ready,
    audit: candidate.audit,
    securityWarnings: [],
    sourceDiagnostics: {
      duplicateCandidates: [],
      archiveCandidates: [],
      mirrorCandidates: [],
    },
    evidence: [],
    codeEvidence: [],
    gaps: [],
    nextSteps: [],
  }
  return { value: minimal, omittedItems: omittedItems + 1, truncated: true }
}

export function fitExpandedCitation(
  value: ExpandedCitation,
  maxBytes: number,
): ReducedPayload<ExpandedCitation> {
  if (jsonBytes(value) <= maxBytes) {
    return { value, omittedItems: 0, truncated: false }
  }

  const prioritized = [...value.passages].sort(
    (left, right) =>
      Math.abs(left.chunkIndex - value.chunkIndex) -
        Math.abs(right.chunkIndex - value.chunkIndex) || left.chunkIndex - right.chunkIndex,
  )
  const baseValue = fitExpandedMetadata(value, maxBytes)
  const metadataTruncated =
    baseValue.requestedCitation !== value.requestedCitation ||
    baseValue.relativePath !== value.relativePath
  const target = prioritized.find((passage) => passage.chunkIndex === value.chunkIndex)
  let passages: ExpandedCitation["passages"] = []
  if (target) {
    const targetOnly: ExpandedCitation = { ...baseValue, passages: [target] }
    if (jsonBytes(targetOnly) <= maxBytes) {
      passages = [target]
    } else {
      const fittedTarget = fitExpandedTarget(baseValue, target, maxBytes)
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
      passages: [...passages, passage].sort((left, right) => left.chunkIndex - right.chunkIndex),
    }
    if (jsonBytes(candidate) <= maxBytes) {
      passages.push(passage)
    }
  }
  if (passages.length > 0) {
    return {
      value: {
        ...baseValue,
        passages: passages.sort((left, right) => left.chunkIndex - right.chunkIndex),
      },
      omittedItems: value.passages.length - passages.length,
      truncated: true,
    }
  }

  return {
    value: baseValue,
    omittedItems: value.passages.length,
    truncated: value.passages.length > 0 || metadataTruncated,
  }
}

function cloneResearchPayload(value: McpResearchPayload): McpResearchPayload {
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

function removeResearchDetail(value: McpResearchPayload): boolean {
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
  value: ExpandedCitation,
  target: ExpandedCitation["passages"][number],
  maxBytes: number,
): ExpandedCitation | null {
  const characters = [...target.text]
  let low = 0
  let high = characters.length
  let best: ExpandedCitation | null = null
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const text =
      middle < characters.length ? `${characters.slice(0, middle).join("")}...` : target.text
    const candidate: ExpandedCitation = {
      ...value,
      passages: [{ ...target, text }],
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

function fitExpandedMetadata(value: ExpandedCitation, maxBytes: number): ExpandedCitation {
  const withoutPassages: ExpandedCitation = { ...value, passages: [] }
  if (jsonBytes(withoutPassages) <= maxBytes) {
    return withoutPassages
  }

  let low = 0
  let high = Math.max([...value.requestedCitation].length, [...value.relativePath].length)
  let best: ExpandedCitation = {
    ...withoutPassages,
    requestedCitation: "",
    relativePath: "",
  }
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const candidate: ExpandedCitation = {
      ...withoutPassages,
      requestedCitation: compactString(value.requestedCitation, middle),
      relativePath: compactString(value.relativePath, middle),
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

function compactString(value: string, maxLength: number): string {
  const characters = [...value]
  if (characters.length <= maxLength) {
    return value
  }
  if (maxLength <= 3) {
    return ".".repeat(Math.max(0, maxLength))
  }
  return `${characters.slice(0, maxLength - 3).join("")}...`
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

export function fitMcpJsonOutput(
  value: unknown,
  maxBytes: number,
  source: string,
): BoundedJsonOutput {
  const budgetBytes = Math.max(MIN_MCP_OUTPUT_BYTES, Math.floor(maxBytes))
  const fullText = JSON.stringify(value) ?? "null"
  const retrievedBytes = Buffer.byteLength(fullText, "utf8")
  if (retrievedBytes <= budgetBytes) {
    return fittedJsonOutput(source, budgetBytes, fullText, retrievedBytes, false, 0)
  }

  const candidate: unknown = JSON.parse(fullText)
  let omittedItems = 0
  let candidateText = JSON.stringify(candidate) ?? "null"
  while (Buffer.byteLength(candidateText, "utf8") > budgetBytes) {
    const arrays = jsonArrays(candidate).filter((items) => items.length > 0)
    arrays.sort((left, right) => jsonByteLength(right) - jsonByteLength(left))
    const largest = arrays[0]
    if (!largest) {
      break
    }
    const removeCount = Math.max(1, Math.ceil(largest.length / 2))
    largest.splice(largest.length - removeCount, removeCount)
    omittedItems += removeCount
    candidateText = JSON.stringify(candidate) ?? "null"
  }

  while (Buffer.byteLength(candidateText, "utf8") > budgetBytes) {
    const strings = mutableJsonStrings(candidate).filter((field) => field.value.length > 8)
    strings.sort((left, right) => right.value.length - left.value.length)
    const longest = strings[0]
    if (!longest) {
      break
    }
    const characters = [...longest.value]
    const retained = Math.max(0, Math.floor(characters.length / 2) - 3)
    longest.replace(`${characters.slice(0, retained).join("")}...`)
    candidateText = JSON.stringify(candidate) ?? "null"
  }

  if (Buffer.byteLength(candidateText, "utf8") > budgetBytes) {
    candidateText = JSON.stringify({
      truncated: true,
      omittedItems,
      message: "MCP output exceeded the active byte budget.",
    })
  }
  return fittedJsonOutput(source, budgetBytes, candidateText, retrievedBytes, true, omittedItems)
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

function jsonArrays(value: unknown): unknown[][] {
  const arrays: unknown[][] = []
  collectJsonArrays(value, arrays)
  return arrays
}

function collectJsonArrays(value: unknown, arrays: unknown[][]): void {
  if (Array.isArray(value)) {
    arrays.push(value)
    for (const item of value) {
      collectJsonArrays(item, arrays)
    }
    return
  }
  if (isJsonRecord(value)) {
    for (const item of Object.values(value)) {
      collectJsonArrays(item, arrays)
    }
  }
}

interface MutableJsonString {
  value: string
  replace(value: string): void
}

function mutableJsonStrings(value: unknown): MutableJsonString[] {
  const strings: MutableJsonString[] = []
  collectMutableJsonStrings(value, strings)
  return strings
}

function collectMutableJsonStrings(value: unknown, strings: MutableJsonString[]): void {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const item = value[index]
      if (typeof item === "string") {
        strings.push({
          value: item,
          replace(next) {
            value[index] = next
          },
        })
      } else {
        collectMutableJsonStrings(item, strings)
      }
    }
    return
  }
  if (isJsonRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === "string") {
        strings.push({
          value: item,
          replace(next) {
            value[key] = next
          },
        })
      } else {
        collectMutableJsonStrings(item, strings)
      }
    }
  }
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? "null", "utf8")
}
