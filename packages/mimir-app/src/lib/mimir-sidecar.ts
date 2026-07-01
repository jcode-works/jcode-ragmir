import { invoke } from "@tauri-apps/api/core"

export type MimirCommandKind =
  | "doctor"
  | "doctor-fix"
  | "status"
  | "ingest"
  | "search"
  | "ask"
  | "security-audit"
  | "audit-unsupported"
  | "models-pull"
  | "audio-summary"

export interface MimirCommandRequest {
  projectRoot: string
  command: MimirCommandKind
  query?: string
  text?: string
  rebuild?: boolean
  topK?: number
}

interface MimirCommandOutput {
  status: number
  stdout: string
  stderr: string
}

export interface DoctorReport {
  projectRoot: string
  initialized: boolean
  rawDir: string
  storageDir: string
  embeddingProvider: "local-hash" | "transformers"
  transformersAllowRemoteModels: boolean
  redactionEnabled: boolean
  accessLog: boolean
  supportedFiles: number
  skippedFiles: number
  unsupportedFiles: number
  indexedFiles: number
  chunksIndexed: number
  missingFromIndex: number
  staleInIndex: number
  securityWarnings: string[]
  ready: boolean
  nextSteps: string[]
}

export interface IngestResult {
  discoveredFiles: number
  supportedFiles: number
  indexedFiles: number
  rebuiltFiles: number
  reusedFiles: number
  chunks: number
  skippedFiles: number
  unsupportedFiles: number
  oversizedFiles: number
  sensitiveFiles: number
  errors: Array<{ path: string; message: string }>
}

export interface SearchResult {
  source: string
  relativePath: string
  chunkIndex: number
  text: string
  distance: number | null
}

export interface AskResult {
  query: string
  answer: string
  sources: SearchResult[]
}

export interface StatusReport {
  projectRoot: string
  rawDir: string
  storageDir: string
  sourcesFile: string
  accessLogPath: string
  embeddingModelPath: string
  embeddingProvider: "local-hash" | "transformers"
  embeddingModel: string
  transformersAllowRemoteModels: boolean
  redactionEnabled: boolean
  accessLog: boolean
  mcpMaxTopK: number
  topK: number
  chunkSize: number
  chunkOverlap: number
  maxFileBytes: number
  ingestConcurrency: number
  embeddingBatchSize: number
  includeExtensions: string[]
  pdfOcrCommand: string[]
  pdfOcrTimeoutMs: number
  chunksIndexed: number
}

export interface SecurityAuditReport {
  projectRoot: string
  zeroTelemetry: true
  providers: {
    embedding: "local-hash" | "transformers"
    embeddingModel: string
    embeddingModelPath: string
    transformersAllowRemoteModels: boolean
    llmGeneration: false
  }
  redaction: {
    enabled: boolean
    builtIn: boolean
    customPatterns: string[]
  }
  accessLog: {
    enabled: boolean
    path: string
    storesRawQueries: false
  }
  storage: {
    path: string
    gitIgnored: boolean
    encryptedAtRest: "external-required"
  }
  mcp: {
    maxTopK: number
    destructiveToolsExposed: false
  }
  gitignore: {
    legacyKbIgnored: boolean
    mimirIgnored: boolean
    legacyPrivateIgnored: boolean
  }
  recommendations: string[]
  warnings: string[]
}

export interface ModelsPullResult {
  embeddingModel: string
  embeddingModelPath: string
}

export interface AudioRenderResult {
  outputPath: string
  engine: "edge" | "transformers"
  outputFormat: "mp3" | "wav"
  model: string
  modelPath: string
  allowRemoteModels: boolean
  voice: string | null
  rate: string | null
  samplingRate: number | null
  samples: number | null
}

interface SetupResult {
  doctor: DoctorReport
}

export async function runDoctor(projectRoot: string, fix = false): Promise<DoctorReport> {
  if (!fix) {
    return runJsonCommand({ projectRoot, command: "doctor" }, isDoctorReport, "doctor report")
  }

  const result = await runJsonCommand(
    { projectRoot, command: "doctor-fix" },
    isSetupResult,
    "setup result",
  )
  return result.doctor
}

export async function runIngest(projectRoot: string, rebuild = false): Promise<IngestResult> {
  return runJsonCommand(
    { projectRoot, command: "ingest", rebuild },
    isIngestResult,
    "ingest result",
  )
}

