import {
  connectMcpServer,
  createMcpServer,
  createRagmirClient,
  enableSemanticEmbeddings,
  ingest,
  isRagmirError,
  pullEmbeddingModel,
  redactText,
  search,
  type Config,
  type EnableSemanticEmbeddingsResult,
  type IngestOptions,
  type OperationOptions,
  type PullEmbeddingModelResult,
  type RagmirClient,
  type RagmirErrorCode,
  type RedactionCount,
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
} satisfies RenderSpeechOptions

void ingest(ingestOptions)
void search("What changed?", searchOptions)
void createRagmirClient({ cwd }).then(async (client: RagmirClient) => {
  await client.search("What changed?", operationOptions)
  await client.close()
})
void createMcpServer(cwd)
type McpTransport = Parameters<typeof connectMcpServer>[0]
declare const transport: McpTransport
void connectMcpServer(transport, cwd)
void isRagmirError(new Error("example"))
void generateChatAnswer(chatOptions)
void renderSpeech(speechOptions)

declare const config: Config
const semanticResult: Promise<EnableSemanticEmbeddingsResult> = enableSemanticEmbeddings(cwd)
const pullResult: Promise<PullEmbeddingModelResult> = pullEmbeddingModel(config)
const redactions: RedactionCount[] = redactText("example", config).counts
const errorCode: RagmirErrorCode = "TIMEOUT"

void semanticResult
void pullResult
void redactions
void errorCode
