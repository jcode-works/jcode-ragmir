import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import path from "node:path"

export const DEFAULT_CHAT_MODEL = "onnx-community/Qwen2.5-0.5B-Instruct"
export const DEFAULT_CHAT_MODEL_PATH = ".ragmir/models/chat"
export const DEFAULT_CHAT_ALLOW_REMOTE_MODELS = false
export const DEFAULT_CHAT_SETUP_ALLOW_REMOTE_MODELS = true
export const DEFAULT_CHAT_MAX_NEW_TOKENS = 384
export const DEFAULT_CHAT_CONTEXT_CHAR_LIMIT = 8_000
export const DEFAULT_CHAT_DTYPE = "q4"

const EMPTY_CONTEXT_ANSWER =
  "No relevant Ragmir passages were provided. Run `rgr doctor --fix` or broaden the question before using local chat."

export type ChatRole = "system" | "user" | "assistant"

export interface ChatMessage {
  role: ChatRole
  content: string
}

export interface ChatSource {
  source?: string
  relativePath: string
  chunkIndex: number
  text: string
  distance?: number | null
}

export interface TextGenerationOptions {
  max_new_tokens: number
  do_sample: boolean
}

export type TextGenerator = (
  messages: ChatMessage[],
  options: TextGenerationOptions,
) => Promise<unknown>

export interface GenerateChatAnswerOptions {
  cwd?: string
  question: string
  sources?: ChatSource[]
  model?: string
  modelPath?: string
  allowRemoteModels?: boolean
  maxNewTokens?: number
  contextCharLimit?: number
  dtype?: string
  systemPrompt?: string
  generator?: TextGenerator
}

export interface GenerateChatAnswerResult {
  question: string
  answer: string
  sources: ChatSource[]
  model: string
  modelPath: string
  allowRemoteModels: boolean
  maxNewTokens: number
  contextCharLimit: number
  emptyContext: boolean
}

export interface SetupChatModelOptions {
  cwd?: string
  model?: string
  modelPath?: string
  allowRemoteModels?: boolean
  dtype?: string
  generator?: TextGenerator
}

export interface SetupChatModelResult {
  model: string
  modelPath: string
  allowRemoteModels: boolean
  dtype: string
  ready: true
}

export interface DoctorOptions {
  cwd?: string
  modelPath?: string
}

export interface DoctorReport {
  node: string
  provider: "transformers"
  defaultModel: string
  defaultModelPath: string
  defaultAllowRemoteModels: boolean
  defaultSetupAllowsRemoteModels: boolean
  defaultMaxNewTokens: number
  defaultContextCharLimit: number
  defaultDtype: string
  transformersAvailable: boolean
  localModelPathExists: boolean
  ollamaRequired: false
  pythonRequired: false
  storesRawPrompts: false
}

interface TransformersEnv {
  localModelPath: string
  cacheDir: string
  allowRemoteModels: boolean
}

type PipelineFactory = (
  task: string,
  model: string,
  options?: Record<string, unknown>,
) => Promise<unknown>

interface TransformersModule {
  env: TransformersEnv
  pipeline: PipelineFactory
}

export async function generateChatAnswer(
  options: GenerateChatAnswerOptions,
): Promise<GenerateChatAnswerResult> {
  const question = options.question.trim()
  if (!question) {
    throw new Error("A non-empty question is required.")
  }

  const cwd = path.resolve(options.cwd ?? process.cwd())
  const model = options.model ?? process.env.RAGMIR_CHAT_MODEL ?? DEFAULT_CHAT_MODEL
  const modelPath = resolveFromCwd(
    cwd,
    options.modelPath ?? process.env.RAGMIR_CHAT_MODEL_PATH ?? DEFAULT_CHAT_MODEL_PATH,
  )
  const allowRemoteModels =
    options.allowRemoteModels ??
    readBooleanEnv("RAGMIR_CHAT_ALLOW_REMOTE_MODELS", DEFAULT_CHAT_ALLOW_REMOTE_MODELS)
  const maxNewTokens =
    options.maxNewTokens ??
    readPositiveIntEnv("RAGMIR_CHAT_MAX_NEW_TOKENS", DEFAULT_CHAT_MAX_NEW_TOKENS)
  const contextCharLimit =
    options.contextCharLimit ??
    readPositiveIntEnv("RAGMIR_CHAT_CONTEXT_CHAR_LIMIT", DEFAULT_CHAT_CONTEXT_CHAR_LIMIT)
  const sources = options.sources ?? []

  if (sources.length === 0) {
    return {
      question,
      answer: EMPTY_CONTEXT_ANSWER,
      sources,
      model,
      modelPath,
      allowRemoteModels,
      maxNewTokens,
      contextCharLimit,
      emptyContext: true,
    }
  }

  const messageOptions: Parameters<typeof buildChatMessages>[0] = {
    question,
    sources,
    contextCharLimit,
  }
  addStringOption(messageOptions, "systemPrompt", options.systemPrompt)
  const messages = buildChatMessages(messageOptions)
  const generator =
    options.generator ??
    (await transformerTextGenerator({
      model,
      modelPath,
      allowRemoteModels,
      dtype: options.dtype ?? process.env.RAGMIR_CHAT_DTYPE ?? DEFAULT_CHAT_DTYPE,
    }))
  const output = await generator(messages, {
    max_new_tokens: maxNewTokens,
    do_sample: false,
  })
  const answer = ensureAnswerCitations(extractGeneratedAnswer(output), sources.length)

  return {
    question,
    answer,
    sources,
    model,
    modelPath,
    allowRemoteModels,
    maxNewTokens,
    contextCharLimit,
    emptyContext: false,
  }
}

