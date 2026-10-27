import { channel } from "node:diagnostics_channel"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import {
  CONFIG_PATH,
  DEFAULT_CONFIG,
  defaultEmbeddingModelRevision,
  LEGACY_CONFIG_PATH,
  LEGACY_DEFAULT_CONFIG,
  MAX_CHUNK_SIZE,
  MAX_CHUNKS_PER_DOCUMENT,
  MAX_CONFIG_ARRAY_ITEMS,
  MAX_CONFIG_NAME_CHARACTERS,
  MAX_CONFIG_PATH_CHARACTERS,
  MAX_CONFIG_TEXT_CHARACTERS,
  MAX_CONFIGURED_FILE_BYTES,
  MAX_EMBEDDING_BATCH_SIZE,
  MAX_EXTERNAL_COMMAND_ARGUMENTS,
  MAX_EXTERNAL_COMMAND_TIMEOUT_MS,
  MAX_HYBRID_TEXT_SCAN_LIMIT,
  MAX_INCLUDE_EXTENSIONS,
  MAX_INGEST_CHUNKS_PER_FILE,
  MAX_INGEST_CONCURRENCY,
  MAX_MCP_OUTPUT_BYTES,
  MAX_SEARCH_SCOPES,
  MAX_SEARCH_TOP_K,
  MAX_SOURCE_WEIGHT,
  MAX_WORKLOAD_CONCURRENCY,
  MAX_WORKLOAD_QUEUE,
  MAX_WORKLOAD_QUEUE_TIMEOUT_MS,
  SHARED_CONFIG_FILENAME,
} from "./defaults.js"
import { isRecord } from "./guards.js"
import type { Config, WorkloadLimit } from "./types.js"

export const CONFIG_LOAD_DIAGNOSTICS_CHANNEL = "ragmir:config-load"

export interface ConfigLoadDiagnosticsEvent {
  projectRoot: string
  configPath: string
}

const configLoadDiagnostics = channel(CONFIG_LOAD_DIAGNOSTICS_CHANNEL)

const embeddingProviderSchema = z.enum(["local-hash", "transformers"])
const embeddingModelDigestSchema = z
  .string()
  .regex(/^sha256:[0-9a-f]{64}$/u)
  .nullable()
const retrievalProfileSchema = z.enum(["fast", "balanced", "quality", "custom"])
const sourceFingerprintModeSchema = z.enum(["fast", "strict"])
const incrementalFailurePolicySchema = z.enum(["preserve-last-good", "remove-stale"])
const configPathSchema = z.string().min(1).max(MAX_CONFIG_PATH_CHARACTERS)
const configTextSchema = z.string().min(1).max(MAX_CONFIG_TEXT_CHARACTERS)
const externalCommandSchema = z.array(configTextSchema).max(MAX_EXTERNAL_COMMAND_ARGUMENTS)
const searchScopeSchema = z
  .object({
    includePaths: z.array(configPathSchema).max(MAX_CONFIG_ARRAY_ITEMS).default([]),
    excludePaths: z.array(configPathSchema).max(MAX_CONFIG_ARRAY_ITEMS).default([]),
    description: configTextSchema.optional(),
  })
  .strict()
const scopeNameSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u)
function workloadLimitSchema(defaults: WorkloadLimit) {
  return z
    .object({
      concurrency: z
        .number()
        .int()
        .positive()
        .max(MAX_WORKLOAD_CONCURRENCY)
        .default(defaults.concurrency),
      maxQueue: z.number().int().positive().max(MAX_WORKLOAD_QUEUE).default(defaults.maxQueue),
      queueTimeoutMs: z
        .number()
        .int()
        .positive()
        .max(MAX_WORKLOAD_QUEUE_TIMEOUT_MS)
        .default(defaults.queueTimeoutMs),
    })
    .strict()
}

