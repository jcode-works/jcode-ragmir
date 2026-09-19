import {
  audit,
  connectMcpServer,
  createMcpServer,
  createRagmirClient,
  doctor,
  disposeTransformersCache,
  disposeTransformersModel,
  enableSemanticEmbeddings,
  evaluateGoldenQueries,
  expandCitation,
  getKnowledgeBaseContext,
  getKnowledgeBaseSourceCatalog,
  ingest,
  INGESTION_DIAGNOSTICS_CHANNEL,
  inspectUpgrade,
  isRagmirError,
  pullEmbeddingModel,
  search,
  securityAudit,
  upgradeProject,
  type Config,
  type EnableSemanticEmbeddingsResult,
  type EvidenceVersion,
  type IngestionDiagnosticsEvent,
  type IngestionMetrics,
  type IngestOptions,
  type OperationOptions,
  type PullEmbeddingModelResult,
  type RagmirClient,
  type RagmirErrorCode,
  type SearchOptions,
} from "@jcode.labs/ragmir"

const cwd = process.cwd()
const ingestOptions = { cwd, rebuild: false, collectMetrics: true } satisfies IngestOptions
const ingestionDiagnosticsChannel: string = INGESTION_DIAGNOSTICS_CHANNEL
const ingestionDiagnostic: IngestionDiagnosticsEvent | undefined = undefined
void ingestionDiagnosticsChannel
void ingestionDiagnostic
const searchOptions = { cwd, topK: 5, explain: true } satisfies SearchOptions
const operationOptions = {
  signal: AbortSignal.timeout(5_000),
  timeoutMs: 10_000,
} satisfies OperationOptions

void ingest(ingestOptions).then((result) => {
  const metrics: IngestionMetrics | undefined = result.metrics
  void metrics
})
void search("What changed?", searchOptions).then((results) => {
  const evidence: EvidenceVersion | undefined = results[0]?.evidence
  const retrievalQuery: string | undefined = results[0]?.score?.retrievalQuery
  if (results[0] && evidence) {
    void expandCitation(results[0].citation, { cwd, expectedEvidenceId: evidence.id })
  }
  void retrievalQuery
  const rankingPolicyFingerprint: string | undefined =
    results[0]?.score?.rankingPolicyFingerprint
  const lexicalFallbackReason:
    | "fts-index-unavailable"
    | "fts-query-failed"
    | null
    | undefined = results[0]?.score?.lexicalFallbackReason
  void rankingPolicyFingerprint
  void lexicalFallbackReason
  const lexicalExactPathMatch: boolean | undefined = results[0]?.score?.lexicalExactPathMatch
  void lexicalExactPathMatch
  const workloadQueueMs: number | undefined = results[0]?.score?.workloadQueueMs
  void workloadQueueMs
})
void createRagmirClient({ cwd }).then(async (client: RagmirClient) => {
  await client.search("What changed?", operationOptions)
  await client.status(operationOptions)
  await client.sources(operationOptions)
  await client.close()
})
void audit(cwd, operationOptions)
void doctor(cwd, operationOptions)
void securityAudit(cwd, operationOptions)
void getKnowledgeBaseContext(cwd, operationOptions)
void getKnowledgeBaseSourceCatalog(cwd, operationOptions)
void evaluateGoldenQueries({ cwd, goldenPath: "golden-queries.json", ...operationOptions })
void inspectUpgrade(cwd)
void upgradeProject({ cwd })
type McpTransport = Parameters<typeof connectMcpServer>[0]
declare const transport: McpTransport
void connectMcpServer(transport, cwd)
void isRagmirError(new Error("example"))

declare const config: Config
const disposedModels: Promise<void> = disposeTransformersCache()
const disposedModel: Promise<void> = disposeTransformersModel(config)
const semanticResult: Promise<EnableSemanticEmbeddingsResult> = enableSemanticEmbeddings(cwd)
const pullResult: Promise<PullEmbeddingModelResult> = pullEmbeddingModel(config)
const errorCode: RagmirErrorCode = "TIMEOUT"
const indexErrorCode: RagmirErrorCode = "INDEX_UNAVAILABLE"
const overloadedErrorCode: RagmirErrorCode = "OVERLOADED"
const changedEvidenceErrorCode: RagmirErrorCode = "EVIDENCE_CHANGED"

void semanticResult
void disposedModels
void disposedModel
void pullResult
void errorCode
void indexErrorCode
void overloadedErrorCode
void changedEvidenceErrorCode

void createMcpServer(cwd)
