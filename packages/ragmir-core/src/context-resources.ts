import { loadConfig } from "./config.js"
import { doctorWithConfig } from "./doctor.js"
import { knowledgeBaseIdentity } from "./knowledge-bases.js"
import { operationSignal, throwIfAborted } from "./operation.js"
import { readIndexManifestFilePage, readIndexManifestHeader } from "./store.js"
import type {
  Config,
  KnowledgeBaseContextReport,
  KnowledgeBaseSourceCatalog,
  KnowledgeBaseSourceCatalogOptions,
  OperationOptions,
} from "./types.js"

const SOURCE_CATALOG_LIMIT = 50
const MAX_SOURCE_CATALOG_LIMIT = 100
const RAGMIR_MCP_TOOLS = [
  "ragmir_status",
  "ragmir_route_prompt",
  "ragmir_search",
  "ragmir_ask",
  "ragmir_research",
  "ragmir_expand",
  "ragmir_audit",
  "ragmir_evaluate",
  "ragmir_usage_report",
  "ragmir_security_audit",
]
const RAGMIR_MCP_RESOURCES = ["ragmir://context", "ragmir://sources"]

export async function getKnowledgeBaseContext(
  cwd = process.cwd(),
  options: OperationOptions = {},
): Promise<KnowledgeBaseContextReport> {
  const signal = operationSignal(options)
  throwIfAborted(signal)
  const config = await loadConfig(cwd)
  return getKnowledgeBaseContextWithConfig(config, options)
}

export async function getKnowledgeBaseContextWithConfig(
  config: Config,
  options: OperationOptions = {},
): Promise<KnowledgeBaseContextReport> {
  const signal = operationSignal(options)
  throwIfAborted(signal)
  const report = await doctorWithConfig(config, signal ? { signal } : {})
  throwIfAborted(signal)
  const identity = knowledgeBaseIdentity(config.projectRoot)

  return {
    knowledgeBaseId: identity?.id ?? null,
    projectRoot: config.privacyProfile === "strict" ? "." : config.projectRoot,
    privacyProfile: config.privacyProfile,
    retrievalProfile: config.retrievalProfile,
    embeddingProvider: config.embeddingProvider,
    corpusFingerprint: report.corpusFingerprint,
    ready: report.ready,
    coverage: {
      supportedFiles: report.supportedFiles,
      indexedFiles: report.indexedFiles,
      chunksIndexed: report.chunksIndexed,
      missingFromIndex: report.missingFromIndex,
      staleInIndex: report.staleInIndex,
      emptyTextFiles: report.emptyTextFiles,
    },
    indexFreshness: report.indexFreshness,
    securityWarningCount: report.securityWarnings.length,
    nextSteps: report.nextSteps,
    routing: {
      selection: "nearest-configured-ancestor",
      discoverCommand: "rgr bases --json",
    },
    tools: [...RAGMIR_MCP_TOOLS],
    resources: [...RAGMIR_MCP_RESOURCES],
  }
}

export async function getKnowledgeBaseSourceCatalog(
  cwd = process.cwd(),
  options: KnowledgeBaseSourceCatalogOptions = {},
): Promise<KnowledgeBaseSourceCatalog> {
  const signal = operationSignal(options)
  throwIfAborted(signal)
  const config = await loadConfig(cwd)
  return getKnowledgeBaseSourceCatalogWithConfig(config, options)
}

export async function getKnowledgeBaseSourceCatalogWithConfig(
  config: Config,
  options: KnowledgeBaseSourceCatalogOptions = {},
): Promise<KnowledgeBaseSourceCatalog> {
  const signal = operationSignal(options)
  throwIfAborted(signal)
  const offset = sourceCatalogOffset(options.offset)
  const limit = sourceCatalogLimit(options.limit)
  const [manifest, filePage] = await Promise.all([
    readIndexManifestHeader(config),
    readIndexManifestFilePage(config, offset, limit),
  ])
  throwIfAborted(signal)
  const identity = knowledgeBaseIdentity(config.projectRoot)
  const health = manifest?.health
  const indexedFiles = (filePage?.files ?? []).map((file) => ({
    source: file.relativePath,
    chunks: file.chunkCount,
  }))
  const missingFromIndex = health?.previews.missingFromIndex.slice(0, limit) ?? []
  const staleInIndex = health?.previews.staleInIndex.slice(0, limit) ?? []
  const emptyTextFiles = health?.previews.emptyTextFiles.slice(0, limit) ?? []

  return {
    knowledgeBaseId: identity?.id ?? null,
    totals: {
      indexedFiles: manifest?.fileCount ?? 0,
      chunks: manifest?.chunkCount ?? 0,
      missingFromIndex: health?.missingFromIndex ?? 0,
      staleInIndex: health?.staleInIndex ?? 0,
      emptyTextFiles: health?.emptyTextFiles ?? 0,
      skippedFiles: health?.skippedFiles ?? 0,
    },
    indexedFiles,
    missingFromIndex,
    staleInIndex,
    emptyTextFiles,
    skippedByReason: health?.skippedByReason ?? {},
    omitted: {
      indexedFiles: Math.max(0, (manifest?.fileCount ?? 0) - indexedFiles.length),
      missingFromIndex: Math.max(0, (health?.missingFromIndex ?? 0) - missingFromIndex.length),
      staleInIndex: Math.max(0, (health?.staleInIndex ?? 0) - staleInIndex.length),
      emptyTextFiles: Math.max(0, (health?.emptyTextFiles ?? 0) - emptyTextFiles.length),
    },
    page: {
      offset,
      limit,
      nextOffset: filePage?.nextOffset ?? null,
    },
  }
}

function sourceCatalogOffset(value: number | undefined): number {
  const offset = value ?? 0
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new Error("Source catalog offset must be a non-negative integer.")
  }
  return offset
}

function sourceCatalogLimit(value: number | undefined): number {
  const limit = value ?? SOURCE_CATALOG_LIMIT
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > MAX_SOURCE_CATALOG_LIMIT) {
    throw new Error(
      `Source catalog limit must be a positive integer no greater than ${MAX_SOURCE_CATALOG_LIMIT}.`,
    )
  }
  return limit
}
