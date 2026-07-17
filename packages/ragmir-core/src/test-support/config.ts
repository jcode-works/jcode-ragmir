import path from "node:path"
import { DEFAULT_CONFIG } from "../defaults.js"
import type { Config } from "../types.js"

export function testConfig(overrides?: Partial<Config>): Config
export function testConfig(projectRoot: string, overrides?: Partial<Config>): Config
export function testConfig(
  projectRootOrOverrides: string | Partial<Config> = "/tmp/ragmir",
  overrides: Partial<Config> = {},
): Config {
  const projectRoot =
    typeof projectRootOrOverrides === "string" ? projectRootOrOverrides : "/tmp/ragmir"
  const configOverrides =
    typeof projectRootOrOverrides === "string" ? overrides : projectRootOrOverrides

  const config: Config = {
    projectRoot,
    privacyProfile: DEFAULT_CONFIG.privacyProfile,
    retrievalProfile: DEFAULT_CONFIG.retrievalProfile,
    acceptedRisks: [...DEFAULT_CONFIG.acceptedRisks],
    rawDir: path.join(projectRoot, DEFAULT_CONFIG.rawDir),
    storageDir: path.join(projectRoot, DEFAULT_CONFIG.storageDir),
    sourcesFile: path.join(projectRoot, DEFAULT_CONFIG.sourcesFile),
    sources: [...DEFAULT_CONFIG.sources],
    accessLogPath: path.join(projectRoot, DEFAULT_CONFIG.accessLogPath),
    embeddingModelPath: path.join(projectRoot, DEFAULT_CONFIG.embeddingModelPath),
    tableName: DEFAULT_CONFIG.tableName,
    embeddingProvider: DEFAULT_CONFIG.embeddingProvider,
    embeddingModel: DEFAULT_CONFIG.embeddingModel,
    embeddingModelRevision: DEFAULT_CONFIG.embeddingModelRevision,
    transformersAllowRemoteModels: DEFAULT_CONFIG.transformersAllowRemoteModels,
    redaction: {
      ...DEFAULT_CONFIG.redaction,
      patterns: [...DEFAULT_CONFIG.redaction.patterns],
    },
    accessLog: DEFAULT_CONFIG.accessLog,
    mcpMaxTopK: DEFAULT_CONFIG.mcpMaxTopK,
    mcpMaxOutputBytes: DEFAULT_CONFIG.mcpMaxOutputBytes,
    topK: DEFAULT_CONFIG.topK,
    chunkSize: DEFAULT_CONFIG.chunkSize,
    chunkOverlap: DEFAULT_CONFIG.chunkOverlap,
    maxFileBytes: DEFAULT_CONFIG.maxFileBytes,
    ingestConcurrency: DEFAULT_CONFIG.ingestConcurrency,
    embeddingBatchSize: DEFAULT_CONFIG.embeddingBatchSize,
    sourceFingerprintMode: DEFAULT_CONFIG.sourceFingerprintMode,
    incrementalFailurePolicy: DEFAULT_CONFIG.incrementalFailurePolicy,
    hybridTextScanLimit: DEFAULT_CONFIG.hybridTextScanLimit,
    workloadLimits: structuredClone(DEFAULT_CONFIG.workloadLimits),
    includeExtensions: [...DEFAULT_CONFIG.includeExtensions],
    pdfOcrCommand: [...DEFAULT_CONFIG.pdfOcrCommand],
    pdfOcrTimeoutMs: DEFAULT_CONFIG.pdfOcrTimeoutMs,
    imageOcrCommand: [...DEFAULT_CONFIG.imageOcrCommand],
    imageOcrTimeoutMs: DEFAULT_CONFIG.imageOcrTimeoutMs,
    legacyWordCommand: [...DEFAULT_CONFIG.legacyWordCommand],
    legacyWordTimeoutMs: DEFAULT_CONFIG.legacyWordTimeoutMs,
  }

  return { ...config, ...configOverrides }
}