export async function runAsk(
  projectRoot: string,
  query: string,
  topK?: number,
): Promise<AskResult> {
  const request: MimirCommandRequest = { projectRoot, command: "ask", query }
  if (topK !== undefined) {
    request.topK = topK
  }
  return runJsonCommand(request, isAskResult, "ask result", { allowNonZero: true })
}

export async function runStatus(projectRoot: string): Promise<StatusReport> {
  return runJsonCommand({ projectRoot, command: "status" }, isStatusReport, "status report")
}

export async function runModelsPull(projectRoot: string): Promise<ModelsPullResult> {
  return runJsonCommand(
    { projectRoot, command: "models-pull" },
    isModelsPullResult,
    "models pull result",
  )
}

export async function runAudioSummary(
  projectRoot: string,
  text: string,
): Promise<AudioRenderResult> {
  return runJsonCommand(
    { projectRoot, command: "audio-summary", text },
    isAudioRenderResult,
    "audio render result",
  )
}

export async function runSecurityAudit(projectRoot: string): Promise<SecurityAuditReport> {
  return runJsonCommand(
    { projectRoot, command: "security-audit" },
    isSecurityAuditReport,
    "security audit",
  )
}

async function runJsonCommand<T>(
  request: MimirCommandRequest,
  guard: (value: unknown) => value is T,
  label: string,
  options: { allowNonZero?: boolean } = {},
): Promise<T> {
  const output = await invoke<unknown>("run_mimir_command", { request })
  if (!isMimirCommandOutput(output)) {
    throw new Error("The native runtime returned an invalid response.")
  }

  if (output.status !== 0 && !options.allowNonZero && output.stdout.trim() === "") {
    const stderr = output.stderr.trim()
    throw new Error(stderr || `Mimir command exited with status ${output.status}.`)
  }

  const parsed = parseJson(output.stdout, label)
  if (!guard(parsed)) {
    throw new Error(`Mimir returned an invalid ${label}.`)
  }
  if (output.status !== 0 && !options.allowNonZero) {
    const stderr = output.stderr.trim()
    throw new Error(stderr || `Mimir command exited with status ${output.status}.`)
  }
  return parsed
}

function parseJson(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    throw new Error(`Mimir did not return valid JSON for ${label}.`)
  }
}

function isMimirCommandOutput(value: unknown): value is MimirCommandOutput {
  return (
    isRecord(value) &&
    typeof value.status === "number" &&
    typeof value.stdout === "string" &&
    typeof value.stderr === "string"
  )
}

function isDoctorReport(value: unknown): value is DoctorReport {
  return (
    isRecord(value) &&
    typeof value.projectRoot === "string" &&
    typeof value.initialized === "boolean" &&
    typeof value.rawDir === "string" &&
    typeof value.storageDir === "string" &&
    isEmbeddingProvider(value.embeddingProvider) &&
    typeof value.transformersAllowRemoteModels === "boolean" &&
    typeof value.redactionEnabled === "boolean" &&
    typeof value.accessLog === "boolean" &&
    typeof value.supportedFiles === "number" &&
    typeof value.skippedFiles === "number" &&
    typeof value.unsupportedFiles === "number" &&
    typeof value.indexedFiles === "number" &&
    typeof value.chunksIndexed === "number" &&
    typeof value.missingFromIndex === "number" &&
    typeof value.staleInIndex === "number" &&
    isStringArray(value.securityWarnings) &&
    typeof value.ready === "boolean" &&
    isStringArray(value.nextSteps)
  )
}

function isSetupResult(value: unknown): value is SetupResult {
  return isRecord(value) && isDoctorReport(value.doctor)
}

function isIngestResult(value: unknown): value is IngestResult {
  return (
    isRecord(value) &&
    typeof value.discoveredFiles === "number" &&
    typeof value.supportedFiles === "number" &&
    typeof value.indexedFiles === "number" &&
    typeof value.rebuiltFiles === "number" &&
    typeof value.reusedFiles === "number" &&
    typeof value.chunks === "number" &&
    typeof value.skippedFiles === "number" &&
    typeof value.unsupportedFiles === "number" &&
    typeof value.oversizedFiles === "number" &&
    typeof value.sensitiveFiles === "number" &&
    Array.isArray(value.errors) &&
    value.errors.every(isCommandError)
  )
}

function isAskResult(value: unknown): value is AskResult {
  return (
    isRecord(value) &&
    typeof value.query === "string" &&
    typeof value.answer === "string" &&
    Array.isArray(value.sources) &&
    value.sources.every(isSearchResult)
  )
}

