import type { PathLike } from "node:fs"
import type { PackageManager } from "./package-manager.js"

export interface Config {
  projectRoot: string
  rawDir: string
  storageDir: string
  sourcesFile: string
  accessLogPath: string
  embeddingModelPath: string
  tableName: string
  embeddingProvider: EmbeddingProvider
  embeddingModel: string
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
  includeExtensions: string[]
  pdfOcrCommand: string[]
  pdfOcrTimeoutMs: number
  imageOcrCommand: string[]
  imageOcrTimeoutMs: number
  legacyWordCommand: string[]
  legacyWordTimeoutMs: number
}

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
  lastEventAt: string | null
}

export type EmbeddingProvider = "local-hash" | "transformers"

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
}

export interface TextChunk {
  id: string
  source: string
  relativePath: string
  chunkIndex: number
  text: string
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
  indexedFiles: number
  rebuiltFiles: number
  reusedFiles: number
  chunks: number
  skippedFiles: number
  unsupportedFiles: number
  oversizedFiles: number
  sensitiveFiles: number
  emptyTextFiles: string[]
  unsupportedExtensions: Array<{ extension: string; count: number }>
  redactions: number
  errors: Array<{ path: string; message: string }>
}

export interface SearchOptions {
  cwd?: PathLike
  topK?: number
}

export interface SearchResult {
  source: string
  relativePath: string
  chunkIndex: number
  text: string
  distance: number | null
}

export interface CompactSearchResult {
  source: string
  relativePath: string
  chunkIndex: number
  snippet: string
  distance: number | null
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
}

export interface ResearchEvidence {
  source: string
  relativePath: string
  chunkIndex: number
  text: string
  distance: number | null
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
    skippedFiles: number
    unsupportedFiles: number
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
  topK: number
  returnedPaths: string[]
  matchedPaths: string[]
  hit: boolean
  bestRank: number | null
}

export interface EvaluationResult {
  goldenPath: string
  embeddingProvider: EmbeddingProvider
  embeddingModel: string
  topK: number
  total: number
  hits: number
  misses: number
  recall: number
  cases: EvaluationCaseResult[]
}

export interface AskResult {
  answer: string
  sources: SearchResult[]
}

export interface AuditReport {
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

export interface SecurityAuditReport {
  projectRoot: string
  zeroTelemetry: true
  providers: {
    embedding: EmbeddingProvider
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
