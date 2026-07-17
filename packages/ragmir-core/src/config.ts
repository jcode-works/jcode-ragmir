import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import {
  CONFIG_PATH,
  DEFAULT_CONFIG,
  LEGACY_CONFIG_PATH,
  LEGACY_DEFAULT_CONFIG,
} from "./defaults.js"
import { isRecord } from "./guards.js"
import type { Config } from "./types.js"

const embeddingProviderSchema = z.enum(["local-hash", "transformers"])
const privacyProfileSchema = z.enum(["strict", "private", "trusted", "custom"])
const retrievalProfileSchema = z.enum(["fast", "balanced", "quality", "custom"])
const incrementalFailurePolicySchema = z.enum(["preserve-last-good", "remove-stale"])

const rawConfigSchema = z
  .object({
    privacyProfile: privacyProfileSchema.default(DEFAULT_CONFIG.privacyProfile),
    retrievalProfile: retrievalProfileSchema.default(DEFAULT_CONFIG.retrievalProfile),
    acceptedRisks: z.array(z.string().min(1)).default(DEFAULT_CONFIG.acceptedRisks),
    rawDir: z.string().default(DEFAULT_CONFIG.rawDir),
    storageDir: z.string().default(DEFAULT_CONFIG.storageDir),
    sourcesFile: z.string().default(DEFAULT_CONFIG.sourcesFile),
    sources: z.array(z.string().min(1)).default(DEFAULT_CONFIG.sources),
    accessLogPath: z.string().default(DEFAULT_CONFIG.accessLogPath),
    embeddingModelPath: z.string().default(DEFAULT_CONFIG.embeddingModelPath),
    tableName: z.string().default(DEFAULT_CONFIG.tableName),
    embeddingProvider: embeddingProviderSchema.default(DEFAULT_CONFIG.embeddingProvider),
    embeddingModel: z.string().default(DEFAULT_CONFIG.embeddingModel),
    embeddingModelRevision: z.string().min(1).default(DEFAULT_CONFIG.embeddingModelRevision),
    transformersAllowRemoteModels: z
      .boolean()
      .default(DEFAULT_CONFIG.transformersAllowRemoteModels),
    redaction: z
      .object({
        enabled: z.boolean().default(DEFAULT_CONFIG.redaction.enabled),
        builtIn: z.boolean().default(DEFAULT_CONFIG.redaction.builtIn),
        patterns: z
          .array(
            z.object({
              name: z.string().min(1),
              pattern: z.string().min(1),
              flags: z.string().optional(),
              replacement: z.string().optional(),
              verify: z.enum(["luhn"]).optional(),
            }),
          )
          .default(DEFAULT_CONFIG.redaction.patterns),
      })
      .default(DEFAULT_CONFIG.redaction),
    accessLog: z.boolean().default(DEFAULT_CONFIG.accessLog),
    mcpMaxTopK: z.number().int().positive().default(DEFAULT_CONFIG.mcpMaxTopK),
    mcpMaxOutputBytes: z.number().int().min(1_024).default(DEFAULT_CONFIG.mcpMaxOutputBytes),
    topK: z.number().int().positive().default(DEFAULT_CONFIG.topK),
    chunkSize: z.number().int().positive().default(DEFAULT_CONFIG.chunkSize),
    chunkOverlap: z.number().int().nonnegative().default(DEFAULT_CONFIG.chunkOverlap),
    maxFileBytes: z.number().int().positive().default(DEFAULT_CONFIG.maxFileBytes),
    ingestConcurrency: z.number().int().positive().default(DEFAULT_CONFIG.ingestConcurrency),
    embeddingBatchSize: z.number().int().positive().default(DEFAULT_CONFIG.embeddingBatchSize),
    incrementalFailurePolicy: incrementalFailurePolicySchema.default(
      DEFAULT_CONFIG.incrementalFailurePolicy,
    ),
    hybridTextScanLimit: z.number().int().positive().default(DEFAULT_CONFIG.hybridTextScanLimit),
    includeExtensions: z.array(z.string().min(1)).default(DEFAULT_CONFIG.includeExtensions),
    pdfOcrCommand: z.array(z.string().min(1)).default(DEFAULT_CONFIG.pdfOcrCommand),
    pdfOcrTimeoutMs: z.number().int().positive().default(DEFAULT_CONFIG.pdfOcrTimeoutMs),
    imageOcrCommand: z.array(z.string().min(1)).default(DEFAULT_CONFIG.imageOcrCommand),
    imageOcrTimeoutMs: z.number().int().positive().default(DEFAULT_CONFIG.imageOcrTimeoutMs),
    legacyWordCommand: z.array(z.string().min(1)).default(DEFAULT_CONFIG.legacyWordCommand),
    legacyWordTimeoutMs: z.number().int().positive().default(DEFAULT_CONFIG.legacyWordTimeoutMs),
  })
  .strict()

