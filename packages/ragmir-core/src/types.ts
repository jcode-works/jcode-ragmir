import type { PathLike } from "node:fs"
import type { PackageManager } from "./package-manager.js"

export type AgentTarget = "claude" | "codex" | "kimi" | "opencode" | "cline"
export type RagmirRunnerMode = "local-bin" | "workspace" | "installed-package" | "npm-cache"

export interface AgentIntegrationReport {
  runnerPath: string
  runnerReady: boolean
  runnerMode: RagmirRunnerMode | null
  runnerRequiresDownload: boolean
  projectAgents: AgentTarget[]
  userAgents: AgentTarget[]
  nativeAgents: AgentTarget[]
  ready: boolean
  warnings: string[]
}

export interface Config {
  projectRoot: string
  privacyProfile: PrivacyProfile
  retrievalProfile: RetrievalProfile
  acceptedRisks: string[]
  rawDir: string
  storageDir: string
  sourcesFile: string
  sources: string[]
  accessLogPath: string
  embeddingModelPath: string
  tableName: string
  embeddingProvider: EmbeddingProvider
  embeddingModel: string
  embeddingModelRevision: string
  transformersAllowRemoteModels: boolean
  redaction: RedactionConfig
  accessLog: boolean
  mcpMaxTopK: number
  mcpMaxOutputBytes: number
  topK: number
  chunkSize: number
  chunkOverlap: number
  maxFileBytes: number
  ingestConcurrency: number
  embeddingBatchSize: number
  incrementalFailurePolicy: IncrementalFailurePolicy
  hybridTextScanLimit: number
  includeExtensions: string[]
  pdfOcrCommand: string[]
  pdfOcrTimeoutMs: number
  imageOcrCommand: string[]
  imageOcrTimeoutMs: number
  legacyWordCommand: string[]
  legacyWordTimeoutMs: number
}

export type PrivacyProfile = "strict" | "private" | "trusted" | "custom"
export type RetrievalProfile = "fast" | "balanced" | "quality" | "custom"
export type IncrementalFailurePolicy = "preserve-last-good" | "remove-stale"

export type AccessLogAction =
  | "ingest"
  | "search"
  | "ask"
  | "research"
  | "evaluate"
  | "destroy-index"

export interface AccessLogUsageOptions extends OperationOptions {
  cwd?: PathLike
  days?: number
}

export interface AccessLogUsageReport {
  accessLogEnabled: boolean
  since: string
  until: string
  totalEvents: number
  invalidLines: number
  eventsByAction: Record<AccessLogAction, number>
  uniqueQueryHashes: number
  averageResultCount: number | null
  averageResultCountByAction: Record<AccessLogAction, number | null>
  mcpOutput: McpOutputUsageReport
  lastEventAt: string | null
}

export type McpOutputTool = "ragmir_search" | "ragmir_ask" | "ragmir_research" | "ragmir_expand"

export interface McpOutputUsageReport {
  responses: number
  retrievedBytes: number
  returnedBytes: number
  savedBytes: number
  reductionRatio: number | null
  compactedResponses: number
  truncatedResponses: number
}

export interface IngestionLimitsReport {
  maxFileBytes: number
  hardMaxFileBytes: number
  maxFiles: null
  maxCorpusBytes: null
  maxFileBatchSize: number
  maxIngestConcurrency: number
  maxEmbeddingBatchSize: number
  maxSourceWindowBytes: number
  maxChunkWindow: number
  maxChunksPerFile: number
  maxVectorBytesPerFile: number
  maxPdfPages: number
  maxPdfTextCharacters: number
  maxOfficeTextEntries: number
  maxOfficeEntryBytes: number
  maxOfficeTotalTextBytes: number
  maxExternalTextOutputBytes: number
  notes: string[]
}

export type EmbeddingProvider = "local-hash" | "transformers"

/**
 * Manifest written next to the LanceDB table at each ingest. It captures the
 * configuration that produced the indexed vectors so callers can detect a
 * stale index cheaply (without re-scanning every file's checksum) when the
 * embedding model, provider, chunking, or Ragmir schema has changed.
 */