export async function setupChatModel(
  options: SetupChatModelOptions = {},
): Promise<SetupChatModelResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd())
  const model = options.model ?? process.env.RAGMIR_CHAT_MODEL ?? DEFAULT_CHAT_MODEL
  const modelPath = resolveFromCwd(
    cwd,
    options.modelPath ?? process.env.RAGMIR_CHAT_MODEL_PATH ?? DEFAULT_CHAT_MODEL_PATH,
  )
  const allowRemoteModels = options.allowRemoteModels ?? DEFAULT_CHAT_SETUP_ALLOW_REMOTE_MODELS
  const dtype = options.dtype ?? process.env.RAGMIR_CHAT_DTYPE ?? DEFAULT_CHAT_DTYPE

  await mkdir(modelPath, { recursive: true })
  if (!options.generator) {
    await transformerTextGenerator({ model, modelPath, allowRemoteModels, dtype })
  }

  return {
    model,
    modelPath,
    allowRemoteModels,
    dtype,
    ready: true,
  }
}

export async function doctor(options: DoctorOptions = {}): Promise<DoctorReport> {
  const cwd = path.resolve(options.cwd ?? process.cwd())
  const modelPath = resolveFromCwd(
    cwd,
    options.modelPath ?? process.env.RAGMIR_CHAT_MODEL_PATH ?? DEFAULT_CHAT_MODEL_PATH,
  )

  return {
    node: process.versions.node,
    provider: "transformers",
    defaultModel: DEFAULT_CHAT_MODEL,
    defaultModelPath: DEFAULT_CHAT_MODEL_PATH,
    defaultAllowRemoteModels: DEFAULT_CHAT_ALLOW_REMOTE_MODELS,
    defaultSetupAllowsRemoteModels: DEFAULT_CHAT_SETUP_ALLOW_REMOTE_MODELS,
    defaultMaxNewTokens: DEFAULT_CHAT_MAX_NEW_TOKENS,
    defaultContextCharLimit: DEFAULT_CHAT_CONTEXT_CHAR_LIMIT,
    defaultDtype: DEFAULT_CHAT_DTYPE,
    transformersAvailable: await canImportTransformers(),
    localModelPathExists: existsSync(modelPath),
    ollamaRequired: false,
    pythonRequired: false,
    storesRawPrompts: false,
  }
}

export function buildChatMessages(options: {
  question: string
  sources: ChatSource[]
  contextCharLimit?: number
  systemPrompt?: string
}): ChatMessage[] {
  const systemPrompt =
    options.systemPrompt ??
    [
      "You are Ragmir local chat.",
      "Answer only from the Ragmir context provided by the user.",
      "Cite evidence with bracketed source numbers like [1] or [2].",
      "If the context is insufficient, say what is missing instead of inventing facts.",
      "Keep the answer concise and do not mention hidden implementation details.",
    ].join(" ")

  return [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: [
        `Question:\n${options.question.trim()}`,
        "",
        `Ragmir context:\n${formatSources(
          options.sources,
          options.contextCharLimit ?? DEFAULT_CHAT_CONTEXT_CHAR_LIMIT,
        )}`,
      ].join("\n"),
    },
  ]
}