const rawConfigSchema = z
  .object({
    retrievalProfile: retrievalProfileSchema.default(DEFAULT_CONFIG.retrievalProfile),
    rawDir: configPathSchema.default(DEFAULT_CONFIG.rawDir),
    storageDir: configPathSchema.default(DEFAULT_CONFIG.storageDir),
    sourcesFile: configPathSchema.default(DEFAULT_CONFIG.sourcesFile),
    sources: z.array(configPathSchema).max(MAX_CONFIG_ARRAY_ITEMS).default(DEFAULT_CONFIG.sources),
    embeddingModelPath: configPathSchema.default(DEFAULT_CONFIG.embeddingModelPath),
    tableName: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/u)
      .default(DEFAULT_CONFIG.tableName),
    embeddingProvider: embeddingProviderSchema.default(DEFAULT_CONFIG.embeddingProvider),
    embeddingModel: configTextSchema.default(DEFAULT_CONFIG.embeddingModel),
    embeddingModelRevision: configTextSchema.default(DEFAULT_CONFIG.embeddingModelRevision),
    embeddingModelDigest: embeddingModelDigestSchema.default(DEFAULT_CONFIG.embeddingModelDigest),
    transformersAllowRemoteModels: z
      .boolean()
      .default(DEFAULT_CONFIG.transformersAllowRemoteModels),
    mcpMaxTopK: z.number().int().positive().default(DEFAULT_CONFIG.mcpMaxTopK),
    mcpMaxOutputBytes: z
      .number()
      .int()
      .min(1_024)
      .max(MAX_MCP_OUTPUT_BYTES)
      .default(DEFAULT_CONFIG.mcpMaxOutputBytes),
    topK: z.number().int().positive().default(DEFAULT_CONFIG.topK),
    maxChunksPerDocument: z.number().int().positive().default(DEFAULT_CONFIG.maxChunksPerDocument),
    chunkSize: z.number().int().positive().max(MAX_CHUNK_SIZE).default(DEFAULT_CONFIG.chunkSize),
    chunkOverlap: z
      .number()
      .int()
      .nonnegative()
      .max(MAX_CHUNK_SIZE)
      .default(DEFAULT_CONFIG.chunkOverlap),
    maxFileBytes: z.number().int().positive().default(DEFAULT_CONFIG.maxFileBytes),
    ingestConcurrency: z.number().int().positive().default(DEFAULT_CONFIG.ingestConcurrency),
    embeddingBatchSize: z.number().int().positive().default(DEFAULT_CONFIG.embeddingBatchSize),
    sourceFingerprintMode: sourceFingerprintModeSchema.default(
      DEFAULT_CONFIG.sourceFingerprintMode,
    ),
    incrementalFailurePolicy: incrementalFailurePolicySchema.default(
      DEFAULT_CONFIG.incrementalFailurePolicy,
    ),
    hybridTextScanLimit: z.number().int().positive().default(DEFAULT_CONFIG.hybridTextScanLimit),
    workloadLimits: z
      .object({
        search: workloadLimitSchema(DEFAULT_CONFIG.workloadLimits.search).default(
          DEFAULT_CONFIG.workloadLimits.search,
        ),
        embedding: workloadLimitSchema(DEFAULT_CONFIG.workloadLimits.embedding).default(
          DEFAULT_CONFIG.workloadLimits.embedding,
        ),
        ingestion: workloadLimitSchema(DEFAULT_CONFIG.workloadLimits.ingestion).default(
          DEFAULT_CONFIG.workloadLimits.ingestion,
        ),
      })
      .strict()
      .default(DEFAULT_CONFIG.workloadLimits),
    includeExtensions: z
      .array(z.string().min(1).max(32))
      .max(MAX_INCLUDE_EXTENSIONS)
      .default(DEFAULT_CONFIG.includeExtensions),
    pdfOcrCommand: externalCommandSchema.default(DEFAULT_CONFIG.pdfOcrCommand),
    pdfOcrTimeoutMs: z
      .number()
      .int()
      .positive()
      .max(MAX_EXTERNAL_COMMAND_TIMEOUT_MS)
      .default(DEFAULT_CONFIG.pdfOcrTimeoutMs),
    imageOcrCommand: externalCommandSchema.default(DEFAULT_CONFIG.imageOcrCommand),
    imageOcrTimeoutMs: z
      .number()
      .int()
      .positive()
      .max(MAX_EXTERNAL_COMMAND_TIMEOUT_MS)
      .default(DEFAULT_CONFIG.imageOcrTimeoutMs),
    legacyWordCommand: externalCommandSchema.default(DEFAULT_CONFIG.legacyWordCommand),
    legacyWordTimeoutMs: z
      .number()
      .int()
      .positive()
      .max(MAX_EXTERNAL_COMMAND_TIMEOUT_MS)
      .default(DEFAULT_CONFIG.legacyWordTimeoutMs),
    name: z.string().trim().min(1).max(MAX_CONFIG_NAME_CHARACTERS).nullable().default(null),
    description: z.string().trim().min(1).max(MAX_CONFIG_TEXT_CHARACTERS).nullable().default(null),
    defaultExcludes: z.boolean().default(DEFAULT_CONFIG.defaultExcludes),
    pathPriors: z.boolean().default(DEFAULT_CONFIG.pathPriors),
    sourceWeights: z
      .record(configPathSchema, z.number().positive().max(MAX_SOURCE_WEIGHT))
      .default(DEFAULT_CONFIG.sourceWeights),
    scopes: z.record(scopeNameSchema, searchScopeSchema).default(DEFAULT_CONFIG.scopes),
    collapseLocaleVariants: z.boolean().default(DEFAULT_CONFIG.collapseLocaleVariants),
    maxChunksPerDataFile: z
      .number()
      .int()
      .positive()
      .max(MAX_INGEST_CHUNKS_PER_FILE)
      .nullable()
      .default(DEFAULT_CONFIG.maxChunksPerDataFile),
    mcpAllowedRoots: z
      .array(configPathSchema)
      .max(MAX_CONFIG_ARRAY_ITEMS)
      .default(DEFAULT_CONFIG.mcpAllowedRoots),
    mcpAutoIngest: z.boolean().default(DEFAULT_CONFIG.mcpAutoIngest),
    mcpSeenResults: z
      .enum(["collapse", "include", "exclude"])
      .default(DEFAULT_CONFIG.mcpSeenResults),
  })
  .strict()

