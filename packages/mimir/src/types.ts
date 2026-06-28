import type { PathLike } from "node:fs"

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
  includeExtensions: string[]
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
}

export interface IngestOptions {
  cwd?: PathLike
  rebuild?: boolean
}

export interface IngestResult {
  indexedFiles: number
  chunks: number
  skippedFiles: number
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

export interface AskResult {
  answer: string
  sources: SearchResult[]
}

export interface AuditReport {
  indexedFiles: Array<{ source: string; chunks: number }>
  supportedFiles: string[]
  missingFromIndex: string[]
  staleInIndex: string[]
  totalChunks: number
}

export interface DestroyIndexResult {
  storageDir: string
  removed: boolean
  note: string
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
    kbIgnored: boolean
    mimirIgnored: boolean
    privateIgnored: boolean
  }
  recommendations: string[]
  warnings: string[]
}
