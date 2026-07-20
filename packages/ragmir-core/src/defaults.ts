import type { Config } from "./types.js"

export const RAGMIR_DIR = ".ragmir"
export const LEGACY_KB_DIR = ".kb"
export const LEGACY_PRIVATE_DIR = "private"
export const RAGMIR_RAW_DIR = `${RAGMIR_DIR}/raw`
export const CONFIG_PATH = `${RAGMIR_DIR}/config.json`
export const LEGACY_CONFIG_PATH = `${LEGACY_KB_DIR}/config.json`
export const DEFAULT_SKILL_TARGET_DIR = `${RAGMIR_DIR}/skills`
export const INDEX_MANIFEST_FILENAME = "index-manifest.json"

export const RAGMIR_PROJECT_ROOT_ENV = "RAGMIR_PROJECT_ROOT"
export const RAGMIR_PORTABLE_READ_ONLY_ENV = "RAGMIR_PORTABLE_READ_ONLY"
export const VECTOR_DISTANCE_METRIC = "l2"

export const MAX_CONFIGURED_FILE_BYTES = 50_000_000
export const MAX_INGEST_CONCURRENCY = 8
export const MAX_EMBEDDING_BATCH_SIZE = 128
export const MAX_INGEST_FILE_BATCH_SIZE = 128
export const MAX_INGEST_SOURCE_WINDOW_BYTES = 50_000_000
export const MAX_INGEST_CHUNK_WINDOW = 8_192
export const MAX_INGEST_CHUNKS_PER_FILE = 65_536
export const MAX_INGEST_VECTOR_BYTES_PER_FILE = 256 * 1_024 * 1_024
export const MAX_SEARCH_TOP_K = 100
export const MAX_HYBRID_TEXT_SCAN_LIMIT = 10_000
export const MAX_CONFIG_ARRAY_ITEMS = 10_000
export const MAX_CONFIG_PATH_CHARACTERS = 4_096
export const MAX_CONFIG_TEXT_CHARACTERS = 2_048
export const MAX_EXTERNAL_COMMAND_ARGUMENTS = 128
export const MAX_EXTERNAL_COMMAND_TIMEOUT_MS = 900_000
export const MAX_INCLUDE_EXTENSIONS = 128
export const MAX_MCP_OUTPUT_BYTES = 1_048_576
export const MAX_REDACTION_PATTERNS = 64
export const MAX_REDACTION_PATTERN_CHARACTERS = 2_048
export const MAX_CHUNK_SIZE = 1_000_000
export const MAX_WORKLOAD_CONCURRENCY = 16
export const MAX_WORKLOAD_QUEUE = 1_000
export const MAX_WORKLOAD_QUEUE_TIMEOUT_MS = 900_000
export const DEFAULT_EMBEDDING_MODEL = "intfloat/multilingual-e5-small"
export const DEFAULT_EMBEDDING_MODEL_REVISION = "614241f622f53c4eeff9890bdc4f31cfecc418b3"
export const KNOWN_EMBEDDING_MODEL_REVISIONS: Readonly<Record<string, string>> = {
  [DEFAULT_EMBEDDING_MODEL]: DEFAULT_EMBEDDING_MODEL_REVISION,
  "mixedbread-ai/mxbai-embed-xsmall-v1": "e6ac24e5d6efb8782b59de1647b3ececb4ece94e",
}

export function defaultEmbeddingModelRevision(model: string): string {
  return KNOWN_EMBEDDING_MODEL_REVISIONS[model] ?? "main"
}

export const RAGMIR_GITIGNORE_ENTRY = `${RAGMIR_DIR}/`
export const LEGACY_KB_GITIGNORE_ENTRY = `${LEGACY_KB_DIR}/`
export const LEGACY_PRIVATE_GITIGNORE_ENTRY = `${LEGACY_PRIVATE_DIR}/`
export const LEGACY_PRIVATE_GITIGNORE_FALLBACK_ENTRY = `${LEGACY_PRIVATE_DIR}/**`

export const DEFAULT_CONFIG: Omit<Config, "projectRoot"> = {
  privacyProfile: "private",
  retrievalProfile: "balanced",
  acceptedRisks: [],
  rawDir: RAGMIR_RAW_DIR,
  storageDir: `${RAGMIR_DIR}/storage`,
  sourcesFile: `${RAGMIR_DIR}/sources.txt`,
  sources: [],
  accessLogPath: `${RAGMIR_DIR}/access.log`,
  embeddingModelPath: `${RAGMIR_DIR}/models`,
  tableName: "chunks",
  embeddingProvider: "local-hash",
  embeddingModel: DEFAULT_EMBEDDING_MODEL,
  embeddingModelRevision: DEFAULT_EMBEDDING_MODEL_REVISION,
  embeddingModelDigest: null,
  transformersAllowRemoteModels: false,
  redaction: {
    enabled: true,
    builtIn: true,
    patterns: [],
  },
  accessLog: true,
  mcpMaxTopK: 10,
  mcpMaxOutputBytes: 32_768,
  topK: 8,
  chunkSize: 1200,
  chunkOverlap: 200,
  maxFileBytes: 50_000_000,
  ingestConcurrency: 4,
  embeddingBatchSize: 32,
  sourceFingerprintMode: "fast",
  incrementalFailurePolicy: "preserve-last-good",
  hybridTextScanLimit: 5_000,
  workloadLimits: {
    search: { concurrency: 8, maxQueue: 64, queueTimeoutMs: 30_000 },
    embedding: { concurrency: 1, maxQueue: 64, queueTimeoutMs: 30_000 },
    ingestion: { concurrency: 1, maxQueue: 4, queueTimeoutMs: 120_000 },
  },
  includeExtensions: [],
  pdfOcrCommand: [],
  pdfOcrTimeoutMs: 120_000,
  imageOcrCommand: [],
  imageOcrTimeoutMs: 120_000,
  legacyWordCommand: [],
  legacyWordTimeoutMs: 120_000,
}

export const LEGACY_DEFAULT_CONFIG: Omit<Config, "projectRoot"> = {
  ...DEFAULT_CONFIG,
  rawDir: LEGACY_PRIVATE_DIR,
  storageDir: `${LEGACY_KB_DIR}/storage`,
  sourcesFile: `${LEGACY_KB_DIR}/sources.txt`,
  accessLogPath: `${LEGACY_KB_DIR}/access.log`,
}