type RawConfig = z.infer<typeof rawConfigSchema>

export const RETIRED_CONFIG_KEYS = [
  "privacyProfile",
  "acceptedRisks",
  "redaction",
  "accessLog",
  "accessLogPath",
] as const

export function retiredConfigKeys(raw: Record<string, unknown>): string[] {
  return RETIRED_CONFIG_KEYS.filter((key) => Object.hasOwn(raw, key))
}

export interface ProjectConfigFile {
  projectRoot: string
  /** File that CLI changes write to: the local config when present, else the shared one. */
  configPath: string
  /** Machine-local `.ragmir/config.json` (or the legacy `.kb/config.json`), ignored by Git. */
  localConfigPath: string
  /** Committed `ragmir.config.json`, when the project has one. */
  sharedConfigPath: string | null
  legacy: boolean
}

export function findProjectRoot(start = process.cwd()): string {
  return findProjectConfig(start).projectRoot
}

export function findProjectConfig(start = process.cwd()): ProjectConfigFile {
  let current = path.resolve(start)

  while (true) {
    const localConfigPath = path.join(current, CONFIG_PATH)
    const sharedConfigPath = path.join(current, SHARED_CONFIG_FILENAME)
    const hasLocal = existsSync(localConfigPath)
    const hasShared = existsSync(sharedConfigPath)
    if (hasLocal || hasShared) {
      return {
        projectRoot: current,
        configPath: hasLocal ? localConfigPath : sharedConfigPath,
        localConfigPath,
        sharedConfigPath: hasShared ? sharedConfigPath : null,
        legacy: false,
      }
    }

    const legacyConfigPath = path.join(current, LEGACY_CONFIG_PATH)
    if (existsSync(legacyConfigPath)) {
      return {
        projectRoot: current,
        configPath: legacyConfigPath,
        localConfigPath: legacyConfigPath,
        sharedConfigPath: null,
        legacy: true,
      }
    }

    const parent = path.dirname(current)
    if (parent === current) {
      const projectRoot = path.resolve(start)
      const configPath = path.join(projectRoot, CONFIG_PATH)
      return {
        projectRoot,
        configPath,
        localConfigPath: configPath,
        sharedConfigPath: null,
        legacy: false,
      }
    }
    current = parent
  }
}