type RawConfig = z.infer<typeof rawConfigSchema>

interface ProjectConfigFile {
  projectRoot: string
  configPath: string
  legacy: boolean
}

export function findProjectRoot(start = process.cwd()): string {
  return findProjectConfig(start).projectRoot
}

export function findProjectConfig(start = process.cwd()): ProjectConfigFile {
  let current = path.resolve(start)

  while (true) {
    if (existsSync(path.join(current, CONFIG_PATH))) {
      return {
        projectRoot: current,
        configPath: path.join(current, CONFIG_PATH),
        legacy: false,
      }
    }

    if (existsSync(path.join(current, LEGACY_CONFIG_PATH))) {
      return {
        projectRoot: current,
        configPath: path.join(current, LEGACY_CONFIG_PATH),
        legacy: true,
      }
    }

    const parent = path.dirname(current)
    if (parent === current) {
      const projectRoot = path.resolve(start)
      return {
        projectRoot,
        configPath: path.join(projectRoot, CONFIG_PATH),
        legacy: false,
      }
    }
    current = parent
  }
}

export async function loadConfig(start = process.cwd()): Promise<Config> {
  const projectConfig = findProjectConfig(start)
  const hasConfig = existsSync(projectConfig.configPath)
  const raw: unknown = hasConfig ? JSON.parse(await readFile(projectConfig.configPath, "utf8")) : {}
  if (!isRecord(raw)) {
    throw new Error(
      `${path.relative(projectConfig.projectRoot, projectConfig.configPath)} must contain a JSON object.`,
    )
  }
  const defaults = projectConfig.legacy ? LEGACY_DEFAULT_CONFIG : DEFAULT_CONFIG

  const parsed = rawConfigSchema.parse({ ...defaults, ...raw })
  const withProfile = applyRetrievalProfile(parsed, raw)
  const withEnv = applyEnv(withProfile)
  const effective = applyPrivacyFloor(withEnv)

  if (effective.chunkOverlap >= effective.chunkSize) {
    throw new Error("chunkOverlap must be lower than chunkSize.")
  }

  return {
    projectRoot: projectConfig.projectRoot,
    privacyProfile: effective.privacyProfile,
    retrievalProfile: effective.retrievalProfile,
    acceptedRisks: effective.acceptedRisks,
    rawDir: resolveFromRoot(projectConfig.projectRoot, effective.rawDir),
    storageDir: resolveFromRoot(projectConfig.projectRoot, effective.storageDir),
    sourcesFile: resolveFromRoot(projectConfig.projectRoot, effective.sourcesFile),
    sources: effective.sources,
    accessLogPath: resolveFromRoot(projectConfig.projectRoot, effective.accessLogPath),
    embeddingModelPath: resolveFromRoot(projectConfig.projectRoot, effective.embeddingModelPath),
    tableName: effective.tableName,
    embeddingProvider: effective.embeddingProvider,
    embeddingModel: effective.embeddingModel,
    embeddingModelRevision: effective.embeddingModelRevision,
    transformersAllowRemoteModels: effective.transformersAllowRemoteModels,
    redaction: effective.redaction,
    accessLog: effective.accessLog,
    mcpMaxTopK: effective.mcpMaxTopK,
    mcpMaxOutputBytes: effective.mcpMaxOutputBytes,
    topK: effective.topK,
    chunkSize: effective.chunkSize,
    chunkOverlap: effective.chunkOverlap,
    maxFileBytes: effective.maxFileBytes,
    ingestConcurrency: effective.ingestConcurrency,
    embeddingBatchSize: effective.embeddingBatchSize,
    incrementalFailurePolicy: effective.incrementalFailurePolicy,
    hybridTextScanLimit: effective.hybridTextScanLimit,
    includeExtensions: normalizeExtensions(effective.includeExtensions),
    pdfOcrCommand: effective.pdfOcrCommand,
    pdfOcrTimeoutMs: effective.pdfOcrTimeoutMs,
    imageOcrCommand: effective.imageOcrCommand,
    imageOcrTimeoutMs: effective.imageOcrTimeoutMs,
    legacyWordCommand: effective.legacyWordCommand,
    legacyWordTimeoutMs: effective.legacyWordTimeoutMs,
  }
}

function applyRetrievalProfile(config: RawConfig, raw: Record<string, unknown>): RawConfig {
  if (config.retrievalProfile === "fast") {
    return {
      ...config,
      topK: raw.topK === undefined ? 5 : config.topK,
      hybridTextScanLimit:
        raw.hybridTextScanLimit === undefined ? 2_000 : config.hybridTextScanLimit,
    }
  }
  if (config.retrievalProfile === "quality") {
    return {
      ...config,
      topK: raw.topK === undefined ? 12 : config.topK,
      hybridTextScanLimit:
        raw.hybridTextScanLimit === undefined ? 10_000 : config.hybridTextScanLimit,
    }
  }
  return config
}

