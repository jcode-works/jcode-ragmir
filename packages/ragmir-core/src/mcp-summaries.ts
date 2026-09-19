import type { CompactJsonValue } from "./mcp-output.js"
import type {
  AuditReport,
  Config,
  KnowledgeBaseContextReport,
  KnowledgeBaseSourceCatalog,
} from "./types.js"

interface McpStatusOutput {
  knowledgeBaseId: string | null
  retrievalProfile: Config["retrievalProfile"]
  embeddingProvider: Config["embeddingProvider"]
  embeddingModelRevision: string
  llmGeneration: boolean
  mcpMaxTopK: number
  mcpMaxOutputBytes: number
  ready: boolean
  corpusFingerprint: string | null
  chunksIndexed: number
}

export function compactStatusOutput(value: McpStatusOutput): CompactJsonValue {
  const omittedFields = Math.max(0, Object.keys(value).length - 12)
  return {
    value: {
      knowledgeBaseId: value.knowledgeBaseId,
      retrievalProfile: value.retrievalProfile,
      embeddingProvider: value.embeddingProvider,
      embeddingModelRevision: value.embeddingModelRevision,
      llmGeneration: value.llmGeneration,
      mcpMaxTopK: value.mcpMaxTopK,
      mcpMaxOutputBytes: value.mcpMaxOutputBytes,
      ready: value.ready,
      corpusFingerprint: value.corpusFingerprint,
      chunksIndexed: value.chunksIndexed,
      omittedFields,
    },
    omittedItems: omittedFields,
  }
}

export function compactContextOutput(value: KnowledgeBaseContextReport): CompactJsonValue {
  const nextSteps = value.nextSteps.slice(0, 1)
  return {
    value: {
      knowledgeBaseId: value.knowledgeBaseId,
      retrievalProfile: value.retrievalProfile,
      corpusFingerprint: value.corpusFingerprint,
      ready: value.ready,
      coverage: value.coverage,
      indexFreshness: value.indexFreshness,
      securityWarningCount: value.securityWarningCount,
      routing: value.routing,
      previews: { nextSteps },
      omitted: {
        nextSteps: value.nextSteps.length - nextSteps.length,
        tools: value.tools.length,
        resources: value.resources.length,
      },
    },
    omittedItems:
      value.nextSteps.length - nextSteps.length + value.tools.length + value.resources.length,
  }
}

export function compactSourcesOutput(value: KnowledgeBaseSourceCatalog): CompactJsonValue {
  const omitted = {
    indexedFiles: value.omitted.indexedFiles + value.indexedFiles.length,
    missingFromIndex: value.omitted.missingFromIndex + value.missingFromIndex.length,
    staleInIndex: value.omitted.staleInIndex + value.staleInIndex.length,
    emptyTextFiles: value.omitted.emptyTextFiles + value.emptyTextFiles.length,
  }
  return {
    value: {
      knowledgeBaseId: value.knowledgeBaseId,
      totals: value.totals,
      previews: {
        indexedFiles: [],
        missingFromIndex: [],
        staleInIndex: [],
        emptyTextFiles: [],
      },
      skippedReasonCount: Object.keys(value.skippedByReason).length,
      omitted,
      page: value.page,
    },
    omittedItems: Object.values(omitted).reduce((total, count) => total + count, 0),
  }
}

export function compactAuditOutput(value: AuditReport): CompactJsonValue {
  const omitted = value.omitted ?? emptyAuditOmissions()
  const counts = {
    indexedFiles: value.indexedFiles.length + omitted.indexedFiles,
    supportedFiles: value.supportedFiles.length + omitted.supportedFiles,
    skippedFiles: value.skippedFiles.length + omitted.skippedFiles,
    emptyTextFiles: value.emptyTextFiles.length + omitted.emptyTextFiles,
    duplicateCandidates:
      value.sourceDiagnostics.duplicateCandidates.length + omitted.duplicateCandidates,
    archiveCandidates: value.sourceDiagnostics.archiveCandidates.length + omitted.archiveCandidates,
    mirrorCandidates: value.sourceDiagnostics.mirrorCandidates.length + omitted.mirrorCandidates,
    missingFromIndex: value.missingFromIndex.length + omitted.missingFromIndex,
    staleInIndex: value.staleInIndex.length + omitted.staleInIndex,
  }
  return {
    value: {
      mode: value.mode,
      inventoryVerified: value.inventoryVerified,
      cost: value.cost,
      discoveredFiles: value.discoveredFiles,
      supportedBytes: value.supportedBytes,
      largestFileBytes: value.largestFileBytes,
      totalChunks: value.totalChunks,
      chunkStats: value.chunkStats,
      counts,
      previews: {
        missingFromIndex: [],
        staleInIndex: [],
      },
      omitted: counts,
    },
    omittedItems: Object.values(counts).reduce((total, count) => total + count, 0),
  }
}

function emptyAuditOmissions(): NonNullable<AuditReport["omitted"]> {
  return {
    indexedFiles: 0,
    supportedFiles: 0,
    skippedFiles: 0,
    emptyTextFiles: 0,
    duplicateCandidates: 0,
    archiveCandidates: 0,
    mirrorCandidates: 0,
    missingFromIndex: 0,
    staleInIndex: 0,
  }
}

export function mcpPreviewLimit(maxBytes: number): number {
  return Math.max(1, Math.min(200, Math.floor(maxBytes / 512)))
}
