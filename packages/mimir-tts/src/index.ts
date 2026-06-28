import { existsSync } from "node:fs"
import { mkdir, readFile } from "node:fs/promises"
import path from "node:path"

export const DEFAULT_TTS_MODEL = "Xenova/mms-tts-fra"
export const DEFAULT_TTS_MODEL_PATH = ".mimir/models/tts"
export const DEFAULT_AUDIO_DIR = ".mimir/audio"

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
  model?: string
  modelPath?: string
  allowRemoteModels?: boolean
  speakerEmbeddings?: string
  speed?: number
  synthesizer?: TextToAudioSynthesizer
}

export interface RenderSpeechResult {
  outputPath: string
  model: string
  modelPath: string
  allowRemoteModels: boolean
  samplingRate: number | null
  samples: number | null
}

export interface DoctorReport {
  node: string
  defaultModel: string
  defaultModelPath: string
  transformersAvailable: boolean
  pythonRequired: false
  ffmpegRequired: false
  outputFormat: "wav"
}

export async function renderSpeech(options: RenderSpeechOptions): Promise<RenderSpeechResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd())
  const text = await readInputText(options)
  const model = options.model ?? process.env.MIMIR_TTS_MODEL ?? DEFAULT_TTS_MODEL
  const modelPath = resolveFromCwd(
    cwd,
    options.modelPath ?? process.env.MIMIR_TTS_MODEL_PATH ?? DEFAULT_TTS_MODEL_PATH,
  )
  const outputPath = resolveFromCwd(
    cwd,
    options.outputPath ?? defaultOutputPath(cwd, options.textFile),
  )
  const allowRemoteModels =
    options.allowRemoteModels ?? readBooleanEnv("MIMIR_TTS_ALLOW_REMOTE_MODELS", true)

  await mkdir(path.dirname(outputPath), { recursive: true })
  const synthesizer =
    options.synthesizer ?? (await transformerSynthesizer(model, modelPath, allowRemoteModels))
  const output = await synthesizer(text, textToAudioOptions(options))
  await output.save(outputPath)

  return {
    outputPath,
    model,
    modelPath,
    allowRemoteModels,
    samplingRate: typeof output.sampling_rate === "number" ? output.sampling_rate : null,
    samples: output.data instanceof Float32Array ? output.data.length : null,
  }
}

export async function doctor(): Promise<DoctorReport> {
  return {
    node: process.versions.node,
    defaultModel: DEFAULT_TTS_MODEL,
    defaultModelPath: DEFAULT_TTS_MODEL_PATH,
    transformersAvailable: await canImportTransformers(),
    pythonRequired: false,
    ffmpegRequired: false,
    outputFormat: "wav",
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

function defaultOutputPath(cwd: string, textFile: string | undefined): string {
  const name = textFile ? path.basename(textFile, path.extname(textFile)) : "mimir-summary"
  return path.join(cwd, DEFAULT_AUDIO_DIR, `${name}.wav`)
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