export interface IndexManifest {
  schemaVersion: number
  createdAt: string
  ragmirVersion: string
  embeddingProvider: EmbeddingProvider
  embeddingModel: string
  indexPolicyFingerprint?: string
  vectorDimension?: number
  vectorDistanceMetric?: string
  chunkSize: number
  chunkOverlap: number
  fileCount: number
  chunkCount: number
  tableName?: string
  indexedFiles?: IndexManifestFile[]
  staleFiles?: IndexManifestStaleFile[]
  qualityReport?: IndexQualityReport
}

export interface IndexManifestFile {
  relativePath: string
  checksum: string
  chunkCount: number
  bytes?: number
  mtimeMs?: number
}

export interface IndexManifestStaleFile {
  relativePath: string
  currentChecksum: string
  lastGoodChecksum: string
  chunkCount: number
  error: string
}

export interface RedactionConfig {
  enabled: boolean
  builtIn: boolean
  patterns: RedactionPattern[]
}

export interface RedactionPattern {
  name: string
  pattern: string
  flags?: string | undefined
  replacement?: string | undefined
  /** Optional post-match verification for patterns prone to false positives. */
  verify?: "luhn" | undefined
}

export interface RedactionCount {
  name: string
  count: number
}

export interface SourceFile {
  absolutePath: string
  relativePath: string
  source: string
  extension: string
  bytes: number
  mtimeMs: number
  checksum: string
}

export type SkippedSourceReason = "unsupported-extension" | "oversized" | "sensitive-name"

export interface SkippedSourceFile {
  relativePath: string
  source: string
  extension: string
  bytes: number
  reason: SkippedSourceReason
  recommendation: string
}

export interface SourceInventory {
  discoveredFiles: number
  supportedFiles: SourceFile[]
  skippedFiles: SkippedSourceFile[]
}

export interface ParsedDocument {
  file: SourceFile
  text: string
  pages?: ParsedPage[]
}

export interface ParsedPage {
  pageNumber: number
  charStart: number
  charEnd: number
}

export interface TextChunk {
  id: string
  source: string
  relativePath: string
  chunkIndex: number
  contextPath: string
  text: string
  charStart: number
  charEnd: number
  lineStart: number
  lineEnd: number
  pageStart?: number
  pageEnd?: number
  checksum: string
  bytes: number
  mtimeMs: number
}

export interface ChunkStats {
  count: number
  minChars: number
  averageChars: number
  p50Chars: number
  p95Chars: number
  maxChars: number
  contextualChunks: number
  contextualRatio: number
}

export interface VectorRow extends TextChunk {
  searchText: string
  vector: number[]
  embeddingProvider: EmbeddingProvider
  embeddingModel: string
}

export interface OperationOptions {
  signal?: AbortSignal
  timeoutMs?: number
}

export interface IngestOptions extends OperationOptions {
  cwd?: PathLike
  rebuild?: boolean
  batchSize?: number
  incrementalFailurePolicy?: IncrementalFailurePolicy
  onProgress?: (progress: IngestionProgress) => void | Promise<void>
}

export interface IngestResult {
  runId: string
  resumed: boolean
  batchSize: number
  discoveredFiles: number
  supportedFiles: number
  supportedBytes: number
  largestFileBytes: number
  indexedFiles: number
  rebuiltFiles: number
  reusedFiles: number
  staleLastKnownGood: string[]
  policyRebuild: boolean
  chunks: number
  skippedFiles: number
  unsupportedFiles: number
  oversizedFiles: number
  sensitiveFiles: number
  emptyTextFiles: string[]
  unsupportedExtensions: Array<{ extension: string; count: number }>
  redactions: number
  vectorIndexWarning: string | null
  lexicalIndexWarning: string | null
  errors: Array<{ path: string; message: string }>
}

export type IngestionFileStage = "pending" | "parsed" | "embedded" | "indexed" | "error"

export type IngestionRunMode = "incremental" | "rebuild"

export type IngestionRunStatus =
  | "running"
  | "interrupted"
  | "failed"
  | "completed"
  | "completed_with_errors"

export interface IngestionProgress {
  runId: string
  mode: IngestionRunMode
  status: IngestionRunStatus
  resumed: boolean
  batchSize: number
  totalFiles: number
  pendingFiles: number
  parsedFiles: number
  embeddedFiles: number
  indexedFiles: number
  errorFiles: number
  staleFiles: number
  chunksIndexed: number
  lastActivityAt: string
}

