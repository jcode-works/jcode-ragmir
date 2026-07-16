import { spawn, spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export const DEFAULT_TTS_MODEL = "Xenova/mms-tts-fra"
export const DEFAULT_TTS_MODEL_PATH = ".ragmir/models/tts"
export const DEFAULT_AUDIO_DIR = ".ragmir/audio"
export const DEFAULT_TTS_ENGINE = "transformers"
export const DEFAULT_TTS_ALLOW_REMOTE_MODELS = false
export const DEFAULT_EDGE_VOICE = "fr-FR-DeniseNeural"
export const DEFAULT_EDGE_RATE = "+0%"
export const DEFAULT_EDGE_TTS_TIMEOUT_MS = 120_000
export const DEFAULT_TTS_LANGUAGE: TtsLanguage = "fr"
const MAX_EDGE_TTS_STDERR_BYTES = 65_536
const EDGE_TTS_KILL_GRACE_MS = 1_000

export type TtsEngine = "auto" | "edge" | "transformers"
export type OutputFormat = "mp3" | "wav"

export const TTS_LANGUAGES = ["en", "es", "fr", "ja", "th", "zh"] as const
export const OFFLINE_TTS_LANGUAGES = ["en", "es", "fr"] as const
export type TtsLanguage = (typeof TTS_LANGUAGES)[number]
export type OfflineTtsLanguage = (typeof OFFLINE_TTS_LANGUAGES)[number]

export function isTtsLanguage(value: string): value is TtsLanguage {
  return (TTS_LANGUAGES as readonly string[]).includes(value)
}

// Self-contained per-language MMS models (no phonemizer, no Python) for the offline path,
// and high-quality Microsoft neural voices for the online Edge path.
const MMS_MODEL_BY_LANGUAGE: Record<OfflineTtsLanguage, string> = {
  en: "Xenova/mms-tts-eng",
  es: "Xenova/mms-tts-spa",
  fr: DEFAULT_TTS_MODEL,
}
const EDGE_VOICE_BY_LANGUAGE: Record<TtsLanguage, string> = {
  en: "en-US-AriaNeural",
  es: "es-ES-ElviraNeural",
  fr: DEFAULT_EDGE_VOICE,
  ja: "ja-JP-NanamiNeural",
  th: "th-TH-PremwadeeNeural",
  zh: "zh-CN-XiaoxiaoNeural",
}

export interface TextToAudioOutputLike {
  save(path: string): Promise<void>
  sampling_rate?: number
  data?: Float32Array
}

export type TextToAudioSynthesizer = (
  text: string,
  options?: TextToAudioOptions,
) => Promise<TextToAudioOutputLike>

interface DisposableTextToAudioSynthesizer {
  (text: string, options?: TextToAudioOptions): Promise<TextToAudioOutputLike>
  dispose?: () => Promise<void>
}

declare global {
  var __ragmirTransformersEnvironmentQueue: Promise<void> | undefined
}

export interface TextToAudioOptions {
  speaker_embeddings?: string
  speed?: number
}

export interface RenderSpeechOptions {
  cwd?: string
  text?: string
  textFile?: string
  outputPath?: string
  engine?: TtsEngine
  language?: TtsLanguage
  model?: string
  modelPath?: string
  allowRemoteModels?: boolean
  voice?: string
  rate?: string
  speakerEmbeddings?: string
  speed?: number
  synthesizer?: TextToAudioSynthesizer
  edgeRenderer?: EdgeTtsRenderer
  edgeAvailable?: () => boolean
  signal?: AbortSignal
  edgeTimeoutMs?: number
}

export interface RenderSpeechResult {
  outputPath: string
  engine: Exclude<TtsEngine, "auto">
  language: TtsLanguage
  outputFormat: OutputFormat
  model: string | null
  modelPath: string
  allowRemoteModels: boolean
  voice: string | null
  rate: string | null
  samplingRate: number | null
  samples: number | null
}

export interface DoctorReport {
  node: string
  defaultEngine: TtsEngine
  defaultLanguage: TtsLanguage
  languages: TtsLanguage[]
  offlineLanguages: OfflineTtsLanguage[]
  edgeLanguages: TtsLanguage[]
  defaultModel: string
  defaultModelPath: string
  defaultAllowRemoteModels: boolean
  transformersAvailable: boolean
  edgeTtsAvailable: boolean
  edgeDefaultVoice: string
  pythonRequired: false
  ffmpegRequired: false
  outputFormat: "mp3-or-wav"
}

export type EdgeTtsRenderer = (options: EdgeTtsRenderOptions) => Promise<void>

export interface EdgeTtsRenderOptions {
  text: string
  outputPath: string
  voice: string
  rate: string
  timeoutMs: number
  signal?: AbortSignal
}

export async function renderSpeech(options: RenderSpeechOptions): Promise<RenderSpeechResult> {
  throwIfAborted(options.signal)
  const cwd = path.resolve(options.cwd ?? process.cwd())
  const text = await readInputText(options, cwd)
  throwIfAborted(options.signal)
  const engine = resolveEngine(options)
  const language = resolveLanguage(options)
  const modelPath = resolveFromCwd(
    cwd,
    options.modelPath ?? process.env.RAGMIR_TTS_MODEL_PATH ?? DEFAULT_TTS_MODEL_PATH,
  )
  const outputPath = resolveFromCwd(
    cwd,
    options.outputPath ?? defaultOutputPath(cwd, options.textFile, outputFormatForEngine(engine)),
  )
  const allowRemoteModels =
    options.allowRemoteModels ??
    readBooleanEnv("RAGMIR_TTS_ALLOW_REMOTE_MODELS", DEFAULT_TTS_ALLOW_REMOTE_MODELS)

  await mkdir(path.dirname(outputPath), { recursive: true })

  if (engine === "edge") {
    validateOutputFormat(outputPath, "mp3")
    const model =
      options.model ?? process.env.RAGMIR_TTS_MODEL ?? optionalMmsModelForLanguage(language)
    const voice =
      options.voice ?? process.env.RAGMIR_TTS_EDGE_VOICE ?? edgeVoiceForLanguage(language)
    const rate = options.rate ?? process.env.RAGMIR_TTS_EDGE_RATE ?? DEFAULT_EDGE_RATE
    const renderer = options.edgeRenderer ?? edgeCliRenderer
    const edgeAvailable = options.edgeAvailable ?? edgeTtsAvailable
    if (!options.edgeRenderer && !edgeAvailable()) {
      throw new Error(
        "edge-tts is required for the Edge engine. Install it with `pipx install edge-tts`.",
      )
    }
    const edgeOptions: EdgeTtsRenderOptions = {
      text,
      outputPath,
      voice,
      rate,
      timeoutMs: positiveInteger(
        options.edgeTimeoutMs ?? DEFAULT_EDGE_TTS_TIMEOUT_MS,
        "edgeTimeoutMs",
      ),
    }
    if (options.signal !== undefined) edgeOptions.signal = options.signal
    await renderer(edgeOptions)
    throwIfAborted(options.signal)

    return {
      outputPath,
      engine,
      language,
      outputFormat: "mp3",
      model,
      modelPath,
      allowRemoteModels,
      voice,
      rate,
      samplingRate: null,
      samples: null,
    }
  }

  validateOutputFormat(outputPath, "wav")
  const model = options.model ?? process.env.RAGMIR_TTS_MODEL ?? mmsModelForLanguage(language)
  const synthesizer: DisposableTextToAudioSynthesizer =
    options.synthesizer ?? (await transformerSynthesizer(model, modelPath, allowRemoteModels))
  const ownsSynthesizer = options.synthesizer === undefined
  let output: TextToAudioOutputLike
  try {
    throwIfAborted(options.signal)
    output = await synthesizer(text, textToAudioOptions(options))
    throwIfAborted(options.signal)
    await output.save(outputPath)
    throwIfAborted(options.signal)
  } finally {
    if (ownsSynthesizer) {
      await synthesizer.dispose?.()
    }
  }

  return {
    outputPath,
    engine,
    language,
    outputFormat: "wav",
    model,
    modelPath,
    allowRemoteModels,
    voice: null,
    rate: null,
    samplingRate: typeof output.sampling_rate === "number" ? output.sampling_rate : null,
    samples: output.data instanceof Float32Array ? output.data.length : null,
  }
}

export async function doctor(): Promise<DoctorReport> {
  return {
    node: process.versions.node,
    defaultEngine: DEFAULT_TTS_ENGINE,
    defaultLanguage: DEFAULT_TTS_LANGUAGE,
    languages: [...TTS_LANGUAGES],
    offlineLanguages: [...OFFLINE_TTS_LANGUAGES],
    edgeLanguages: [...TTS_LANGUAGES],
    defaultModel: DEFAULT_TTS_MODEL,
    defaultModelPath: DEFAULT_TTS_MODEL_PATH,
    defaultAllowRemoteModels: DEFAULT_TTS_ALLOW_REMOTE_MODELS,
    transformersAvailable: await canImportTransformers(),
    edgeTtsAvailable: edgeTtsAvailable(),
    edgeDefaultVoice: DEFAULT_EDGE_VOICE,
    pythonRequired: false,
    ffmpegRequired: false,
    outputFormat: "mp3-or-wav",
  }
}

async function readInputText(options: RenderSpeechOptions, cwd: string): Promise<string> {
  const text =
    options.text ??
    (options.textFile ? await readFile(resolveFromCwd(cwd, options.textFile), "utf8") : "")
  const trimmed = text.trim()
  if (!trimmed) {
    throw new Error("A non-empty text input or text file is required.")
  }
  return trimmed
}

function defaultOutputPath(
  cwd: string,
  textFile: string | undefined,
  format: OutputFormat,
): string {
  const name = textFile ? path.basename(textFile, path.extname(textFile)) : "ragmir-summary"
  return path.join(cwd, DEFAULT_AUDIO_DIR, `${name}.${format}`)
}

function resolveFromCwd(cwd: string, input: string): string {
  return path.isAbsolute(input) ? input : path.resolve(cwd, input)
}

function textToAudioOptions(options: RenderSpeechOptions): TextToAudioOptions | undefined {
  const output: TextToAudioOptions = {}
  if (options.speakerEmbeddings) {
    output.speaker_embeddings = options.speakerEmbeddings
  }
  if (typeof options.speed === "number") {
    output.speed = options.speed
  }
  return Object.keys(output).length > 0 ? output : undefined
}

async function transformerSynthesizer(
  model: string,
  modelPath: string,
  allowRemoteModels: boolean,
): Promise<DisposableTextToAudioSynthesizer> {
  return withTransformersEnvironment(async () => {
    const transformers = await import("@huggingface/transformers")
    const previous = {
      localModelPath: transformers.env.localModelPath,
      cacheDir: transformers.env.cacheDir,
      allowRemoteModels: transformers.env.allowRemoteModels,
    }
    transformers.env.localModelPath = modelPath
    transformers.env.cacheDir = modelPath
    transformers.env.allowRemoteModels = allowRemoteModels
    try {
      return (await transformers.pipeline(
        "text-to-speech",
        model,
      )) as DisposableTextToAudioSynthesizer
    } finally {
      transformers.env.localModelPath = previous.localModelPath
      transformers.env.cacheDir = previous.cacheDir
      transformers.env.allowRemoteModels = previous.allowRemoteModels
    }
  })
}

function withTransformersEnvironment<T>(operation: () => Promise<T>): Promise<T> {
  const queued = (globalThis.__ragmirTransformersEnvironmentQueue ?? Promise.resolve()).then(
    operation,
  )
  globalThis.__ragmirTransformersEnvironmentQueue = queued.then(
    () => undefined,
    () => undefined,
  )
  return queued
}

function resolveEngine(options: RenderSpeechOptions): Exclude<TtsEngine, "auto"> {
  if (options.synthesizer) {
    return "transformers"
  }

  const requested = options.engine ?? readEngineEnv() ?? DEFAULT_TTS_ENGINE
  if (requested === "edge" || requested === "transformers") {
    return requested
  }

  const outputFormat = options.outputPath ? formatFromPath(options.outputPath) : null
  if (outputFormat === "wav") {
    return "transformers"
  }
  if (outputFormat === "mp3") {
    return "edge"
  }

  const edgeAvailable = options.edgeAvailable ?? edgeTtsAvailable
  return edgeAvailable() ? "edge" : "transformers"
}

function outputFormatForEngine(engine: Exclude<TtsEngine, "auto">): OutputFormat {
  return engine === "edge" ? "mp3" : "wav"
}

function formatFromPath(filePath: string): OutputFormat | null {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === ".mp3") {
    return "mp3"
  }
  if (extension === ".wav") {
    return "wav"
  }
  return null
}

