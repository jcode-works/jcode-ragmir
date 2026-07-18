import type { CompactJsonValue } from "./mcp-output.js"
import type { PromptRouteDecision } from "./prompt-routing.js"
import type {
  AccessLogUsageReport,
  AuditReport,
  Config,
  EvaluationResult,
  KnowledgeBaseContextReport,
  KnowledgeBaseSourceCatalog,
  SecurityAuditReport,
} from "./types.js"

interface McpStatusOutput {
  knowledgeBaseId: string | null
  privacyProfile: Config["privacyProfile"]
  retrievalProfile: Config["retrievalProfile"]
  embeddingProvider: Config["embeddingProvider"]
  embeddingModelRevision: string
  llmGeneration: boolean
  redactionEnabled: boolean
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
      privacyProfile: value.privacyProfile,
      retrievalProfile: value.retrievalProfile,
      embeddingProvider: value.embeddingProvider,
      embeddingModelRevision: value.embeddingModelRevision,
      llmGeneration: value.llmGeneration,
      redactionEnabled: value.redactionEnabled,
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

export function compactRouteOutput(value: PromptRouteDecision): CompactJsonValue {
  return {
    value: {
      shouldUseRagmir: value.shouldUseRagmir,
      confidence: value.confidence,
      tool: value.tool,
      reason: value.reason,
      matchedSignalCount: value.matchedSignals.length,
      safeguardCount: value.safeguards.length,
      queryIncluded: false,
    },
    omittedItems: value.matchedSignals.length + value.safeguards.length + 1,
  }
}

export function compactContextOutput(value: KnowledgeBaseContextReport): CompactJsonValue {
  const nextSteps = value.nextSteps.slice(0, 1)
  return {
    value: {
      knowledgeBaseId: value.knowledgeBaseId,
      privacyProfile: value.privacyProfile,
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

type McpEvaluationOutput = EvaluationResult & {
  minimumRecall?: number
  legacyRecallPassed?: boolean
}

export function compactEvaluationOutput(value: McpEvaluationOutput): CompactJsonValue {
  const omittedCases = (value.omittedCases ?? 0) + value.cases.length
  const groupCount =
    Object.keys(value.groups.categories).length + Object.keys(value.groups.locales).length
  return {
    value: {
      goldenPath: value.goldenPath,
      embeddingProvider: value.embeddingProvider,
      retrievalProfile: value.retrievalProfile,
      topK: value.topK,
      total: value.total,
      hits: value.hits,
      misses: value.misses,
      recall: value.recall,
      precision: value.precision,
      meanReciprocalRank: value.meanReciprocalRank,
      ndcg: value.ndcg,
      exactCitationRate: value.exactCitationRate,
      falsePositiveRate: value.falsePositiveRate,
      abstentionAccuracy: value.abstentionAccuracy,
      passed: value.passed,
      verificationEligible: value.verificationEligible,
      reportStored: value.reportStored,
      p50LatencyMs: value.p50LatencyMs,
      p95LatencyMs: value.p95LatencyMs,
      ...(value.minimumRecall === undefined ? {} : { minimumRecall: value.minimumRecall }),
      ...(value.legacyRecallPassed === undefined
        ? {}
        : { legacyRecallPassed: value.legacyRecallPassed }),
      previews: { cases: [] },
      omitted: {
        cases: omittedCases,
        gates: value.gates.length,
        groups: groupCount,
      },
    },
    omittedItems: omittedCases + value.gates.length + groupCount,
  }
}

export function compactSecurityOutput(value: SecurityAuditReport): CompactJsonValue {
  return {
    value: {
      projectRoot: value.projectRoot,
      zeroTelemetry: value.zeroTelemetry,
      privacyProfile: value.privacyProfile,
      retrievalProfile: value.retrievalProfile,
      providers: {
        embedding: value.providers.embedding,
        transformersAllowRemoteModels: value.providers.transformersAllowRemoteModels,
        llmGeneration: value.providers.llmGeneration,
      },
      redaction: {
        enabled: value.redaction.enabled,
        builtIn: value.redaction.builtIn,
        customPatternCount: value.redaction.customPatterns.length,
      },
      accessLog: {
        enabled: value.accessLog.enabled,
        storesRawQueries: value.accessLog.storesRawQueries,
      },
      storage: {
        gitIgnored: value.storage.gitIgnored,
        encryptedAtRest: value.storage.encryptedAtRest,
      },
      externalExtractors: value.externalExtractors,
      permissions: value.permissions,
      mcp: value.mcp,
      gitignore: value.gitignore,
      warningCount: value.warnings.length,
      recommendationCount: value.recommendations.length,
      privatePathCount: value.privatePaths.length,
    },
    omittedItems:
      value.redaction.customPatterns.length +
      value.warnings.length +
      value.recommendations.length +
      value.privatePaths.length,
  }
}

export function compactUsageOutput(value: AccessLogUsageReport): CompactJsonValue {
  return {
    value: {
      accessLogEnabled: value.accessLogEnabled,
      since: value.since,
      until: value.until,
      totalEvents: value.totalEvents,
      invalidLines: value.invalidLines,
      uniqueQueryHashes: value.uniqueQueryHashes,
      averageResultCount: value.averageResultCount,
      mcpOutput: value.mcpOutput,
      lastEventAt: value.lastEventAt,
      omittedSections: 2,
    },
    omittedItems:
      Object.keys(value.eventsByAction).length +
      Object.keys(value.averageResultCountByAction).length,
  }
}

export function mcpPreviewLimit(maxBytes: number): number {
  return Math.max(1, Math.min(200, Math.floor(maxBytes / 512)))
}
