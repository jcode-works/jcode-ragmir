import type { PathLike } from "node:fs"
import type { PackageManager } from "./package-manager.js"

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
  topK: number
  chunkSize: number
  chunkOverlap: number
  maxFileBytes: number
  ingestConcurrency: number
  embeddingBatchSize: number
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

export type AccessLogAction =
  | "ingest"
  | "search"
  | "ask"
  | "research"
  | "evaluate"
  | "destroy-index"

export interface AccessLogUsageOptions {
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
  lastEventAt: string | null
}

export interface IngestionLimitsReport {
  maxFileBytes: number
  maxFiles: null
  maxCorpusBytes: null
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
  indexedFiles?: IndexManifestFile[]
}

export interface IndexManifestFile {
  relativePath: string
  checksum: string
  chunkCount: number
  bytes?: number
  mtimeMs?: number
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

export interface VectorRow extends TextChunk {
  vector: number[]
  embeddingProvider: EmbeddingProvider
  embeddingModel: string
}

export interface IngestOptions {
  cwd?: PathLike
  rebuild?: boolean
}

export interface IngestResult {
  discoveredFiles: number
  supportedFiles: number
  supportedBytes: number
  largestFileBytes: number
  indexedFiles: number
  rebuiltFiles: number
  reusedFiles: number
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

export interface SearchOptions {
  cwd?: PathLike
  topK?: number
  contextRadius?: number
  includePaths?: string[]
  excludePaths?: string[]
}

export interface SearchContextChunk {
  chunkIndex: number
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
}

export interface CompactSearchResult {
  source: string
  relativePath: string
  chunkIndex: number
  citation: string
  snippet: string
  distance: number | null
  lineStart: number | null
  lineEnd: number | null
  pageStart: number | null
  pageEnd: number | null
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

export interface ResearchOptions {
  cwd?: PathLike
  topK?: number
  includeCode?: boolean
  includePaths?: string[]
  excludePaths?: string[]
}

export interface ResearchEvidence {
  source: string
  relativePath: string
  chunkIndex: number
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
  includePaths?: string[]
  excludePaths?: string[]
  topK?: number
}

export interface EvaluationOptions {
  cwd?: PathLike
  goldenPath: PathLike
  topK?: number
  maxTopK?: number
}

export interface EvaluationCaseResult {
  id?: string
  query: string
  expectedPaths: string[]
  includePaths?: string[]
  excludePaths?: string[]
  topK: number
  returnedPaths: string[]
  returnedCitations: string[]
  matchedPaths: string[]
  matchedCitations: string[]
  expectedCitations?: string[]
  hit: boolean
  bestRank: number | null
  reciprocalRank: number
  recall: number
  precision: number
  ndcg: number
  latencyMs: number
}

export interface EvaluationResult {
  goldenPath: string
  embeddingProvider: EmbeddingProvider
  embeddingModel: string
  topK: number
  total: number
  hits: number
  misses: number
  hitRate: number
  recall: number
  precision: number
  meanReciprocalRank: number
  ndcg: number
  p50LatencyMs: number
  p95LatencyMs: number
  cases: EvaluationCaseResult[]
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