/** Whether the project has a shared or local Ragmir config file. */
export function projectConfigExists(location: ProjectConfigFile): boolean {
  return location.sharedConfigPath !== null || existsSync(location.localConfigPath)
}

/** Shared config keys overlaid by the machine-local config, one top-level key at a time. */
export async function readMergedProjectConfig(
  location: ProjectConfigFile,
): Promise<Record<string, unknown>> {
  const shared = location.sharedConfigPath
    ? await readConfigObject(location.sharedConfigPath, location.projectRoot)
    : {}
  const local = existsSync(location.localConfigPath)
    ? await readConfigObject(location.localConfigPath, location.projectRoot)
    : {}
  return { ...shared, ...local }
}

async function readConfigObject(
  configPath: string,
  projectRoot: string,
): Promise<Record<string, unknown>> {
  const raw: unknown = JSON.parse(await readFile(configPath, "utf8"))
  if (!isRecord(raw)) {
    throw new Error(`${path.relative(projectRoot, configPath)} must contain a JSON object.`)
  }
  return raw
}

export async function loadConfig(start = process.cwd()): Promise<Config> {
  const projectConfig = findProjectConfig(start)
  const raw = await readMergedProjectConfig(projectConfig)
  const retired = retiredConfigKeys(raw)
  if (retired.length > 0) {
    throw new Error(
      `Retired configuration fields: ${retired.join(", ")}. Run \`rgr upgrade\` to back up and migrate the config and rebuild the index. Ragmir now preserves source text without masking; your consuming model controls where retrieved content is sent.`,
    )
  }
  const defaults = projectConfig.legacy ? LEGACY_DEFAULT_CONFIG : DEFAULT_CONFIG

  const parsed = rawConfigSchema.parse(configWithModelIdentityDefaults(defaults, raw))
  const withProfile = applyRetrievalProfile(parsed, raw)
  const withEnv = rawConfigSchema.parse(applyEnv(withProfile))
  const effective = withEnv

  assertAtMost("maxFileBytes", effective.maxFileBytes, MAX_CONFIGURED_FILE_BYTES)
  assertAtMost("ingestConcurrency", effective.ingestConcurrency, MAX_INGEST_CONCURRENCY)
  assertAtMost("embeddingBatchSize", effective.embeddingBatchSize, MAX_EMBEDDING_BATCH_SIZE)
  assertAtMost("topK", effective.topK, MAX_SEARCH_TOP_K)
  assertAtMost("maxChunksPerDocument", effective.maxChunksPerDocument, MAX_CHUNKS_PER_DOCUMENT)
  assertAtMost("mcpMaxTopK", effective.mcpMaxTopK, MAX_SEARCH_TOP_K)
  assertAtMost("hybridTextScanLimit", effective.hybridTextScanLimit, MAX_HYBRID_TEXT_SCAN_LIMIT)

  if (effective.chunkOverlap >= effective.chunkSize) {
    throw new Error("chunkOverlap must be lower than chunkSize.")
  }

  const config: Config = {
    projectRoot: projectConfig.projectRoot,
    retrievalProfile: effective.retrievalProfile,
    rawDir: resolveFromRoot(projectConfig.projectRoot, effective.rawDir),
    storageDir: resolveFromRoot(projectConfig.projectRoot, effective.storageDir),
    sourcesFile: resolveFromRoot(projectConfig.projectRoot, effective.sourcesFile),
    sources: effective.sources,
    embeddingModelPath: resolveFromRoot(projectConfig.projectRoot, effective.embeddingModelPath),
    tableName: effective.tableName,
    embeddingProvider: effective.embeddingProvider,
    embeddingModel: effective.embeddingModel,
    embeddingModelRevision: effective.embeddingModelRevision,
    embeddingModelDigest: effective.embeddingModelDigest,
    transformersAllowRemoteModels: effective.transformersAllowRemoteModels,
    mcpMaxTopK: effective.mcpMaxTopK,
    mcpMaxOutputBytes: effective.mcpMaxOutputBytes,
    topK: effective.topK,
    maxChunksPerDocument: effective.maxChunksPerDocument,
    chunkSize: effective.chunkSize,
    chunkOverlap: effective.chunkOverlap,
    maxFileBytes: effective.maxFileBytes,
    ingestConcurrency: effective.ingestConcurrency,
    embeddingBatchSize: effective.embeddingBatchSize,
    sourceFingerprintMode: effective.sourceFingerprintMode,
    incrementalFailurePolicy: effective.incrementalFailurePolicy,
    hybridTextScanLimit: effective.hybridTextScanLimit,
    workloadLimits: effective.workloadLimits,
    includeExtensions: normalizeExtensions(effective.includeExtensions),
    pdfOcrCommand: effective.pdfOcrCommand,
    pdfOcrTimeoutMs: effective.pdfOcrTimeoutMs,
    imageOcrCommand: effective.imageOcrCommand,
    imageOcrTimeoutMs: effective.imageOcrTimeoutMs,
    legacyWordCommand: effective.legacyWordCommand,
    legacyWordTimeoutMs: effective.legacyWordTimeoutMs,
    name: effective.name,
    description: effective.description,
    defaultExcludes: effective.defaultExcludes,
    pathPriors: effective.pathPriors,
    sourceWeights: effective.sourceWeights,
    scopes: Object.fromEntries(
      Object.entries(effective.scopes).map(([name, scope]) => [
        name,
        {
          includePaths: scope.includePaths,
          excludePaths: scope.excludePaths,
          ...(scope.description === undefined ? {} : { description: scope.description }),
        },
      ]),
    ),
    collapseLocaleVariants: effective.collapseLocaleVariants,
    maxChunksPerDataFile: effective.maxChunksPerDataFile,
    mcpAllowedRoots: effective.mcpAllowedRoots,
    mcpAutoIngest: effective.mcpAutoIngest,
    mcpSeenResults: effective.mcpSeenResults,
  }
  if (Object.keys(config.scopes).length > MAX_SEARCH_SCOPES) {
    throw new Error(`scopes must define at most ${MAX_SEARCH_SCOPES} named scopes.`)
  }
  if (configLoadDiagnostics.hasSubscribers) {
    configLoadDiagnostics.publish({
      projectRoot: config.projectRoot,
      configPath: projectConfig.configPath,
    } satisfies ConfigLoadDiagnosticsEvent)
  }
  return config
}