export interface PreviewChunksOptions {
  cwd?: PathLike
  paths?: string[]
  maxFiles?: number
  maxChunksPerFile?: number
}

export interface PreviewChunk {
  chunkIndex: number
  contextPath: string
  citation: string
  text: string
  charStart: number
  charEnd: number
  lineStart: number
  lineEnd: number
  pageStart: number | null
  pageEnd: number | null
}

export interface PreviewFile {
  source: string
  relativePath: string
  extension: string
  bytes: number
  parsedChars: number
  redactions: number
  chunkStats: ChunkStats
  chunks: PreviewChunk[]
  omittedChunks: number
}

export interface PreviewReport {
  chunkSize: number
  chunkOverlap: number
  requestedPaths: string[]
  unmatchedPaths: string[]
  matchedFiles: number
  omittedFiles: number
  files: PreviewFile[]
  errors: Array<{ path: string; message: string }>
}

export interface KnowledgeBaseIdentity {
  id: string
  projectRoot: string
  workspaceRoot: string
}

export interface KnowledgeBaseInfo {
  id: string
  projectRoot: string
  configPath: string
  legacy: boolean
  active: boolean
}

export interface KnowledgeBaseInventory {
  start: string
  workspaceRoot: string
  activeProjectRoot: string | null
  activeId: string | null
  bases: KnowledgeBaseInfo[]
}

export interface KnowledgeBaseContextReport {
  knowledgeBaseId: string | null
  projectRoot: string
  privacyProfile: PrivacyProfile
  retrievalProfile: RetrievalProfile
  embeddingProvider: EmbeddingProvider
  ready: boolean
  coverage: {
    supportedFiles: number
    indexedFiles: number
    chunksIndexed: number
    missingFromIndex: number
    staleInIndex: number
    emptyTextFiles: number
  }
  indexFreshness: DoctorReport["indexFreshness"]
  securityWarningCount: number
  nextSteps: string[]
  routing: {
    selection: "nearest-configured-ancestor"
    discoverCommand: "rgr bases --json"
  }
  tools: string[]
  resources: string[]
}

export interface KnowledgeBaseSourceCatalog {
  knowledgeBaseId: string | null
  totals: {
    indexedFiles: number
    chunks: number
    missingFromIndex: number
    staleInIndex: number
    emptyTextFiles: number
    skippedFiles: number
  }
  indexedFiles: Array<{ source: string; chunks: number }>
  missingFromIndex: string[]
  staleInIndex: string[]
  emptyTextFiles: string[]
  skippedByReason: Record<string, number>
  omitted: {
    indexedFiles: number
    missingFromIndex: number
    staleInIndex: number
    emptyTextFiles: number
  }
}

export interface SearchOptions extends OperationOptions {
  cwd?: PathLike
  topK?: number
  contextRadius?: number
  includePaths?: string[]
  excludePaths?: string[]
  contextPaths?: string[]
  explain?: boolean
}

export interface SearchContextChunk {
  chunkIndex: number
  contextPath: string
  text: string
  charStart: number | null
  charEnd: number | null
  lineStart: number | null
  lineEnd: number | null
  pageStart: number | null
  pageEnd: number | null
  citation: string
}

export interface SearchResult {
  source: string
  relativePath: string
  chunkIndex: number
  contextPath: string
  citation: string
  text: string
  distance: number | null
  charStart: number | null
  charEnd: number | null
  lineStart: number | null
  lineEnd: number | null
  pageStart: number | null
  pageEnd: number | null
  context: SearchContextChunk[]
  score?: SearchScoreExplanation
}

export interface SearchScoreExplanation {
  fusion: "rrf"
  combinedScore: number
  vectorContribution: number
  lexicalContribution: number
  vectorRank: number | null
  lexicalRank: number | null
  vectorDistance: number | null
  lexicalBackendScore: number | null
  matchedTerms: string[]
}

export interface ExpandCitationOptions extends OperationOptions {
  cwd?: PathLike
  contextRadius?: number
}

export interface ExpandedCitation {
  requestedCitation: string
  found: boolean
  relativePath: string
  chunkIndex: number
  contextRadius: number
  passages: SearchContextChunk[]
}

export interface CompactSearchResult {
  source: string
  relativePath: string
  chunkIndex: number
  contextPath: string
  citation: string
  snippet: string
  distance: number | null
  lineStart: number | null
  lineEnd: number | null
  pageStart: number | null
  pageEnd: number | null
  score?: SearchScoreExplanation
}

