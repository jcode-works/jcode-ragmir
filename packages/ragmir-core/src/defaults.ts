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
export const VECTOR_DISTANCE_METRIC = "l2"

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
  embeddingModel: "intfloat/multilingual-e5-small",
  embeddingModelRevision: "main",
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
  hybridTextScanLimit: 5_000,
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
