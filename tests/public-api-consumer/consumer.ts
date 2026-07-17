import {
  accessLogUsageReport,
  accessLogWriterMetrics,
  audit,
  connectMcpServer,
  createMcpServer,
  createRagmirClient,
  doctor,
  enableSemanticEmbeddings,
  evaluateGoldenQueries,
  flushAccessLog,
  getKnowledgeBaseContext,
  getKnowledgeBaseSourceCatalog,
  ingest,
  isRagmirError,
  pullEmbeddingModel,
  redactText,
  research,
  search,
  securityAudit,
  type Config,
  type AccessLogWriterMetrics,
  type EnableSemanticEmbeddingsResult,
  type IngestOptions,
  type OperationOptions,
  type PullEmbeddingModelResult,
  type RagmirClient,
  type RagmirErrorCode,
  type RedactionCount,
  type ResearchOptions,
  type SearchOptions,
} from "@jcode.labs/ragmir"
import {
  generateChatAnswer,
  type ChatSource,
  type GenerateChatAnswerOptions,
} from "@jcode.labs/ragmir-chat"
import { renderSpeech, type RenderSpeechOptions } from "@jcode.labs/ragmir-tts"

const cwd = process.cwd()
const ingestOptions = { cwd, rebuild: false } satisfies IngestOptions
const searchOptions = { cwd, topK: 5, explain: true } satisfies SearchOptions
const researchOptions = {
  cwd,
  topK: 5,
  timeoutMs: 10_000,
  codeTopK: 10,
  codeScanMaxFiles: 500,
  codeScanMaxBytes: 8 * 1024 * 1024,
  codeScanConcurrency: 4,
} satisfies ResearchOptions
const operationOptions = {
  signal: AbortSignal.timeout(5_000),
  timeoutMs: 10_000,
} satisfies OperationOptions
const source = {
  relativePath: "docs/decision.md",
  chunkIndex: 0,
  text: "The review moved the rollout to Monday.",
} satisfies ChatSource
const chatOptions = {
  cwd,
  question: "What changed?",
  sources: [source],
  profile: "lite",
} satisfies GenerateChatAnswerOptions
const speechOptions = {
  cwd,
  text: "The rollout moved to Monday.",
  outputPath: ".ragmir/audio/brief.wav",
  language: "en",
  engine: "transformers",
  allowRemoteModels: false,
  signal: operationOptions.signal,
  edgeTimeoutMs: 30_000,
} satisfies RenderSpeechOptions

void ingest(ingestOptions)
void search("What changed?", searchOptions).then((results) => {
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
void research("What changed?", researchOptions).then((report) => {
  const firstResearchScore: number | undefined = report.evidence[0]?.researchScore
  void firstResearchScore
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
void accessLogUsageReport({ cwd, ...operationOptions })
void createMcpServer(cwd)
type McpTransport = Parameters<typeof connectMcpServer>[0]
declare const transport: McpTransport
void connectMcpServer(transport, cwd)
void isRagmirError(new Error("example"))
void generateChatAnswer(chatOptions)
void renderSpeech(speechOptions)

declare const config: Config
const accessLogMetrics: AccessLogWriterMetrics = accessLogWriterMetrics(config)
const flushedAccessLog: Promise<AccessLogWriterMetrics> = flushAccessLog(config)
const semanticResult: Promise<EnableSemanticEmbeddingsResult> = enableSemanticEmbeddings(cwd)
const pullResult: Promise<PullEmbeddingModelResult> = pullEmbeddingModel(config)
const redactions: RedactionCount[] = redactText("example", config).counts
const errorCode: RagmirErrorCode = "TIMEOUT"
const indexErrorCode: RagmirErrorCode = "INDEX_UNAVAILABLE"
const overloadedErrorCode: RagmirErrorCode = "OVERLOADED"

void semanticResult
void accessLogMetrics
void flushedAccessLog
void pullResult
void redactions
void errorCode
void indexErrorCode
void overloadedErrorCode
