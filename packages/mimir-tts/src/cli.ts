#!/usr/bin/env node
import { parseArgs } from "node:util"
import {
  doctor,
  isTtsLanguage,
  type RenderSpeechOptions,
  renderSpeech,
  TTS_LANGUAGES,
  type TtsEngine,
  type TtsLanguage,
} from "./index.js"

type CliValues = Record<string, string | boolean | undefined>

const command = process.argv[2]

try {
  if (command === "doctor") {
    await runDoctor(process.argv.slice(3))
  } else if (command === "render") {
    await runRender(process.argv.slice(3))
  } else {
    printHelp()
    process.exitCode = command ? 1 : 0
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}

async function runDoctor(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      json: { type: "boolean" },
    },
  })
  const report = await doctor()
  if (values.json) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  printKeyValue("node", report.node)
  printKeyValue("defaultEngine", report.defaultEngine)
  printKeyValue("defaultLanguage", report.defaultLanguage)
  printKeyValue("languages", report.languages.join(","))
  printKeyValue("defaultModel", report.defaultModel)
  printKeyValue("defaultModelPath", report.defaultModelPath)
  printKeyValue("defaultAllowRemoteModels", String(report.defaultAllowRemoteModels))
  printKeyValue("edgeTtsAvailable", String(report.edgeTtsAvailable))
  printKeyValue("edgeDefaultVoice", report.edgeDefaultVoice)
  printKeyValue("transformersAvailable", String(report.transformersAvailable))
  printKeyValue("pythonRequired", String(report.pythonRequired))
  printKeyValue("ffmpegRequired", String(report.ffmpegRequired))
  printKeyValue("outputFormat", report.outputFormat)
}

async function runRender(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      out: { type: "string", short: "o" },
      engine: { type: "string" },
      lang: { type: "string" },
      model: { type: "string" },
      "model-path": { type: "string" },
      offline: { type: "boolean" },
      "allow-remote-models": { type: "boolean" },
      voice: { type: "string" },
      rate: { type: "string" },
      "speaker-embeddings": { type: "string" },
      speed: { type: "string" },
      json: { type: "boolean" },
    },
  })
  const textFile = positionals[0]
  if (!textFile) {
    throw new Error("usage: mimir-tts render <text-file> [--out output.wav]")
  }

  const renderOptions: RenderSpeechOptions = {
    textFile,
  }
  addStringOption(renderOptions, "outputPath", stringValue(values, "out"))
  addEngineOption(renderOptions, engineValue(values))
  addLanguageOption(renderOptions, languageValue(values))
  addStringOption(renderOptions, "model", stringValue(values, "model"))
  addStringOption(renderOptions, "modelPath", stringValue(values, "model-path"))
  addBooleanOption(renderOptions, "allowRemoteModels", allowRemoteModels(values))
  addStringOption(renderOptions, "voice", stringValue(values, "voice"))
  addStringOption(renderOptions, "rate", stringValue(values, "rate"))
  addStringOption(renderOptions, "speakerEmbeddings", stringValue(values, "speaker-embeddings"))
  addNumberOption(renderOptions, "speed", numberValue(values, "speed"))

  const result = await renderSpeech(renderOptions)

  if (values.json) {
    console.log(JSON.stringify(result, null, 2))
    return
  }
  printKeyValue("outputPath", result.outputPath)
  printKeyValue("engine", result.engine)
  printKeyValue("language", result.language)
  printKeyValue("outputFormat", result.outputFormat)
  printKeyValue("model", result.model)
  printKeyValue("modelPath", result.modelPath)
  printKeyValue("allowRemoteModels", String(result.allowRemoteModels))
  printKeyValue("voice", result.voice ?? "none")
  printKeyValue("rate", result.rate ?? "none")
  printKeyValue("samplingRate", String(result.samplingRate ?? "unknown"))
  printKeyValue("samples", String(result.samples ?? "unknown"))
}

function allowRemoteModels(values: CliValues): boolean | undefined {
  if (values.offline === true) {
    return false
  }
  if (values["allow-remote-models"] === true) {
    return true
  }
  return undefined
}

function stringValue(values: CliValues, key: string): string | undefined {
  const value = values[key]
  return typeof value === "string" ? value : undefined
}

function engineValue(values: CliValues): TtsEngine | undefined {
  if (values.offline === true) {
    return "transformers"
  }
  const value = stringValue(values, "engine")
  if (value === undefined) {
    return undefined
  }
  if (value === "auto" || value === "edge" || value === "transformers") {
    return value
  }
  throw new Error("Expected --engine to be auto, edge, or transformers.")
}

function addEngineOption(target: RenderSpeechOptions, value: TtsEngine | undefined): void {
  if (value !== undefined) {
    target.engine = value
  }
}

function languageValue(values: CliValues): TtsLanguage | undefined {
  const value = stringValue(values, "lang")
  if (value === undefined) {
    return undefined
  }
  if (isTtsLanguage(value)) {
    return value
  }
  throw new Error(`Expected --lang to be one of: ${TTS_LANGUAGES.join(", ")}.`)
}

function addLanguageOption(target: RenderSpeechOptions, value: TtsLanguage | undefined): void {
  if (value !== undefined) {
    target.language = value
  }
}

function addStringOption(
  target: RenderSpeechOptions,
  key: "outputPath" | "model" | "modelPath" | "voice" | "rate" | "speakerEmbeddings",
  value: string | undefined,
): void {
  if (value !== undefined) {
    target[key] = value
  }
}

function addBooleanOption(
  target: RenderSpeechOptions,
  key: "allowRemoteModels",
  value: boolean | undefined,
): void {
  if (value !== undefined) {
    target[key] = value
  }
}

function addNumberOption(
  target: RenderSpeechOptions,
  key: "speed",
  value: number | undefined,
): void {
  if (value !== undefined) {
    target[key] = value
  }
}

function numberValue(values: CliValues, key: string): number | undefined {
  const value = stringValue(values, key)
  if (!value) {
    return undefined
  }
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected a number for --${key}.`)
  }
  return parsed
}

function printKeyValue(key: string, value: string): void {
  console.log(`${key}=${value}`)
}

function printHelp(): void {
  console.log(`mimir-tts

Usage:
  mimir-tts doctor [--json]
  mimir-tts render <text-file> [--out output.wav]
  mimir-tts render <text-file> --engine edge --out output.mp3

Options:
  --engine <engine>             transformers, edge, or auto. Default is transformers.
  --lang <language>            en, es, or fr. Selects the offline model and Edge voice. Default fr.
  --model <id>                 Transformers.js TTS model ID.
  --model-path <path>          Local model/cache path. Defaults to .mimir/models/tts.
  --offline                    Force the Transformers.js local/offline WAV path.
  --allow-remote-models        Explicitly allow remote model downloads.
  --voice <voice>              Edge voice. Defaults to fr-FR-DeniseNeural.
  --rate <rate>                Edge rate. Defaults to +0%.
  --speaker-embeddings <path>  Optional model-specific speaker embedding path or URL.
  --speed <number>             Optional model-specific speech speed.
  --json                       Print JSON output.
`)
}