function isStatusReport(value: unknown): value is StatusReport {
  return (
    isRecord(value) &&
    typeof value.projectRoot === "string" &&
    typeof value.rawDir === "string" &&
    typeof value.storageDir === "string" &&
    typeof value.sourcesFile === "string" &&
    typeof value.accessLogPath === "string" &&
    typeof value.embeddingModelPath === "string" &&
    isEmbeddingProvider(value.embeddingProvider) &&
    typeof value.embeddingModel === "string" &&
    typeof value.transformersAllowRemoteModels === "boolean" &&
    typeof value.redactionEnabled === "boolean" &&
    typeof value.accessLog === "boolean" &&
    typeof value.mcpMaxTopK === "number" &&
    typeof value.topK === "number" &&
    typeof value.chunkSize === "number" &&
    typeof value.chunkOverlap === "number" &&
    typeof value.maxFileBytes === "number" &&
    typeof value.ingestConcurrency === "number" &&
    typeof value.embeddingBatchSize === "number" &&
    isStringArray(value.includeExtensions) &&
    isStringArray(value.pdfOcrCommand) &&
    typeof value.pdfOcrTimeoutMs === "number" &&
    typeof value.chunksIndexed === "number"
  )
}

function isModelsPullResult(value: unknown): value is ModelsPullResult {
  return (
    isRecord(value) &&
    typeof value.embeddingModel === "string" &&
    typeof value.embeddingModelPath === "string"
  )
}

function isAudioRenderResult(value: unknown): value is AudioRenderResult {
  return (
    isRecord(value) &&
    typeof value.outputPath === "string" &&
    (value.engine === "edge" || value.engine === "transformers") &&
    (value.outputFormat === "mp3" || value.outputFormat === "wav") &&
    typeof value.model === "string" &&
    typeof value.modelPath === "string" &&
    typeof value.allowRemoteModels === "boolean" &&
    (typeof value.voice === "string" || value.voice === null) &&
    (typeof value.rate === "string" || value.rate === null) &&
    (typeof value.samplingRate === "number" || value.samplingRate === null) &&
    (typeof value.samples === "number" || value.samples === null)
  )
}

function isSecurityAuditReport(value: unknown): value is SecurityAuditReport {
  return (
    isRecord(value) &&
    typeof value.projectRoot === "string" &&
    value.zeroTelemetry === true &&
    isRecord(value.providers) &&
    isEmbeddingProvider(value.providers.embedding) &&
    typeof value.providers.embeddingModel === "string" &&
    typeof value.providers.embeddingModelPath === "string" &&
    typeof value.providers.transformersAllowRemoteModels === "boolean" &&
    value.providers.llmGeneration === false &&
    isRecord(value.redaction) &&
    typeof value.redaction.enabled === "boolean" &&
    typeof value.redaction.builtIn === "boolean" &&
    isStringArray(value.redaction.customPatterns) &&
    isRecord(value.accessLog) &&
    typeof value.accessLog.enabled === "boolean" &&
    typeof value.accessLog.path === "string" &&
    value.accessLog.storesRawQueries === false &&
    isRecord(value.storage) &&
    typeof value.storage.path === "string" &&
    typeof value.storage.gitIgnored === "boolean" &&
    value.storage.encryptedAtRest === "external-required" &&
    isRecord(value.mcp) &&
    typeof value.mcp.maxTopK === "number" &&
    value.mcp.destructiveToolsExposed === false &&
    isRecord(value.gitignore) &&
    typeof value.gitignore.legacyKbIgnored === "boolean" &&
    typeof value.gitignore.mimirIgnored === "boolean" &&
    typeof value.gitignore.legacyPrivateIgnored === "boolean" &&
    isStringArray(value.recommendations) &&
    isStringArray(value.warnings)
  )
}

function isSearchResult(value: unknown): value is SearchResult {
  return (
    isRecord(value) &&
    typeof value.source === "string" &&
    typeof value.relativePath === "string" &&
    typeof value.chunkIndex === "number" &&
    typeof value.text === "string" &&
    (typeof value.distance === "number" || value.distance === null)
  )
}

function isCommandError(value: unknown): value is { path: string; message: string } {
  return isRecord(value) && typeof value.path === "string" && typeof value.message === "string"
}

function isEmbeddingProvider(value: unknown): value is "local-hash" | "transformers" {
  return value === "local-hash" || value === "transformers"
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
