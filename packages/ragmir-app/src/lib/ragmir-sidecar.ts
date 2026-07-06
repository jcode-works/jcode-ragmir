import { invoke } from "@tauri-apps/api/core"

export type RagmirCommandKind =
  | "doctor"
  | "doctor-fix"
  | "status"
  | "ingest"
  | "search"
  | "ask"
  | "security-audit"
  | "audit-unsupported"
  | "models-pull"
  | "audio-doctor"
  | "audio-preload"
  | "audio-summary"
  | "chat"
  | "chat-setup"
  | "chat-doctor"

export interface RagmirCommandRequest {
  projectRoot: string
  command: RagmirCommandKind
  query?: string
  text?: string
  rebuild?: boolean
  topK?: number
}

interface RagmirCommandOutput {
  status: number
  stdout: string
  stderr: string
}

export interface RagmirConfigFile {
  exists: boolean
  configPath: string
  content: string
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

export interface ChatResult {
  query: string
  question: string
  answer: string
  sources: SearchResult[]
  model: string
  modelPath: string
  allowRemoteModels: boolean
  maxNewTokens: number
  contextCharLimit: number
  emptyContext: boolean
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
    ragmirIgnored: boolean
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
  language: "en" | "es" | "fr"
  outputFormat: "mp3" | "wav"
  model: string
  modelPath: string
  allowRemoteModels: boolean
  voice: string | null
  rate: string | null
  samplingRate: number | null
  samples: number | null
}

export interface AudioDoctorReport {
  node: string
  defaultEngine: "auto" | "edge" | "transformers"
  defaultLanguage: "en" | "es" | "fr"
  languages: Array<"en" | "es" | "fr">
  defaultModel: string
  defaultModelPath: string
  defaultAllowRemoteModels: boolean
  transformersAvailable: boolean
  edgeTtsAvailable: boolean
  edgeDefaultVoice: string
  pythonRequired: false
  ffmpegRequired: false
  outputFormat: "mp3-or-wav"
}

export interface ChatSetupResult {
  model: string
  modelPath: string
  allowRemoteModels: boolean
  dtype: string
  ready: true
}

export interface ChatDoctorReport {
  node: string
  provider: "transformers"
  defaultModel: string
  defaultModelPath: string
  defaultAllowRemoteModels: boolean
  defaultSetupAllowsRemoteModels: boolean
  defaultMaxNewTokens: number
  defaultContextCharLimit: number
  defaultDtype: string
  transformersAvailable: boolean
  localModelPathExists: boolean
  ollamaRequired: false
  pythonRequired: false
  storesRawPrompts: false
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
  const request: RagmirCommandRequest = { projectRoot, command: "ask", query }
  if (topK !== undefined) {
    request.topK = topK
  }
  return runJsonCommand(request, isAskResult, "ask result", { allowNonZero: true })
}

export async function runChat(
  projectRoot: string,
  query: string,
  topK?: number,
): Promise<ChatResult> {
  const request: RagmirCommandRequest = { projectRoot, command: "chat", query }
  if (topK !== undefined) {
    request.topK = topK
  }
  return runJsonCommand(request, isChatResult, "chat result", { allowNonZero: true })
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

export async function runChatSetup(projectRoot: string): Promise<ChatSetupResult> {
  return runJsonCommand(
    { projectRoot, command: "chat-setup" },
    isChatSetupResult,
    "chat setup result",
  )
}

export async function runChatDoctor(projectRoot: string): Promise<ChatDoctorReport> {
  return runJsonCommand(
    { projectRoot, command: "chat-doctor" },
    isChatDoctorReport,
    "chat doctor report",
  )
}

export async function runAudioDoctor(projectRoot: string): Promise<AudioDoctorReport> {
  return runJsonCommand(
    { projectRoot, command: "audio-doctor" },
    isAudioDoctorReport,
    "audio doctor report",
  )
}

export async function runAudioPreload(projectRoot: string): Promise<AudioRenderResult> {
  return runJsonCommand(
    {
      projectRoot,
      command: "audio-preload",
      text: "Ragmir offline audio model preload.",
    },
    isAudioRenderResult,
    "audio preload result",
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

export async function readRagmirConfig(projectRoot: string): Promise<RagmirConfigFile> {
  const output = await invoke<unknown>("read_ragmir_config", {
    request: { projectRoot },
  })
  if (!isRagmirConfigFile(output)) {
    throw new Error("The native runtime returned an invalid config file response.")
  }
  return output
}

export async function writeRagmirConfig(
  projectRoot: string,
  content: string,
): Promise<RagmirConfigFile> {
  const output = await invoke<unknown>("write_ragmir_config", {
    request: { projectRoot, content },
  })
  if (!isRagmirConfigFile(output)) {
    throw new Error("The native runtime returned an invalid config file response.")
  }
  return output
}

async function runJsonCommand<T>(
  request: RagmirCommandRequest,
  guard: (value: unknown) => value is T,
  label: string,
  options: { allowNonZero?: boolean } = {},
): Promise<T> {
  const output = await invoke<unknown>("run_ragmir_command", { request })
  if (!isRagmirCommandOutput(output)) {
    throw new Error("The native runtime returned an invalid response.")
  }

  if (output.status !== 0 && output.stdout.trim() === "") {
    const stderr = output.stderr.trim()
    throw new Error(stderr || `Ragmir command exited with status ${output.status}.`)
  }

  const parsed = parseJson(output.stdout, label)
  if (!guard(parsed)) {
    throw new Error(`Ragmir returned an invalid ${label}.`)
  }
  if (output.status !== 0 && !options.allowNonZero) {
    const stderr = output.stderr.trim()
    throw new Error(stderr || `Ragmir command exited with status ${output.status}.`)
  }
  return parsed
}

function parseJson(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    throw new Error(`Ragmir did not return valid JSON for ${label}.`)
  }
}

function isRagmirCommandOutput(value: unknown): value is RagmirCommandOutput {
  return (
    isRecord(value) &&
    typeof value.status === "number" &&
    typeof value.stdout === "string" &&
    typeof value.stderr === "string"
  )
}

function isRagmirConfigFile(value: unknown): value is RagmirConfigFile {
  return (
    isRecord(value) &&
    typeof value.exists === "boolean" &&
    typeof value.configPath === "string" &&
    typeof value.content === "string"
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

function isChatResult(value: unknown): value is ChatResult {
  return (
    isRecord(value) &&
    typeof value.query === "string" &&
    typeof value.question === "string" &&
    typeof value.answer === "string" &&
    Array.isArray(value.sources) &&
    value.sources.every(isSearchResult) &&
    typeof value.model === "string" &&
    typeof value.modelPath === "string" &&
    typeof value.allowRemoteModels === "boolean" &&
    typeof value.maxNewTokens === "number" &&
    typeof value.contextCharLimit === "number" &&
    typeof value.emptyContext === "boolean"
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
    isAudioLanguage(value.language) &&
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

function isAudioDoctorReport(value: unknown): value is AudioDoctorReport {
  return (
    isRecord(value) &&
    typeof value.node === "string" &&
    (value.defaultEngine === "auto" ||
      value.defaultEngine === "edge" ||
      value.defaultEngine === "transformers") &&
    isAudioLanguage(value.defaultLanguage) &&
    Array.isArray(value.languages) &&
    value.languages.every(isAudioLanguage) &&
    typeof value.defaultModel === "string" &&
    typeof value.defaultModelPath === "string" &&
    typeof value.defaultAllowRemoteModels === "boolean" &&
    typeof value.transformersAvailable === "boolean" &&
    typeof value.edgeTtsAvailable === "boolean" &&
    typeof value.edgeDefaultVoice === "string" &&
    value.pythonRequired === false &&
    value.ffmpegRequired === false &&
    value.outputFormat === "mp3-or-wav"
  )
}

function isChatSetupResult(value: unknown): value is ChatSetupResult {
  return (
    isRecord(value) &&
    typeof value.model === "string" &&
    typeof value.modelPath === "string" &&
    typeof value.allowRemoteModels === "boolean" &&
    typeof value.dtype === "string" &&
    value.ready === true
  )
}

function isChatDoctorReport(value: unknown): value is ChatDoctorReport {
  return (
    isRecord(value) &&
    typeof value.node === "string" &&
    value.provider === "transformers" &&
    typeof value.defaultModel === "string" &&
    typeof value.defaultModelPath === "string" &&
    typeof value.defaultAllowRemoteModels === "boolean" &&
    typeof value.defaultSetupAllowsRemoteModels === "boolean" &&
    typeof value.defaultMaxNewTokens === "number" &&
    typeof value.defaultContextCharLimit === "number" &&
    typeof value.defaultDtype === "string" &&
    typeof value.transformersAvailable === "boolean" &&
    typeof value.localModelPathExists === "boolean" &&
    value.ollamaRequired === false &&
    value.pythonRequired === false &&
    value.storesRawPrompts === false
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
    typeof value.gitignore.ragmirIgnored === "boolean" &&
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

function isAudioLanguage(value: unknown): value is "en" | "es" | "fr" {
  return value === "en" || value === "es" || value === "fr"
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