export interface SourceDuplicateCandidate {
  key: string
  files: string[]
}

export interface SourcePathCandidate {
  relativePath: string
  reason: string
}

export interface SourceDiagnostics {
  duplicateCandidates: SourceDuplicateCandidate[]
  archiveCandidates: SourcePathCandidate[]
  mirrorCandidates: SourcePathCandidate[]
}

export interface ResearchOptions extends OperationOptions {
  cwd?: PathLike
  topK?: number
  includeCode?: boolean
  includePaths?: string[]
  excludePaths?: string[]
  contextPaths?: string[]
}

export interface ResearchEvidence {
  source: string
  relativePath: string
  chunkIndex: number
  contextPath: string
  citation: string
  text: string
  distance: number | null
  lineStart: number | null
  lineEnd: number | null
  pageStart: number | null
  pageEnd: number | null
  queries: string[]
}

export interface CodeEvidence {
  relativePath: string
  lineNumber: number
  snippet: string
  matchedTerms: string[]
}

export interface ResearchReport {
  query: string
  generatedQueries: string[]
  ready: boolean
  audit: {
    supportedFiles: number
    supportedBytes: number
    largestFileBytes: number
    skippedFiles: number
    unsupportedFiles: number
    oversizedFiles: number
    indexedFiles: number
    totalChunks: number
    missingFromIndex: number
    staleInIndex: number
    emptyTextFiles: number
  }
  securityWarnings: string[]
  sourceDiagnostics: SourceDiagnostics
  evidence: ResearchEvidence[]
  codeEvidence: CodeEvidence[]
  gaps: string[]
  nextSteps: string[]
}

export interface GoldenQuery {
  id?: string
  query: string
  expectedPaths: string[]
  expectedCitations?: string[]
  answerable?: boolean
  category?: string
  locale?: string
  relevanceJudgments?: RelevanceJudgment[]
  maximumVectorDistance?: number
  includePaths?: string[]
  excludePaths?: string[]
  contextPaths?: string[]
  topK?: number
}

export interface RelevanceJudgment {
  kind: "path" | "citation"
  value: string
  relevance: 0 | 1 | 2 | 3
}

export interface QualityMetricThresholds {
  recallAt1?: number
  recallAt3?: number
  recallAt5?: number
  recallAt10?: number
  precisionAt5?: number
  meanReciprocalRankAt10?: number
  ndcgAt10?: number
  exactCitationRate?: number
  maximumFalsePositiveRate?: number
}

export interface QualityGateResult {
  metric: keyof QualityMetricThresholds
  direction: "minimum" | "maximum"
  threshold: number
  actual: number | null
  passed: boolean
  applicable: boolean
}

export interface EvaluationGroupResult {
  total: number
  answerable: number
  unanswerable: number
  recallAt10: number
  precisionAt5: number
  meanReciprocalRankAt10: number
  ndcgAt10: number
  falsePositiveRate: number
}

export interface EvaluationOptions extends OperationOptions {
  cwd?: PathLike
  goldenPath: PathLike
  topK?: number
  maxTopK?: number
  thresholds?: QualityMetricThresholds
  persistCompatibleReport?: boolean
}

export interface EvaluationCaseResult {
  id?: string
  query: string
  expectedPaths: string[]
  includePaths?: string[]
  excludePaths?: string[]
  contextPaths?: string[]
  topK: number
  returnedPaths: string[]
  returnedCitations: string[]
  matchedPaths: string[]
  matchedCitations: string[]
  expectedCitations?: string[]
  answerable: boolean
  category?: string
  locale?: string
  relevanceJudgments: RelevanceJudgment[]
  abstained: boolean
  falsePositive: boolean
  pathHit: boolean
  exactCitationHit: boolean | null
  hit: boolean
  bestRank: number | null
  reciprocalRank: number
  recall: number
  precision: number
  ndcg: number
  recallAt: Record<1 | 3 | 5 | 10, number>
  precisionAt5: number
  reciprocalRankAt10: number
  ndcgAt10: number
  latencyMs: number
}