export function externalExtractorsRequested(config: Config): boolean {
  return configuredExternalExtractors(config)
}

function configuredExternalExtractors(
  config: Pick<Config, "pdfOcrCommand" | "imageOcrCommand" | "legacyWordCommand">,
): boolean {
  return (
    config.pdfOcrCommand.length > 0 ||
    config.imageOcrCommand.length > 0 ||
    config.legacyWordCommand.length > 0
  )
}

function assertAtMost(name: string, value: number, maximum: number): void {
  if (value > maximum) {
    throw new Error(`${name} must be at most ${maximum}.`)
  }
}

function configWithModelIdentityDefaults(
  defaults: Omit<Config, "projectRoot">,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const embeddingModel =
    typeof raw.embeddingModel === "string" ? raw.embeddingModel : defaults.embeddingModel
  const embeddingModelRevision =
    typeof raw.embeddingModelRevision === "string"
      ? raw.embeddingModelRevision
      : defaultEmbeddingModelRevision(embeddingModel)
  const modelIdentityChanged =
    embeddingModel !== defaults.embeddingModel ||
    embeddingModelRevision !== defaults.embeddingModelRevision
  return {
    ...defaults,
    ...raw,
    embeddingModelRevision,
    embeddingModelDigest:
      raw.embeddingModelDigest === undefined && modelIdentityChanged
        ? null
        : (raw.embeddingModelDigest ?? defaults.embeddingModelDigest),
  }
}