export function formatSources(sources: ChatSource[], contextCharLimit: number): string {
  if (sources.length === 0) {
    return "No relevant passages were retrieved."
  }

  const blocks: string[] = []
  let remaining = Math.max(0, contextCharLimit)
  for (const [index, source] of sources.entries()) {
    if (remaining <= 0) break

    const header = `[${index + 1}] ${source.relativePath}#${source.chunkIndex}`
    const normalizedText = source.text.replace(/\s+/gu, " ").trim()
    const availableForText = Math.max(0, remaining - header.length - 2)
    const text =
      normalizedText.length > availableForText
        ? `${normalizedText.slice(0, availableForText).trimEnd()} [truncated]`
        : normalizedText
    const block = `${header}\n${text}`
    blocks.push(block)
    remaining -= block.length + 2
  }
  return blocks.join("\n\n")
}

export function extractGeneratedAnswer(output: unknown): string {
  const first = Array.isArray(output) ? output[0] : output
  const generatedText = recordValue(first, "generated_text")
  const text = recordValue(first, "text")

  if (typeof generatedText === "string") {
    return nonEmptyGeneratedAnswer(generatedText)
  }
  if (Array.isArray(generatedText)) {
    const content = lastAssistantContent(generatedText)
    if (content) {
      return content
    }
  }
  if (typeof text === "string") {
    return nonEmptyGeneratedAnswer(text)
  }

  throw new Error("Transformers.js returned an unsupported text-generation response.")
}

export function ensureAnswerCitations(answer: string, sourceCount: number): string {
  const trimmed = answer.trim()
  if (sourceCount <= 0 || /\[[1-9][0-9]*\]/u.test(trimmed)) {
    return trimmed
  }
  return `${trimmed} [1]`
}

export function modelCacheExists(cwd = process.cwd()): boolean {
  return existsSync(
    path.resolve(cwd, process.env.RAGMIR_CHAT_MODEL_PATH ?? DEFAULT_CHAT_MODEL_PATH),
  )
}

async function transformerTextGenerator(options: {
  model: string
  modelPath: string
  allowRemoteModels: boolean
  dtype: string
}): Promise<TextGenerator> {
  const transformers = await importTransformers()
  transformers.env.localModelPath = options.modelPath
  transformers.env.cacheDir = options.modelPath
  transformers.env.allowRemoteModels = options.allowRemoteModels

  const generator = await transformers.pipeline("text-generation", options.model, {
    dtype: options.dtype,
  })
  if (!isTextGenerator(generator)) {
    throw new Error("Transformers.js did not return a text-generation pipeline.")
  }
  return generator
}

async function importTransformers(): Promise<TransformersModule> {
  const module: unknown = await import("@huggingface/transformers")
  if (!isTransformersModule(module)) {
    throw new Error("@huggingface/transformers did not expose the expected API.")
  }
  return module
}

async function canImportTransformers(): Promise<boolean> {
  try {
    await import("@huggingface/transformers")
    return true
  } catch {
    return false
  }
}

function isTransformersModule(value: unknown): value is TransformersModule {
  return isRecord(value) && isRecord(value.env) && typeof value.pipeline === "function"
}

function isTextGenerator(value: unknown): value is TextGenerator {
  return typeof value === "function"
}

function lastAssistantContent(messages: unknown[]): string | null {
  for (const message of [...messages].reverse()) {
    if (!isRecord(message)) continue
    const role = message.role
    const content = message.content
    if (role === "assistant" && typeof content === "string" && content.trim()) {
      return content.trim()
    }
  }
  for (const message of [...messages].reverse()) {
    if (!isRecord(message)) continue
    const content = message.content
    if (typeof content === "string" && content.trim()) {
      return content.trim()
    }
  }
  return null
}

function nonEmptyGeneratedAnswer(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error("Transformers.js returned an empty answer.")
  }
  return trimmed
}

function recordValue(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function resolveFromCwd(cwd: string, input: string): string {
  return path.isAbsolute(input) ? input : path.resolve(cwd, input)
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.toLowerCase()
  if (raw === "1" || raw === "true" || raw === "yes") {
    return true
  }
  if (raw === "0" || raw === "false" || raw === "no") {
    return false
  }
  return fallback
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined) {
    return fallback
  }
  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function addStringOption<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined,
): void {
  if (value !== undefined) {
    target[key] = value
  }
}