export interface EvaluationResult {
  goldenPath: string
  embeddingProvider: EmbeddingProvider
  embeddingModel: string
  embeddingModelRevision: string
  retrievalProfile: RetrievalProfile
  indexFingerprint: string
  goldenFingerprint: string
  topK: number
  total: number
  hits: number
  misses: number
  hitRate: number
  recall: number
  precision: number
  meanReciprocalRank: number
  ndcg: number
  recallAt: Record<1 | 3 | 5 | 10, number>
  precisionAt5: number
  meanReciprocalRankAt10: number
  ndcgAt10: number
  exactCitationRate: number | null
  falsePositiveRate: number | null
  abstentionAccuracy: number | null
  thresholds: QualityMetricThresholds
  gates: QualityGateResult[]
  passed: boolean
  verificationEligible: boolean
  reportStored: boolean
  qualityReportFingerprint: string | null
  groups: {
    categories: Record<string, EvaluationGroupResult>
    locales: Record<string, EvaluationGroupResult>
  }
  p50LatencyMs: number
  p95LatencyMs: number
  cases: EvaluationCaseResult[]
}

export interface IndexQualityReport {
  schemaVersion: 1
  createdAt: string
  goldenPath: string
  goldenFingerprint: string
  indexFingerprint: string
  indexPolicyFingerprint: string
  embeddingProvider: EmbeddingProvider
  embeddingModel: string
  embeddingModelRevision: string
  retrievalProfile: RetrievalProfile
  total: number
  metrics: {
    recallAt1: number
    recallAt3: number
    recallAt5: number
    recallAt10: number
    precisionAt5: number
    meanReciprocalRankAt10: number
    ndcgAt10: number
    exactCitationRate: number
    falsePositiveRate: number
  }
  thresholds: Required<QualityMetricThresholds>
  passed: true
  verificationEligible: true
  qualityReportFingerprint: string
}

export interface AskResult {
  answer: string
  sources: SearchResult[]
  staleWarning: string | null
}

export interface AuditReport {
  discoveredFiles: number
  supportedBytes: number
  largestFileBytes: number
  indexedFiles: Array<{ source: string; chunks: number }>
  supportedFiles: string[]
  skippedFiles: SkippedSourceFile[]
  emptyTextFiles: string[]
  unsupportedExtensions: Array<{ extension: string; count: number }>
  sourceDiagnostics: SourceDiagnostics
  missingFromIndex: string[]
  staleInIndex: string[]
  totalChunks: number
  chunkStats: ChunkStats
}

export interface DestroyIndexResult {
  storageDir: string
  removed: boolean
  note: string
}

export interface DoctorReport {
  projectRoot: string
  initialized: boolean
  packageManager: PackageManager
  runCommand: string
  agentKitInstalled: boolean
  agentIntegration: AgentIntegrationReport
  rawDir: string
  storageDir: string
  embeddingProvider: EmbeddingProvider
  transformersAllowRemoteModels: boolean
  redactionEnabled: boolean
  accessLog: boolean
  privacyProfile: PrivacyProfile
  retrievalProfile: RetrievalProfile
  supportedFiles: number
  supportedBytes: number
  largestFileBytes: number
  maxFileBytes: number
  skippedFiles: number
  unsupportedFiles: number
  oversizedFiles: number
  sensitiveFiles: number
  emptyTextFiles: number
  indexedFiles: number
  chunksIndexed: number
  missingFromIndex: number
  staleInIndex: number
  securityWarnings: string[]
  indexFreshness: {
    manifestFound: boolean
    warning: string | null
  }
  ready: boolean
  readiness: {
    operationalReady: boolean
    coverageComplete: boolean
    indexPolicyCurrent: boolean
    privacyCompliant: boolean
    retrievalQualityVerified: boolean
    acceptedRisks: string[]
  }
  nextSteps: string[]
}

export interface SecurityAuditReport {
  projectRoot: string
  zeroTelemetry: true
  privacyProfile: PrivacyProfile
  retrievalProfile: RetrievalProfile
  providers: {
    embedding: EmbeddingProvider
    embeddingModel: string
    embeddingModelRevision: string
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
  permissions: {
    checked: boolean
    configPrivate: boolean | null
    rawDirPrivate: boolean | null
    storageDirPrivate: boolean | null
    accessLogPrivate: boolean | null
  }
  mcp: {
    maxTopK: number
    maxOutputBytes: number
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
