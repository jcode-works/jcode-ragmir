import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  doctor,
  type EdgeTtsRenderer,
  edgeVoiceForLanguage,
  mmsModelForLanguage,
  renderSpeech,
  type TextToAudioSynthesizer,
} from "./index.js"

const silentSynthesizer: TextToAudioSynthesizer = async () => ({
  save: async (target) => {
    await writeFile(target, "RIFF fake wav", "utf8")
  },
})

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("renderSpeech", () => {
  it("renders a text file to the requested wav path through an injected synthesizer", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mimir-tts-"))
    tempDirs.push(root)
    const textFile = path.join(root, "summary.txt")
    const outputPath = path.join(root, ".mimir/audio/summary.wav")
    await writeFile(textFile, "Bonjour depuis Mimir.", "utf8")

    const synthesizer: TextToAudioSynthesizer = async () => ({
      sampling_rate: 16_000,
      data: new Float32Array([0, 0.5, -0.5]),
      save: async (target) => {
        await writeFile(target, "RIFF fake wav", "utf8")
      },
    })

    const result = await renderSpeech({
      cwd: root,
      textFile,
      outputPath,
      allowRemoteModels: false,
      synthesizer,
    })

    expect(result.outputPath).toBe(outputPath)
    expect(result.engine).toBe("transformers")
    expect(result.outputFormat).toBe("wav")
    expect(result.allowRemoteModels).toBe(false)
    expect(result.samplingRate).toBe(16_000)
    expect(await readFile(outputPath, "utf8")).toBe("RIFF fake wav")
  })

  it("renders mp3 output through the Edge-compatible renderer", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mimir-tts-edge-"))
    tempDirs.push(root)
    const textFile = path.join(root, "summary.txt")
    const outputPath = path.join(root, ".mimir/audio/summary.mp3")
    await writeFile(textFile, "Bonjour depuis Mimir.", "utf8")

    const edgeRenderer: EdgeTtsRenderer = async (options) => {
      expect(options.voice).toBe("fr-FR-DeniseNeural")
      expect(options.rate).toBe("+0%")
      await writeFile(options.outputPath, "ID3 fake mp3", "utf8")
    }

    const result = await renderSpeech({
      cwd: root,
      textFile,
      outputPath,
      engine: "edge",
      edgeRenderer,
    })

    expect(result.outputPath).toBe(outputPath)
    expect(result.engine).toBe("edge")
    expect(result.outputFormat).toBe("mp3")
    expect(result.voice).toBe("fr-FR-DeniseNeural")
    expect(result.rate).toBe("+0%")
    expect(await readFile(outputPath, "utf8")).toBe("ID3 fake mp3")
  })

  it("defaults to French and its self-contained model on the offline path", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mimir-tts-fr-"))
    tempDirs.push(root)
    const textFile = path.join(root, "summary.txt")
    await writeFile(textFile, "Bonjour depuis Mimir.", "utf8")

    const result = await renderSpeech({
      cwd: root,
      textFile,
      outputPath: path.join(root, ".mimir/audio/summary.wav"),
      synthesizer: silentSynthesizer,
    })

    expect(result.language).toBe("fr")
    expect(result.model).toBe("Xenova/mms-tts-fra")
  })

  it("selects the Spanish model when language is es on the offline path", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mimir-tts-es-"))
    tempDirs.push(root)
    const textFile = path.join(root, "summary.txt")
    await writeFile(textFile, "Hola desde Mimir.", "utf8")

    const result = await renderSpeech({
      cwd: root,
      textFile,
      language: "es",
      outputPath: path.join(root, ".mimir/audio/summary.wav"),
      synthesizer: silentSynthesizer,
    })

    expect(result.language).toBe("es")
    expect(result.model).toBe("Xenova/mms-tts-spa")
  })

  it("uses the English Edge voice when language is en on the edge path", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mimir-tts-en-edge-"))
    tempDirs.push(root)
    const textFile = path.join(root, "summary.txt")
    await writeFile(textFile, "Hello from Mimir.", "utf8")

    const edgeRenderer: EdgeTtsRenderer = async (options) => {
      expect(options.voice).toBe("en-US-AriaNeural")
      await writeFile(options.outputPath, "ID3 fake mp3", "utf8")
    }

    const result = await renderSpeech({
      cwd: root,
      textFile,
      engine: "edge",
      language: "en",
      outputPath: path.join(root, ".mimir/audio/summary.mp3"),
      edgeRenderer,
    })

    expect(result.language).toBe("en")
    expect(result.voice).toBe("en-US-AriaNeural")
  })

  it("maps languages to self-contained MMS models and Edge voices", () => {
    expect(mmsModelForLanguage("en")).toBe("Xenova/mms-tts-eng")
    expect(mmsModelForLanguage("es")).toBe("Xenova/mms-tts-spa")
    expect(mmsModelForLanguage("fr")).toBe("Xenova/mms-tts-fra")
    expect(edgeVoiceForLanguage("en")).toBe("en-US-AriaNeural")
    expect(edgeVoiceForLanguage("es")).toBe("es-ES-ElviraNeural")
    expect(edgeVoiceForLanguage("fr")).toBe("fr-FR-DeniseNeural")
  })

  it("rejects incompatible output formats", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mimir-tts-format-"))
    tempDirs.push(root)
    const textFile = path.join(root, "summary.txt")
    await writeFile(textFile, "Bonjour depuis Mimir.", "utf8")

    await expect(
      renderSpeech({
        cwd: root,
        textFile,
        outputPath: path.join(root, "summary.wav"),
        engine: "edge",
        edgeRenderer: async () => {},
      }),
    ).rejects.toThrow("The mp3 engine cannot write wav output")
  })
})

describe("doctor", () => {
  it("reports Python-free renderers and the offline default engine", async () => {
    await expect(doctor()).resolves.toMatchObject({
      defaultEngine: "transformers",
      defaultLanguage: "fr",
      languages: ["en", "es", "fr"],
      defaultAllowRemoteModels: false,
      edgeDefaultVoice: "fr-FR-DeniseNeural",
      pythonRequired: false,
      ffmpegRequired: false,
      outputFormat: "mp3-or-wav",
    })
  })

  it("does not allow remote model loading by default", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mimir-tts-remote-default-"))
    tempDirs.push(root)
    const textFile = path.join(root, "summary.txt")
    const outputPath = path.join(root, ".mimir/audio/summary.wav")
    await writeFile(textFile, "Bonjour depuis Mimir.", "utf8")

    const synthesizer: TextToAudioSynthesizer = async () => ({
      save: async (target) => {
        await writeFile(target, "RIFF fake wav", "utf8")
      },
    })

    const result = await renderSpeech({
      cwd: root,
      textFile,
      outputPath,
      synthesizer,
    })

    expect(result.allowRemoteModels).toBe(false)
  })
})
