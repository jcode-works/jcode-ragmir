import {
  enableSemanticEmbeddings,
  ingest,
  pullEmbeddingModel,
  redactText,
  search,
  type Config,
  type EnableSemanticEmbeddingsResult,
  type IngestOptions,
  type PullEmbeddingModelResult,
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
void generateChatAnswer(chatOptions)
void renderSpeech(speechOptions)

declare const config: Config
const semanticResult: Promise<EnableSemanticEmbeddingsResult> = enableSemanticEmbeddings(cwd)
const pullResult: Promise<PullEmbeddingModelResult> = pullEmbeddingModel(config)
const redactions: RedactionCount[] = redactText("example", config).counts

void semanticResult
void pullResult
void redactions
