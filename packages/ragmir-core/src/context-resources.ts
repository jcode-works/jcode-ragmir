import { loadConfig } from "./config.js"
import { doctor } from "./doctor.js"
import { audit } from "./ingest.js"
import { knowledgeBaseIdentity } from "./knowledge-bases.js"
import { operationSignal, throwIfAborted } from "./operation.js"
import type {
  KnowledgeBaseContextReport,
  KnowledgeBaseSourceCatalog,
  OperationOptions,
  SkippedSourceFile,
} from "./types.js"

const SOURCE_CATALOG_LIMIT = 50
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
  throwIfAborted(signal)
  const report = await doctor(config.projectRoot, signal ? { signal } : {})
  throwIfAborted(signal)
  const identity = knowledgeBaseIdentity(config.projectRoot)

  return {
    knowledgeBaseId: identity?.id ?? null,
    projectRoot: config.privacyProfile === "strict" ? "." : config.projectRoot,
    privacyProfile: config.privacyProfile,
    retrievalProfile: config.retrievalProfile,
    embeddingProvider: config.embeddingProvider,
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
  options: OperationOptions = {},
): Promise<KnowledgeBaseSourceCatalog> {
  const signal = operationSignal(options)
  throwIfAborted(signal)
  const config = await loadConfig(cwd)
  throwIfAborted(signal)
  const report = await audit(config.projectRoot, signal ? { signal } : {})
  throwIfAborted(signal)
  const identity = knowledgeBaseIdentity(config.projectRoot)
  const indexedFiles = report.indexedFiles.slice(0, SOURCE_CATALOG_LIMIT)
  const missingFromIndex = report.missingFromIndex.slice(0, SOURCE_CATALOG_LIMIT)
  const staleInIndex = report.staleInIndex.slice(0, SOURCE_CATALOG_LIMIT)
  const emptyTextFiles = report.emptyTextFiles.slice(0, SOURCE_CATALOG_LIMIT)

  return {
    knowledgeBaseId: identity?.id ?? null,
    totals: {
      indexedFiles: report.indexedFiles.length,
      chunks: report.totalChunks,
      missingFromIndex: report.missingFromIndex.length,
      staleInIndex: report.staleInIndex.length,
      emptyTextFiles: report.emptyTextFiles.length,
      skippedFiles: report.skippedFiles.length,
    },
    indexedFiles,
    missingFromIndex,
    staleInIndex,
    emptyTextFiles,
    skippedByReason: skippedCounts(report.skippedFiles),
    omitted: {
      indexedFiles: report.indexedFiles.length - indexedFiles.length,
      missingFromIndex: report.missingFromIndex.length - missingFromIndex.length,
      staleInIndex: report.staleInIndex.length - staleInIndex.length,
      emptyTextFiles: report.emptyTextFiles.length - emptyTextFiles.length,
    },
  }
}

function skippedCounts(skippedFiles: SkippedSourceFile[]): Record<string, number> {
  const counts = new Map<string, number>()
  for (const skipped of skippedFiles) {
    counts.set(skipped.reason, (counts.get(skipped.reason) ?? 0) + 1)
  }
  return Object.fromEntries(
    [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)),
  )
}
