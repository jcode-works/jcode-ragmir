import { spawn, spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export const DEFAULT_TTS_MODEL = "Xenova/mms-tts-fra"
export const DEFAULT_TTS_MODEL_PATH = ".mimir/models/tts"
export const DEFAULT_AUDIO_DIR = ".mimir/audio"
export const DEFAULT_TTS_ENGINE = "transformers"
export const DEFAULT_TTS_ALLOW_REMOTE_MODELS = false
export const DEFAULT_EDGE_VOICE = "fr-FR-DeniseNeural"
export const DEFAULT_EDGE_RATE = "+0%"
export const DEFAULT_TTS_LANGUAGE: TtsLanguage = "fr"

export type TtsEngine = "auto" | "edge" | "transformers"
export type OutputFormat = "mp3" | "wav"

export const TTS_LANGUAGES = ["en", "es", "fr"] as const
export type TtsLanguage = (typeof TTS_LANGUAGES)[number]

export function isTtsLanguage(value: string): value is TtsLanguage {
  return (TTS_LANGUAGES as readonly string[]).includes(value)
}

// Self-contained per-language MMS models (no phonemizer, no Python) for the offline path,
// and high-quality Microsoft neural voices for the online Edge path.
const MMS_MODEL_BY_LANGUAGE: Record<TtsLanguage, string> = {
  en: "Xenova/mms-tts-eng",
  es: "Xenova/mms-tts-spa",
  fr: DEFAULT_TTS_MODEL,
}
const EDGE_VOICE_BY_LANGUAGE: Record<TtsLanguage, string> = {
  en: "en-US-AriaNeural",
  es: "es-ES-ElviraNeural",
  fr: DEFAULT_EDGE_VOICE,
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
}

export interface RenderSpeechResult {
  outputPath: string
  engine: Exclude<TtsEngine, "auto">
  language: TtsLanguage
  outputFormat: OutputFormat
  model: string
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
}

export async function renderSpeech(options: RenderSpeechOptions): Promise<RenderSpeechResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd())
  const text = await readInputText(options)
  const engine = resolveEngine(options)
  const language = resolveLanguage(options)
  const model = options.model ?? process.env.MIMIR_TTS_MODEL ?? mmsModelForLanguage(language)
  const modelPath = resolveFromCwd(
    cwd,
    options.modelPath ?? process.env.MIMIR_TTS_MODEL_PATH ?? DEFAULT_TTS_MODEL_PATH,
  )
  const outputPath = resolveFromCwd(
    cwd,
    options.outputPath ?? defaultOutputPath(cwd, options.textFile, outputFormatForEngine(engine)),
  )
  const allowRemoteModels =
    options.allowRemoteModels ??
    readBooleanEnv("MIMIR_TTS_ALLOW_REMOTE_MODELS", DEFAULT_TTS_ALLOW_REMOTE_MODELS)

  await mkdir(path.dirname(outputPath), { recursive: true })

  if (engine === "edge") {
    validateOutputFormat(outputPath, "mp3")
    const voice =
      options.voice ?? process.env.MIMIR_TTS_EDGE_VOICE ?? edgeVoiceForLanguage(language)
    const rate = options.rate ?? process.env.MIMIR_TTS_EDGE_RATE ?? DEFAULT_EDGE_RATE
    const renderer = options.edgeRenderer ?? edgeCliRenderer
    const edgeAvailable = options.edgeAvailable ?? edgeTtsAvailable
    if (!options.edgeRenderer && !edgeAvailable()) {
      throw new Error(
        "edge-tts is required for the Edge engine. Install it with `pipx install edge-tts`.",
      )
    }
    await renderer({ text, outputPath, voice, rate })

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
  const synthesizer =
    options.synthesizer ?? (await transformerSynthesizer(model, modelPath, allowRemoteModels))
  const output = await synthesizer(text, textToAudioOptions(options))
  await output.save(outputPath)

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

async function readInputText(options: RenderSpeechOptions): Promise<string> {
  const text = options.text ?? (options.textFile ? await readFile(options.textFile, "utf8") : "")
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
  const name = textFile ? path.basename(textFile, path.extname(textFile)) : "mimir-summary"
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
): Promise<TextToAudioSynthesizer> {
  const transformers = await import("@huggingface/transformers")
  transformers.env.localModelPath = modelPath
  transformers.env.cacheDir = modelPath
  transformers.env.allowRemoteModels = allowRemoteModels

  return (await transformers.pipeline("text-to-speech", model)) as TextToAudioSynthesizer
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
  const raw = process.env.MIMIR_TTS_ENGINE
  if (raw === "auto" || raw === "edge" || raw === "transformers") {
    return raw
  }
  return undefined
}

export function mmsModelForLanguage(language: TtsLanguage): string {
  return MMS_MODEL_BY_LANGUAGE[language]
}

export function edgeVoiceForLanguage(language: TtsLanguage): string {
  return EDGE_VOICE_BY_LANGUAGE[language]
}

function resolveLanguage(options: RenderSpeechOptions): TtsLanguage {
  return options.language ?? readLanguageEnv() ?? DEFAULT_TTS_LANGUAGE
}

function readLanguageEnv(): TtsLanguage | undefined {
  const raw = process.env.MIMIR_TTS_LANG?.toLowerCase()
  return raw !== undefined && isTtsLanguage(raw) ? raw : undefined
}

function edgeTtsAvailable(): boolean {
  return spawnSync("edge-tts", ["--help"], { stdio: "ignore" }).status === 0
}

async function edgeCliRenderer(options: EdgeTtsRenderOptions): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mimir-tts-edge-"))
  const textFile = path.join(tempDir, "input.txt")
  await writeFile(textFile, options.text, "utf8")

  try {
    await runEdgeTts([
      "--file",
      textFile,
      "--voice",
      options.voice,
      `--rate=${options.rate}`,
      "--write-media",
      options.outputPath,
    ])
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function runEdgeTts(args: string[]): Promise<void> {
  const child = spawn("edge-tts", args, {
    stdio: ["ignore", "ignore", "pipe"],
  })
  const stderr: Buffer[] = []
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk))

  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject)
    child.on("close", resolve)
  })

  if (code !== 0) {
    const detail = Buffer.concat(stderr).toString("utf8").trim()
    throw new Error(
      detail
        ? `edge-tts failed with exit code ${code}: ${detail}`
        : `edge-tts failed with exit code ${code}.`,
    )
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
  return existsSync(path.resolve(cwd, process.env.MIMIR_TTS_MODEL_PATH ?? DEFAULT_TTS_MODEL_PATH))
}