function validateOutputFormat(filePath: string, expected: OutputFormat): void {
  const actual = formatFromPath(filePath)
  if (actual && actual !== expected) {
    throw new Error(
      `The ${expected} engine cannot write ${actual} output. Use a .${expected} path.`,
    )
  }
}

function readEngineEnv(): TtsEngine | undefined {
  const raw = process.env.RAGMIR_TTS_ENGINE
  if (raw === "auto" || raw === "edge" || raw === "transformers") {
    return raw
  }
  return undefined
}

export function mmsModelForLanguage(language: TtsLanguage): string {
  const model = optionalMmsModelForLanguage(language)
  if (model) {
    return model
  }
  throw new Error(
    `No default offline Transformers.js TTS model is configured for ${language}. Use \`--engine edge\` for online Edge TTS, or pass \`--model\` with a Transformers.js-compatible TTS model.`,
  )
}

export function edgeVoiceForLanguage(language: TtsLanguage): string {
  return EDGE_VOICE_BY_LANGUAGE[language]
}

function optionalMmsModelForLanguage(language: TtsLanguage): string | null {
  return isOfflineTtsLanguage(language) ? MMS_MODEL_BY_LANGUAGE[language] : null
}

function isOfflineTtsLanguage(language: TtsLanguage): language is OfflineTtsLanguage {
  return (OFFLINE_TTS_LANGUAGES as readonly string[]).includes(language)
}