function applyPrivacyFloor(config: RawConfig): RawConfig {
  if (config.privacyProfile !== "strict") {
    return config
  }
  return {
    ...config,
    transformersAllowRemoteModels: false,
    redaction: { ...config.redaction, enabled: true, builtIn: true },
    mcpMaxTopK: Math.min(config.mcpMaxTopK, 5),
    mcpMaxOutputBytes: Math.min(config.mcpMaxOutputBytes, 16_384),
    pdfOcrCommand: [],
    imageOcrCommand: [],
    legacyWordCommand: [],
  }
}

function resolveFromRoot(projectRoot: string, input: string): string {
  return path.isAbsolute(input) ? input : path.resolve(projectRoot, input)
}

function applyEnv(config: RawConfig): RawConfig {
  return {
    ...config,
    rawDir: readStringEnv("RAGMIR_RAW_DIR", "KB_RAW_DIR", config.rawDir),
    storageDir: readStringEnv("RAGMIR_STORAGE_DIR", "KB_STORAGE_DIR", config.storageDir),
    sourcesFile: readStringEnv("RAGMIR_SOURCES_FILE", "KB_SOURCES_FILE", config.sourcesFile),
    accessLogPath: readStringEnv(
      "RAGMIR_ACCESS_LOG_PATH",
      "KB_ACCESS_LOG_PATH",
      config.accessLogPath,
    ),
    embeddingProvider: readEmbeddingProviderEnv(
      "RAGMIR_EMBEDDING_PROVIDER",
      "KB_EMBEDDING_PROVIDER",
      config.embeddingProvider,
    ),
    embeddingModel: readStringEnv(
      "RAGMIR_EMBEDDING_MODEL",
      "KB_EMBEDDING_MODEL",
      config.embeddingModel,
    ),
    embeddingModelRevision: readStringEnv(
      "RAGMIR_EMBEDDING_MODEL_REVISION",
      "KB_EMBEDDING_MODEL_REVISION",
      config.embeddingModelRevision,
    ),
    embeddingModelPath: readStringEnv(
      "RAGMIR_EMBEDDING_MODEL_PATH",
      "KB_EMBEDDING_MODEL_PATH",
      config.embeddingModelPath,
    ),
    transformersAllowRemoteModels: readBooleanEnv(
      "RAGMIR_TRANSFORMERS_ALLOW_REMOTE_MODELS",
      "KB_TRANSFORMERS_ALLOW_REMOTE_MODELS",
      config.transformersAllowRemoteModels,
    ),
    redaction: {
      ...config.redaction,
      enabled: readBooleanEnv(
        "RAGMIR_REDACTION_ENABLED",
        "KB_REDACTION_ENABLED",
        config.redaction.enabled,
      ),
      builtIn: readBooleanEnv(
        "RAGMIR_REDACTION_BUILT_IN",
        "KB_REDACTION_BUILT_IN",
        config.redaction.builtIn,
      ),
    },
    accessLog: readBooleanEnv("RAGMIR_ACCESS_LOG", "KB_ACCESS_LOG", config.accessLog),
    mcpMaxTopK: readPositiveIntEnv("RAGMIR_MCP_MAX_TOP_K", "KB_MCP_MAX_TOP_K", config.mcpMaxTopK),
    mcpMaxOutputBytes: readIntegerAtLeastEnv(
      "RAGMIR_MCP_MAX_OUTPUT_BYTES",
      "KB_MCP_MAX_OUTPUT_BYTES",
      1_024,
      config.mcpMaxOutputBytes,
    ),
    topK: readPositiveIntEnv("RAGMIR_TOP_K", "KB_TOP_K", config.topK),
    chunkSize: readPositiveIntEnv("RAGMIR_CHUNK_SIZE", "KB_CHUNK_SIZE", config.chunkSize),
    chunkOverlap: readNonNegativeIntEnv(
      "RAGMIR_CHUNK_OVERLAP",
      "KB_CHUNK_OVERLAP",
      config.chunkOverlap,
    ),
    maxFileBytes: readPositiveIntEnv(
      "RAGMIR_MAX_FILE_BYTES",
      "KB_MAX_FILE_BYTES",
      config.maxFileBytes,
    ),
    ingestConcurrency: readPositiveIntEnv(
      "RAGMIR_INGEST_CONCURRENCY",
      "KB_INGEST_CONCURRENCY",
      config.ingestConcurrency,
    ),
    embeddingBatchSize: readPositiveIntEnv(
      "RAGMIR_EMBEDDING_BATCH_SIZE",
      "KB_EMBEDDING_BATCH_SIZE",
      config.embeddingBatchSize,
    ),
    hybridTextScanLimit: readPositiveIntEnv(
      "RAGMIR_HYBRID_TEXT_SCAN_LIMIT",
      "KB_HYBRID_TEXT_SCAN_LIMIT",
      config.hybridTextScanLimit,
    ),
    includeExtensions: readExtensionsEnv(
      "RAGMIR_INCLUDE_EXTENSIONS",
      "KB_INCLUDE_EXTENSIONS",
      config.includeExtensions,
    ),
    pdfOcrCommand: readJsonStringArrayEnv(
      "RAGMIR_PDF_OCR_COMMAND",
      "KB_PDF_OCR_COMMAND",
      config.pdfOcrCommand,
    ),
    pdfOcrTimeoutMs: readPositiveIntEnv(
      "RAGMIR_PDF_OCR_TIMEOUT_MS",
      "KB_PDF_OCR_TIMEOUT_MS",
      config.pdfOcrTimeoutMs,
    ),
    imageOcrCommand: readJsonStringArrayEnv(
      "RAGMIR_IMAGE_OCR_COMMAND",
      "KB_IMAGE_OCR_COMMAND",
      config.imageOcrCommand,
    ),
    imageOcrTimeoutMs: readPositiveIntEnv(
      "RAGMIR_IMAGE_OCR_TIMEOUT_MS",
      "KB_IMAGE_OCR_TIMEOUT_MS",
      config.imageOcrTimeoutMs,
    ),
    legacyWordCommand: readJsonStringArrayEnv(
      "RAGMIR_LEGACY_WORD_COMMAND",
      "KB_LEGACY_WORD_COMMAND",
      config.legacyWordCommand,
    ),
    legacyWordTimeoutMs: readPositiveIntEnv(
      "RAGMIR_LEGACY_WORD_TIMEOUT_MS",
      "KB_LEGACY_WORD_TIMEOUT_MS",
      config.legacyWordTimeoutMs,
    ),
  }
}