/** Budgets each retrieval profile chooses for fields the config leaves unset. */
export const RETRIEVAL_PROFILE_BUDGETS: Readonly<
  Record<
    Exclude<Config["retrievalProfile"], "custom">,
    { topK: number; hybridTextScanLimit: number }
  >
> = {
  fast: { topK: 5, hybridTextScanLimit: 2_000 },
  balanced: {
    topK: DEFAULT_CONFIG.topK,
    hybridTextScanLimit: DEFAULT_CONFIG.hybridTextScanLimit,
  },
  quality: { topK: 12, hybridTextScanLimit: 10_000 },
}

function applyRetrievalProfile(config: RawConfig, raw: Record<string, unknown>): RawConfig {
  if (config.retrievalProfile === "custom") {
    return config
  }
  const budgets = RETRIEVAL_PROFILE_BUDGETS[config.retrievalProfile]
  return {
    ...config,
    topK: raw.topK === undefined ? budgets.topK : config.topK,
    hybridTextScanLimit:
      raw.hybridTextScanLimit === undefined
        ? budgets.hybridTextScanLimit
        : config.hybridTextScanLimit,
  }
}

/**
 * Budgets pinned in the config that differ from the selected profile. Older `rgr init` wrote every
 * default, so a later switch to the quality profile silently kept topK 8.
 */
export function retrievalProfileOverrides(
  raw: Record<string, unknown>,
  profile: Config["retrievalProfile"],
): Array<{ field: "topK" | "hybridTextScanLimit"; configured: number; profileValue: number }> {
  if (profile === "custom") {
    return []
  }
  const budgets = RETRIEVAL_PROFILE_BUDGETS[profile]
  return (["topK", "hybridTextScanLimit"] as const).flatMap((field) => {
    const configured = raw[field]
    return typeof configured === "number" && configured !== budgets[field]
      ? [{ field, configured, profileValue: budgets[field] }]
      : []
  })
}

function resolveFromRoot(projectRoot: string, input: string): string {
  return path.isAbsolute(input) ? input : path.resolve(projectRoot, input)
}