function resolveLanguage(options: RenderSpeechOptions): TtsLanguage {
  return options.language ?? readLanguageEnv() ?? DEFAULT_TTS_LANGUAGE
}

function readLanguageEnv(): TtsLanguage | undefined {
  const raw = process.env.RAGMIR_TTS_LANG?.toLowerCase()
  return raw !== undefined && isTtsLanguage(raw) ? raw : undefined
}

function edgeTtsAvailable(): boolean {
  return spawnSync("edge-tts", ["--help"], { stdio: "ignore" }).status === 0
}

async function edgeCliRenderer(options: EdgeTtsRenderOptions): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ragmir-tts-edge-"))
  const textFile = path.join(tempDir, "input.txt")
  await writeFile(textFile, options.text, "utf8")

  try {
    await runEdgeTts(
      [
        "--file",
        textFile,
        "--voice",
        options.voice,
        `--rate=${options.rate}`,
        "--write-media",
        options.outputPath,
      ],
      options.timeoutMs,
      options.signal,
    )
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function runEdgeTts(args: string[], timeoutMs: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal)
  const child = spawn("edge-tts", args, {
    stdio: ["ignore", "ignore", "pipe"],
  })
  const stderr: Buffer[] = []
  let stderrBytes = 0
  let stderrTruncated = false
  child.stderr.on("data", (chunk: Buffer) => {
    const remaining = MAX_EDGE_TTS_STDERR_BYTES - stderrBytes
    if (remaining > 0) {
      const captured = chunk.subarray(0, remaining)
      stderr.push(captured)
      stderrBytes += captured.length
    }
    if (chunk.length > remaining) stderrTruncated = true
  })

  let timedOut = false
  let aborted = false
  let terminationStarted = false
  let killTimer: ReturnType<typeof setTimeout> | undefined
  const terminate = (): void => {
    if (terminationStarted || child.exitCode !== null || child.signalCode !== null) return
    terminationStarted = true
    child.kill("SIGTERM")
    killTimer = setTimeout(() => child.kill("SIGKILL"), EDGE_TTS_KILL_GRACE_MS)
    killTimer.unref()
  }
  const timeout = setTimeout(() => {
    timedOut = true
    terminate()
  }, timeoutMs)
  timeout.unref()
  const abort = (): void => {
    aborted = true
    terminate()
  }
  signal?.addEventListener("abort", abort, { once: true })

  let code: number | null
  try {
    code = await new Promise<number | null>((resolve, reject) => {
      child.on("error", reject)
      child.on("close", resolve)
    })
  } finally {
    clearTimeout(timeout)
    if (killTimer !== undefined) clearTimeout(killTimer)
    signal?.removeEventListener("abort", abort)
  }

  if (aborted) {
    throw new Error("edge-tts was aborted.")
  }
  if (timedOut) {
    throw new Error(`edge-tts timed out after ${timeoutMs} ms.`)
  }
  if (code !== 0) {
    const detail = Buffer.concat(stderr).toString("utf8").trim()
    const suffix = stderrTruncated ? " [stderr truncated]" : ""
    throw new Error(
      detail
        ? `edge-tts failed with exit code ${code}: ${detail}${suffix}`
        : `edge-tts failed with exit code ${code}.`,
    )
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`)
  }
  return value
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error("Speech rendering was aborted.")
  }
}

async function canImportTransformers(): Promise<boolean> {
  try {
    await import("@huggingface/transformers")
    return true
  } catch {
    return false
  }
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

export function modelCacheExists(cwd = process.cwd()): boolean {
  return existsSync(path.resolve(cwd, process.env.RAGMIR_TTS_MODEL_PATH ?? DEFAULT_TTS_MODEL_PATH))
}
