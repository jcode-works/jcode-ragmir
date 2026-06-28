import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import type { Config } from "./types.js"

const rawConfigSchema = z.object({
  rawDir: z.string().default("private"),
  storageDir: z.string().default(".kb/storage"),
  sourcesFile: z.string().default(".kb/sources.txt"),
  accessLogPath: z.string().default(".kb/access.log"),
  tableName: z.string().default("chunks"),
  ollamaHost: z.string().default("http://localhost:11434"),
  networkPolicy: z.enum(["local-only", "allow-private", "allow-any"]).default("local-only"),
  embedModel: z.string().default("nomic-embed-text"),
  llmModel: z.string().default("gemma4:latest"),
  redaction: z
    .object({
      enabled: z.boolean().default(true),
      builtIn: z.boolean().default(true),
      patterns: z
        .array(
          z.object({
            name: z.string().min(1),
            pattern: z.string().min(1),
            flags: z.string().optional(),
            replacement: z.string().optional(),
          }),
        )
        .default([]),
    })
    .default({ enabled: true, builtIn: true, patterns: [] }),
  accessLog: z.boolean().default(true),
  mcpMaxTopK: z.number().int().positive().default(10),
  topK: z.number().int().positive().default(5),
  chunkSize: z.number().int().positive().default(1200),
  chunkOverlap: z.number().int().nonnegative().default(150),
})

type RawConfig = z.infer<typeof rawConfigSchema>

const CONFIG_PATH = ".kb/config.json"

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
  const raw = existsSync(configFile)
    ? (JSON.parse(await readFile(configFile, "utf8")) as unknown)
    : {}

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
    tableName: withEnv.tableName,
    ollamaHost: withEnv.ollamaHost,
    networkPolicy: withEnv.networkPolicy,
    embedModel: withEnv.embedModel,
    llmModel: withEnv.llmModel,
    redaction: withEnv.redaction,
    accessLog: withEnv.accessLog,
    mcpMaxTopK: withEnv.mcpMaxTopK,
    topK: withEnv.topK,
    chunkSize: withEnv.chunkSize,
    chunkOverlap: withEnv.chunkOverlap,
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
    ollamaHost: process.env.KB_OLLAMA_HOST ?? config.ollamaHost,
    networkPolicy: readNetworkPolicyEnv("KB_NETWORK_POLICY", config.networkPolicy),
    embedModel: process.env.KB_EMBED_MODEL ?? config.embedModel,
    llmModel: process.env.KB_LLM_MODEL ?? config.llmModel,
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
  }
}

function readNetworkPolicyEnv(
  name: string,
  fallback: RawConfig["networkPolicy"],
): RawConfig["networkPolicy"] {
  const raw = process.env[name]
  if (raw === "local-only" || raw === "allow-private" || raw === "allow-any") {
    return raw
  }
  return fallback
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