function applyEnv(config: RawConfig): RawConfig {
  const embeddingModel = readStringEnv(
    "RAGMIR_EMBEDDING_MODEL",
    "KB_EMBEDDING_MODEL",
    config.embeddingModel,
  )
  const embeddingModelRevision =
    process.env.RAGMIR_EMBEDDING_MODEL_REVISION ??
    process.env.KB_EMBEDDING_MODEL_REVISION ??
    (embeddingModel === config.embeddingModel
      ? config.embeddingModelRevision
      : defaultEmbeddingModelRevision(embeddingModel))
  const embeddingModelDigest = readEmbeddingModelDigestEnv(
    "RAGMIR_EMBEDDING_MODEL_DIGEST",
    "KB_EMBEDDING_MODEL_DIGEST",
    embeddingModel === config.embeddingModel &&
      embeddingModelRevision === config.embeddingModelRevision
      ? config.embeddingModelDigest
      : null,
  )
  return {
    ...config,
    rawDir: readStringEnv("RAGMIR_RAW_DIR", "KB_RAW_DIR", config.rawDir),
    storageDir: readStringEnv("RAGMIR_STORAGE_DIR", "KB_STORAGE_DIR", config.storageDir),
    sourcesFile: readStringEnv("RAGMIR_SOURCES_FILE", "KB_SOURCES_FILE", config.sourcesFile),
    embeddingProvider: readEmbeddingProviderEnv(
      "RAGMIR_EMBEDDING_PROVIDER",
      "KB_EMBEDDING_PROVIDER",
      config.embeddingProvider,
    ),
    embeddingModel,
    embeddingModelRevision,
    embeddingModelDigest,
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
    sourceFingerprintMode: readSourceFingerprintModeEnv(
      "RAGMIR_SOURCE_FINGERPRINT_MODE",
      "KB_SOURCE_FINGERPRINT_MODE",
      config.sourceFingerprintMode,
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

function readEmbeddingModelDigestEnv(
  name: string,
  legacyName: string,
  fallback: string | null,
): string | null {
  const raw = process.env[name] ?? process.env[legacyName]
  if (raw === undefined) {
    return fallback
  }
  return embeddingModelDigestSchema.parse(raw)
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
  if (raw === undefined) {
    return fallback
  }
  const parsed = embeddingProviderSchema.safeParse(raw)
  if (!parsed.success) {
    throw invalidEnvironmentValue(name, legacyName, '"local-hash" or "transformers"')
  }
  return parsed.data
}

function readSourceFingerprintModeEnv(
  name: string,
  legacyName: string,
  fallback: RawConfig["sourceFingerprintMode"],
): RawConfig["sourceFingerprintMode"] {
  const raw = process.env[name] ?? process.env[legacyName]
  if (raw === undefined) {
    return fallback
  }
  const parsed = sourceFingerprintModeSchema.safeParse(raw)
  if (!parsed.success) {
    throw invalidEnvironmentValue(name, legacyName, '"fast" or "strict"')
  }
  return parsed.data
}

function readStringEnv(name: string, legacyName: string, fallback: string): string {
  return process.env[name] ?? process.env[legacyName] ?? fallback
}

function readBooleanEnv(name: string, legacyName: string, fallback: boolean): boolean {
  const supplied = process.env[name] ?? process.env[legacyName]
  if (supplied === undefined) {
    return fallback
  }
  const raw = supplied.toLowerCase()
  if (raw === "1" || raw === "true" || raw === "yes") {
    return true
  }
  if (raw === "0" || raw === "false" || raw === "no") {
    return false
  }
  throw invalidEnvironmentValue(name, legacyName, "a boolean (1/0, true/false, or yes/no)")
}

function readPositiveIntEnv(name: string, legacyName: string, fallback: number): number {
  const raw = process.env[name] ?? process.env[legacyName]
  if (raw === undefined) {
    return fallback
  }
  const value = Number(raw)
  if (!(Number.isSafeInteger(value) && value > 0)) {
    throw invalidEnvironmentValue(name, legacyName, "a positive safe integer")
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
  if (raw === undefined) {
    return fallback
  }
  const value = Number(raw)
  if (!(Number.isSafeInteger(value) && value >= minimum)) {
    throw invalidEnvironmentValue(name, legacyName, `an integer of at least ${minimum}`)
  }
  return value
}

function readNonNegativeIntEnv(name: string, legacyName: string, fallback: number): number {
  const raw = process.env[name] ?? process.env[legacyName]
  if (raw === undefined) {
    return fallback
  }
  const value = Number(raw)
  if (!(Number.isSafeInteger(value) && value >= 0)) {
    throw invalidEnvironmentValue(name, legacyName, "a non-negative safe integer")
  }
  return value
}

function readExtensionsEnv(name: string, legacyName: string, fallback: string[]): string[] {
  const raw = process.env[name] ?? process.env[legacyName]
  if (raw === undefined) {
    return fallback
  }
  return raw.split(",")
}

function readJsonStringArrayEnv(name: string, legacyName: string, fallback: string[]): string[] {
  const raw = process.env[name] ?? process.env[legacyName]
  if (raw === undefined) {
    return fallback
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      !Array.isArray(parsed) ||
      !parsed.every((value) => typeof value === "string" && value.length > 0)
    ) {
      throw invalidEnvironmentValue(name, legacyName, "a JSON array of non-empty strings")
    }
    return parsed
  } catch {
    throw invalidEnvironmentValue(name, legacyName, "a JSON array of non-empty strings")
  }
}

function invalidEnvironmentValue(name: string, legacyName: string, expected: string): Error {
  const sourceName = process.env[name] !== undefined ? name : legacyName
  return new Error(`${sourceName} must be ${expected}.`)
}
