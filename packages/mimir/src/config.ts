import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { CONFIG_PATH, DEFAULT_CONFIG } from "./defaults.js"
import type { Config } from "./types.js"

const embeddingProviderSchema = z.enum(["local-hash", "transformers"])

const rawConfigSchema = z.object({
  rawDir: z.string().default(DEFAULT_CONFIG.rawDir),
  storageDir: z.string().default(DEFAULT_CONFIG.storageDir),
  sourcesFile: z.string().default(DEFAULT_CONFIG.sourcesFile),
  accessLogPath: z.string().default(DEFAULT_CONFIG.accessLogPath),
  embeddingModelPath: z.string().default(DEFAULT_CONFIG.embeddingModelPath),
  tableName: z.string().default(DEFAULT_CONFIG.tableName),
  embeddingProvider: embeddingProviderSchema.default(DEFAULT_CONFIG.embeddingProvider),
  embeddingModel: z.string().default(DEFAULT_CONFIG.embeddingModel),
  transformersAllowRemoteModels: z.boolean().default(DEFAULT_CONFIG.transformersAllowRemoteModels),
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
          }),
        )
        .default(DEFAULT_CONFIG.redaction.patterns),
    })
    .default(DEFAULT_CONFIG.redaction),
  accessLog: z.boolean().default(DEFAULT_CONFIG.accessLog),
  mcpMaxTopK: z.number().int().positive().default(DEFAULT_CONFIG.mcpMaxTopK),
  topK: z.number().int().positive().default(DEFAULT_CONFIG.topK),
  chunkSize: z.number().int().positive().default(DEFAULT_CONFIG.chunkSize),
  chunkOverlap: z.number().int().nonnegative().default(DEFAULT_CONFIG.chunkOverlap),
  includeExtensions: z.array(z.string().min(1)).default(DEFAULT_CONFIG.includeExtensions),
})

type RawConfig = z.infer<typeof rawConfigSchema>

export function findProjectRoot(start = process.cwd()): string {
  let current = path.resolve(start)

  while (true) {
    if (existsSync(path.join(current, CONFIG_PATH))) {
      return current
    }

    const parent = path.dirname(current)
    if (parent === current) {
      return path.resolve(start)
    }
    current = parent
  }
}

export async function loadConfig(start = process.cwd()): Promise<Config> {
  const projectRoot = findProjectRoot(start)
  const configFile = path.join(projectRoot, CONFIG_PATH)
  const raw: unknown = existsSync(configFile) ? JSON.parse(await readFile(configFile, "utf8")) : {}

  const parsed = rawConfigSchema.parse(raw)
  const withEnv = applyEnv(parsed)

  if (withEnv.chunkOverlap >= withEnv.chunkSize) {
    throw new Error("chunkOverlap must be lower than chunkSize.")
  }

  return {
    projectRoot,
    rawDir: resolveFromRoot(projectRoot, withEnv.rawDir),
    storageDir: resolveFromRoot(projectRoot, withEnv.storageDir),
    sourcesFile: resolveFromRoot(projectRoot, withEnv.sourcesFile),
    accessLogPath: resolveFromRoot(projectRoot, withEnv.accessLogPath),
    embeddingModelPath: resolveFromRoot(projectRoot, withEnv.embeddingModelPath),
    tableName: withEnv.tableName,
    embeddingProvider: withEnv.embeddingProvider,
    embeddingModel: withEnv.embeddingModel,
    transformersAllowRemoteModels: withEnv.transformersAllowRemoteModels,
    redaction: withEnv.redaction,
    accessLog: withEnv.accessLog,
    mcpMaxTopK: withEnv.mcpMaxTopK,
    topK: withEnv.topK,
    chunkSize: withEnv.chunkSize,
    chunkOverlap: withEnv.chunkOverlap,
    includeExtensions: normalizeExtensions(withEnv.includeExtensions),
  }
}

function resolveFromRoot(projectRoot: string, input: string): string {
  return path.isAbsolute(input) ? input : path.resolve(projectRoot, input)
}

function applyEnv(config: RawConfig): RawConfig {
  return {
    ...config,
    rawDir: process.env.KB_RAW_DIR ?? config.rawDir,
    storageDir: process.env.KB_STORAGE_DIR ?? config.storageDir,
    sourcesFile: process.env.KB_SOURCES_FILE ?? config.sourcesFile,
    accessLogPath: process.env.KB_ACCESS_LOG_PATH ?? config.accessLogPath,
    embeddingProvider: readEmbeddingProviderEnv("KB_EMBEDDING_PROVIDER", config.embeddingProvider),
    embeddingModel: process.env.KB_EMBEDDING_MODEL ?? config.embeddingModel,
    embeddingModelPath: process.env.KB_EMBEDDING_MODEL_PATH ?? config.embeddingModelPath,
    transformersAllowRemoteModels: readBooleanEnv(
      "KB_TRANSFORMERS_ALLOW_REMOTE_MODELS",
      config.transformersAllowRemoteModels,
    ),
    redaction: {
      ...config.redaction,
      enabled: readBooleanEnv("KB_REDACTION_ENABLED", config.redaction.enabled),
      builtIn: readBooleanEnv("KB_REDACTION_BUILT_IN", config.redaction.builtIn),
    },
    accessLog: readBooleanEnv("KB_ACCESS_LOG", config.accessLog),
    mcpMaxTopK: readPositiveIntEnv("KB_MCP_MAX_TOP_K", config.mcpMaxTopK),
    topK: readPositiveIntEnv("KB_TOP_K", config.topK),
    chunkSize: readPositiveIntEnv("KB_CHUNK_SIZE", config.chunkSize),
    chunkOverlap: readNonNegativeIntEnv("KB_CHUNK_OVERLAP", config.chunkOverlap),
    includeExtensions: readExtensionsEnv("KB_INCLUDE_EXTENSIONS", config.includeExtensions),
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
  fallback: RawConfig["embeddingProvider"],
): RawConfig["embeddingProvider"] {
  const parsed = embeddingProviderSchema.safeParse(process.env[name])
  return parsed.success ? parsed.data : fallback
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.toLowerCase()
  if (raw === "1" || raw === "true" || raw === "yes") {
    return true
  }
  if (raw === "0" || raw === "false" || raw === "no") {
    return false
  }
  return fallback
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) {
    return fallback
  }
  const value = Number.parseInt(raw, 10)
  return Number.isInteger(value) && value > 0 ? value : fallback
}

function readNonNegativeIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) {
    return fallback
  }
  const value = Number.parseInt(raw, 10)
  return Number.isInteger(value) && value >= 0 ? value : fallback
}

function readExtensionsEnv(name: string, fallback: string[]): string[] {
  const raw = process.env[name]
  if (!raw) {
    return fallback
  }
  return raw.split(",")
}
