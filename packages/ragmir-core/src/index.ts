export type { AccessLogWriterMetrics } from "./access-log.js"
export { accessLogUsageReport, accessLogWriterMetrics, flushAccessLog } from "./access-log.js"
export type { RagmirClientOptions } from "./client.js"
export { createRagmirClient, RagmirClient } from "./client.js"
export { loadConfig } from "./config.js"
export {
  getKnowledgeBaseContext,
  getKnowledgeBaseSourceCatalog,
} from "./context-resources.js"
export { destroyIndex } from "./destroy.js"
export { doctor } from "./doctor.js"
export type { PullEmbeddingModelResult } from "./embeddings.js"
export { clearTransformersCache, pullEmbeddingModel } from "./embeddings.js"
export type { RagmirErrorCode } from "./errors.js"
export { isRagmirError, normalizeRagmirError, RagmirError } from "./errors.js"
export { evaluateGoldenQueries } from "./evaluate.js"
export type {
  CollectGenerationGarbageOptions,
  GenerationGarbageCollectionReport,
  GenerationInventoryItem,
  GenerationRole,
} from "./generation-retention.js"
export { collectGenerationGarbage } from "./generation-retention.js"
export {
  getIndexFreshnessWarning,
  getLexicalScanWarning,
  INDEX_SCHEMA_VERSION,
} from "./index-diagnostics.js"
export { audit, ingest } from "./ingest.js"
export type { IngestionDiagnosticsEvent } from "./ingestion-metrics.js"
export { INGESTION_DIAGNOSTICS_CHANNEL } from "./ingestion-metrics.js"
export { getIngestionProgress } from "./ingestion-state.js"
export { initProject } from "./init.js"
export { discoverKnowledgeBases, knowledgeBaseIdentity } from "./knowledge-bases.js"
export { ingestionLimits } from "./limits.js"
export { connectMcpServer, createMcpServer, serveMcp } from "./mcp.js"
export type {
  ConfigurePdfOcrOptions,
  ConfigurePdfOcrResult,
  ExtractPdfPageOptions,
  ExtractPdfPagesOptions,
  ExtractPdfPagesResult,
  OcrExecutableStatus,
  PdfOcrEngine,
  PdfOcrEngineSelection,
  PdfOcrStatus,
} from "./ocr.js"
export { configurePdfOcr, extractPdfPage, extractPdfPages, inspectPdfOcr } from "./ocr.js"
export type { PackageManager, RagmirCommand } from "./package-manager.js"
export { detectPackageManager, kbCommand, ragmirCommand, rgrCommand } from "./package-manager.js"
export { previewChunks } from "./preview.js"
export type { PromptRouteDecision, PromptRouteTool } from "./prompt-routing.js"
export { routePrompt } from "./prompt-routing.js"
export { ask, expandCitation, search } from "./query.js"
export { redactText } from "./redaction.js"
export { compactResearchReport, compactSearchResults, research } from "./research.js"
export { securityAudit } from "./security.js"
export type { EnableSemanticEmbeddingsResult } from "./semantic-config.js"
export { enableSemanticEmbeddings } from "./semantic-config.js"
export type { SetupOptions, SetupResult, SetupSemanticResult } from "./setup.js"
export { setupProject } from "./setup.js"
export type {
  AgentHelperFile,
  AgentInstallMode,
  AgentInstallScope,
  AgentIntegrationReport,
  AgentSkillInstallation,
  AgentTarget,
  InstallAgentSkillsOptions,
  InstallAgentSkillsResult,
  InstallSkillOptions,
  InstallSkillResult,
  RagmirRunnerMode,
} from "./skill.js"
export {
  bundledSkillPath,
  inspectAgentIntegration,
  installAgentSkills,
  installSkill,
  parseAgentTargets,
  SUPPORTED_AGENT_TARGETS,
} from "./skill.js"
export type {
  AddSourceEntriesOptions,
  AddSourceEntriesResult,
  SourceEntriesResult,
} from "./sources.js"
export { addSourceEntries, listSourceEntries } from "./sources.js"
export type {
  OptimizeStorageOptions,
  StorageMaintenanceAction,
  StorageMaintenanceReason,
  StorageMaintenanceReport,
} from "./storage-maintenance.js"
export { optimizeStorage } from "./storage-maintenance.js"
export type {
  CreateTeamSnapshotOptions,
  TeamChangedFile,
  TeamComparison,
  TeamComparisonStatus,
  TeamConfigurationDifference,
  TeamSnapshot,
  TeamSnapshotFile,
} from "./team-diagnostics.js"
export {
  compareTeamSnapshots,
  createTeamSnapshot,
  readTeamSnapshot,
  writeTeamSnapshot,
} from "./team-diagnostics.js"
export type {
  AccessLogAction,
  AccessLogUsageOptions,
  AccessLogUsageReport,
  AskResult,
  AuditOptions,
  AuditReport,
  ChunkStats,
  CodeEvidence,
  CompactSearchResult,
  Config,
  DestroyIndexResult,
  DoctorOptions,
  DoctorReport,
  EvaluationCaseResult,
  EvaluationOptions,
  EvaluationResult,
  ExpandCitationOptions,
  ExpandedCitation,
  GoldenQuery,
  IncrementalFailurePolicy,
  IndexHealthSnapshot,
  IndexMaintenanceSnapshot,
  IndexManifest,
  IndexManifestFile,
  IndexManifestStaleFile,
  IngestionEmbeddingModelState,
  IngestionFileStage,
  IngestionLimitsReport,
  IngestionMetrics,
  IngestionPhaseDurations,
  IngestionProgress,
  IngestionRunMode,
  IngestionRunStatus,
  IngestionThroughputMetrics,
  IngestOptions,
  IngestResult,
  KnowledgeBaseContextReport,
  KnowledgeBaseIdentity,
  KnowledgeBaseInfo,
  KnowledgeBaseInventory,
  KnowledgeBaseSourceCatalog,
  KnowledgeBaseSourceCatalogOptions,
  McpOutputTool,
  McpOutputUsageReport,
  OperationOptions,
  ParsedPage,
  PdfOcrMetrics,
  PreviewChunk,
  PreviewChunksOptions,
  PreviewFile,
  PreviewReport,
  PrivacyProfile,
  RedactionCount,
  ResearchEvidence,
  ResearchOptions,
  ResearchReport,
  RetrievalProfile,
  RuntimeInfo,
  RuntimePackageVersion,
  SearchContextChunk,
  SearchOptions,
  SearchResult,
  SearchScoreExplanation,
  SecurityAuditOptions,
  SecurityAuditReport,
  SourceDiagnostics,
  SourceDuplicateCandidate,
  SourcePathCandidate,
  VectorIndexManifest,
  VectorIndexParameters,
  VectorIndexStrategy,
} from "./types.js"
export type {
  UpgradeInspection,
  UpgradeOptions,
  UpgradeResult,
  UpgradeStatus,
} from "./upgrade.js"
export { inspectUpgrade, upgradeProject } from "./upgrade.js"
export type {
  AdaptiveIndexAction,
  AdaptiveIndexMaintenanceReport,
  ScalarIndexStatus,
} from "./vector-index.js"
export { VERSION } from "./version.js"