function normalizeExtensions(extensions: string[]): string[] {
  return [
    ...new Set(
      extensions
        .map((extension) => extension.trim().toLowerCase())
        .filter(Boolean)
        .map((extension) => (extension.startsWith(".") ? extension : `.${extension}`)),
    ),
  ].sort()
}

function readEmbeddingProviderEnv(
  name: string,
  legacyName: string,
  fallback: RawConfig["embeddingProvider"],
): RawConfig["embeddingProvider"] {
  const raw = process.env[name] ?? process.env[legacyName]
  if (!raw) {
    return fallback
  }
  const parsed = embeddingProviderSchema.safeParse(raw)
  if (!parsed.success) {
    return fallback
  }
  return parsed.data
}

function readStringEnv(name: string, legacyName: string, fallback: string): string {
  return process.env[name] ?? process.env[legacyName] ?? fallback
}

function readBooleanEnv(name: string, legacyName: string, fallback: boolean): boolean {
  const raw = (process.env[name] ?? process.env[legacyName])?.toLowerCase()
  if (raw === "1" || raw === "true" || raw === "yes") {
    return true
  }
  if (raw === "0" || raw === "false" || raw === "no") {
    return false
  }
  return fallback
}

function readPositiveIntEnv(name: string, legacyName: string, fallback: number): number {
  const raw = process.env[name] ?? process.env[legacyName]
  if (!raw) {
    return fallback
  }
  const value = Number(raw)
  if (!(Number.isSafeInteger(value) && value > 0)) {
    return fallback
  }
  return value
}

function readIntegerAtLeastEnv(
  name: string,
  legacyName: string,
  minimum: number,
  fallback: number,
): number {
  const raw = process.env[name] ?? process.env[legacyName]
  if (!raw) {
    return fallback
  }
  const value = Number(raw)
  if (!(Number.isSafeInteger(value) && value >= minimum)) {
    return fallback
  }
  return value
}

function readNonNegativeIntEnv(name: string, legacyName: string, fallback: number): number {
  const raw = process.env[name] ?? process.env[legacyName]
  if (!raw) {
    return fallback
  }
  const value = Number(raw)
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback
}

function readExtensionsEnv(name: string, legacyName: string, fallback: string[]): string[] {
  const raw = process.env[name] ?? process.env[legacyName]
  if (!raw) {
    return fallback
  }
  return raw.split(",")
}

function readJsonStringArrayEnv(name: string, legacyName: string, fallback: string[]): string[] {
  const raw = process.env[name] ?? process.env[legacyName]
  if (!raw) {
    return fallback
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) &&
      parsed.every((value) => typeof value === "string" && value.length > 0)
      ? parsed
      : fallback
  } catch {
    return fallback
  }
}
