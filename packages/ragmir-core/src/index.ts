export { accessLogUsageReport } from "./access-log.js"
export { loadConfig } from "./config.js"
export { destroyIndex } from "./destroy.js"
export { doctor } from "./doctor.js"
export { clearTransformersCache, pullEmbeddingModel } from "./embeddings.js"
export { evaluateGoldenQueries } from "./evaluate.js"
export {
  getIndexFreshnessWarning,
  getLexicalScanWarning,
  INDEX_SCHEMA_VERSION,
} from "./index-diagnostics.js"
export { audit, ingest } from "./ingest.js"
export { initProject } from "./init.js"
export { ingestionLimits } from "./limits.js"
export { serveMcp } from "./mcp.js"
export type {
  ConfigurePdfOcrOptions,
  ConfigurePdfOcrResult,
  ExtractPdfPageOptions,
  OcrExecutableStatus,
  PdfOcrEngine,
  PdfOcrEngineSelection,
  PdfOcrStatus,
} from "./ocr.js"
export { configurePdfOcr, extractPdfPage, inspectPdfOcr } from "./ocr.js"
export type { PackageManager, RagmirCommand } from "./package-manager.js"
export { detectPackageManager, kbCommand, ragmirCommand, rgrCommand } from "./package-manager.js"
export type { PromptRouteDecision, PromptRouteTool } from "./prompt-routing.js"
export { routePrompt } from "./prompt-routing.js"
export { ask, search } from "./query.js"
export { redactText } from "./redaction.js"
export { compactResearchReport, compactSearchResults, research } from "./research.js"
export { securityAudit } from "./security.js"
export { enableSemanticEmbeddings } from "./semantic-config.js"
export type { SetupOptions, SetupResult, SetupSemanticResult } from "./setup.js"
export { setupProject } from "./setup.js"
export type {
  AgentHelperFile,
  AgentInstallMode,
  AgentInstallScope,
  AgentSkillInstallation,
  AgentTarget,
  InstallAgentSkillsOptions,
  InstallAgentSkillsResult,
  InstallSkillOptions,
  InstallSkillResult,
} from "./skill.js"
export {
  bundledSkillPath,
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
  AccessLogAction,
  AccessLogUsageOptions,
  AccessLogUsageReport,
  AskResult,
  AuditReport,
  CodeEvidence,
  CompactSearchResult,
  Config,
  DestroyIndexResult,
  DoctorReport,
  EvaluationCaseResult,
  EvaluationOptions,
  EvaluationResult,
  GoldenQuery,
  IndexManifest,
  IndexManifestFile,
  IngestionLimitsReport,
  IngestResult,
  ParsedPage,
  PrivacyProfile,
  ResearchEvidence,
  ResearchOptions,
  ResearchReport,
  RetrievalProfile,
  SearchContextChunk,
  SearchResult,
  SecurityAuditReport,
  SourceDiagnostics,
  SourceDuplicateCandidate,
  SourcePathCandidate,
} from "./types.js"
export { VERSION } from "./version.js"
