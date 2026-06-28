import path from "node:path"
import { DEFAULT_CONFIG } from "../defaults.js"
import type { Config } from "../types.js"

export function testConfig(overrides?: Partial<Config>): Config
export function testConfig(projectRoot: string, overrides?: Partial<Config>): Config
export function testConfig(
  projectRootOrOverrides: string | Partial<Config> = "/tmp/mimir",
  overrides: Partial<Config> = {},
): Config {
  const projectRoot =
    typeof projectRootOrOverrides === "string" ? projectRootOrOverrides : "/tmp/mimir"
  const configOverrides =
    typeof projectRootOrOverrides === "string" ? overrides : projectRootOrOverrides

  const config: Config = {
    projectRoot,
    rawDir: path.join(projectRoot, DEFAULT_CONFIG.rawDir),
    storageDir: path.join(projectRoot, DEFAULT_CONFIG.storageDir),
    sourcesFile: path.join(projectRoot, DEFAULT_CONFIG.sourcesFile),
    accessLogPath: path.join(projectRoot, DEFAULT_CONFIG.accessLogPath),
    embeddingModelPath: path.join(projectRoot, DEFAULT_CONFIG.embeddingModelPath),
    tableName: DEFAULT_CONFIG.tableName,
    embeddingProvider: DEFAULT_CONFIG.embeddingProvider,
    embeddingModel: DEFAULT_CONFIG.embeddingModel,
    transformersAllowRemoteModels: DEFAULT_CONFIG.transformersAllowRemoteModels,
    redaction: {
      ...DEFAULT_CONFIG.redaction,
      patterns: [...DEFAULT_CONFIG.redaction.patterns],
    },
    accessLog: DEFAULT_CONFIG.accessLog,
    mcpMaxTopK: DEFAULT_CONFIG.mcpMaxTopK,
    topK: DEFAULT_CONFIG.topK,
    chunkSize: DEFAULT_CONFIG.chunkSize,
    chunkOverlap: DEFAULT_CONFIG.chunkOverlap,
    includeExtensions: [...DEFAULT_CONFIG.includeExtensions],
  }

  return { ...config, ...configOverrides }
}
