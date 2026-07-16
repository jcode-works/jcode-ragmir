import { existsSync } from "node:fs"
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  doctor,
  type EdgeTtsRenderer,
  edgeVoiceForLanguage,
  mmsModelForLanguage,
  modelCacheExists,
  renderSpeech,
  type TextToAudioSynthesizer,
} from "./index.js"

const transformersMock = vi.hoisted(() => ({
  env: {
    localModelPath: "initial-local-path",
    cacheDir: "initial-cache-dir",
    allowRemoteModels: false,
  },
  pipeline: vi.fn(),
}))

vi.mock("@huggingface/transformers", () => transformersMock)

const silentSynthesizer: TextToAudioSynthesizer = async () => ({
  save: async (target) => {
    await writeFile(target, "RIFF fake wav", "utf8")
  },
})

const tempDirs: string[] = []

async function installEdgeTtsStub(root: string, source: string): Promise<void> {
  const binDir = path.join(root, "bin")
  const executablePath = path.join(binDir, "edge-tts")
  await mkdir(binDir, { recursive: true })
  await writeFile(executablePath, `#!/usr/bin/env node\n${source}`, "utf8")
  await chmod(executablePath, 0o755)
  vi.stubEnv("PATH", `${binDir}${path.delimiter}${process.env.PATH ?? ""}`)
}

beforeEach(() => {
  transformersMock.env.localModelPath = "initial-local-path"
  transformersMock.env.cacheDir = "initial-cache-dir"
  transformersMock.env.allowRemoteModels = false
  transformersMock.pipeline.mockReset()
  transformersMock.pipeline.mockResolvedValue(silentSynthesizer)
})

afterEach(async () => {
  vi.unstubAllEnvs()
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("renderSpeech", () => {
  it("renders a text file to the requested wav path through an injected synthesizer", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-tts-"))
    tempDirs.push(root)
    const textFile = path.join(root, "summary.txt")
    const outputPath = path.join(root, ".ragmir/audio/summary.wav")
    await writeFile(textFile, "Bonjour depuis Ragmir.", "utf8")

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

  it("should resolve a relative text file from cwd when rendering speech", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-tts-relative-input-"))
    tempDirs.push(root)
    await writeFile(path.join(root, "summary.txt"), "Bonjour depuis le dossier projet.", "utf8")

    const result = await renderSpeech({
      cwd: root,
      textFile: "summary.txt",
      synthesizer: silentSynthesizer,
    })

    expect(result.outputPath).toBe(path.join(root, ".ragmir/audio/summary.wav"))
    expect(await readFile(result.outputPath, "utf8")).toBe("RIFF fake wav")
  })

  it("renders mp3 output through the Edge-compatible renderer", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-tts-edge-"))
    tempDirs.push(root)
    const textFile = path.join(root, "summary.txt")
    const outputPath = path.join(root, ".ragmir/audio/summary.mp3")
    await writeFile(textFile, "Bonjour depuis Ragmir.", "utf8")

    const edgeRenderer: EdgeTtsRenderer = async (options) => {
      expect(options.voice).toBe("fr-FR-DeniseNeural")
      expect(options.rate).toBe("+0%")
      expect(options.timeoutMs).toBe(120_000)
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

  it("should forward cancellation and a bounded timeout to the Edge renderer", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-tts-edge-controls-"))
    tempDirs.push(root)
    const controller = new AbortController()
    const edgeRenderer = vi.fn<EdgeTtsRenderer>(async (options) => {
      expect(options.signal).toBe(controller.signal)
      expect(options.timeoutMs).toBe(5_000)
      await writeFile(options.outputPath, "ID3 controlled", "utf8")
    })

    await renderSpeech({
      cwd: root,
      text: "Bounded Edge synthesis.",
      outputPath: ".ragmir/audio/controlled.mp3",
      engine: "edge",
      edgeRenderer,
      edgeTimeoutMs: 5_000,
      signal: controller.signal,
    })

    expect(edgeRenderer).toHaveBeenCalledOnce()
  })

  it("should reject an aborted render before invoking an engine", async () => {
    const controller = new AbortController()
    controller.abort()
    const edgeRenderer = vi.fn<EdgeTtsRenderer>()

    await expect(
      renderSpeech({
        text: "Private input.",
        engine: "edge",
        edgeRenderer,
        signal: controller.signal,
      }),
    ).rejects.toThrow("Speech rendering was aborted.")
    expect(edgeRenderer).not.toHaveBeenCalled()
  })

  it("should reject when rendering is aborted during an output save", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-tts-save-abort-"))
    tempDirs.push(root)
    const controller = new AbortController()
    let notifySaveStarted: (() => void) | undefined
    let finishSave: (() => void) | undefined
    const saveStarted = new Promise<void>((resolve) => {
      notifySaveStarted = resolve
    })
    const synthesizer: TextToAudioSynthesizer = async () => ({
      save: () =>
        new Promise<void>((resolve) => {
          finishSave = resolve
          notifySaveStarted?.()
        }),
    })
    const rendering = renderSpeech({
      cwd: root,
      text: "Cancellable local synthesis.",
      synthesizer,
      signal: controller.signal,
    })
    await saveStarted

    controller.abort()
    finishSave?.()

    await expect(rendering).rejects.toThrow("Speech rendering was aborted.")
  })

  it("defaults to French and its self-contained model on the offline path", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-tts-fr-"))
    tempDirs.push(root)
    const textFile = path.join(root, "summary.txt")
    await writeFile(textFile, "Bonjour depuis Ragmir.", "utf8")

    const result = await renderSpeech({
      cwd: root,
      textFile,
      outputPath: path.join(root, ".ragmir/audio/summary.wav"),
      synthesizer: silentSynthesizer,
    })

    expect(result.language).toBe("fr")
    expect(result.model).toBe("Xenova/mms-tts-fra")
  })

  it("selects the Spanish model when language is es on the offline path", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-tts-es-"))
    tempDirs.push(root)
    const textFile = path.join(root, "summary.txt")
    await writeFile(textFile, "Hola desde Ragmir.", "utf8")

    const result = await renderSpeech({
      cwd: root,
      textFile,
      language: "es",
      outputPath: path.join(root, ".ragmir/audio/summary.wav"),
      synthesizer: silentSynthesizer,
    })

    expect(result.language).toBe("es")
    expect(result.model).toBe("Xenova/mms-tts-spa")
  })

  it("uses the English Edge voice when language is en on the edge path", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-tts-en-edge-"))
    tempDirs.push(root)
    const textFile = path.join(root, "summary.txt")
    await writeFile(textFile, "Hello from Ragmir.", "utf8")

    const edgeRenderer: EdgeTtsRenderer = async (options) => {
      expect(options.voice).toBe("en-US-AriaNeural")
      await writeFile(options.outputPath, "ID3 fake mp3", "utf8")
    }

    const result = await renderSpeech({
      cwd: root,
      textFile,
      engine: "edge",
      language: "en",
      outputPath: path.join(root, ".ragmir/audio/summary.mp3"),
      edgeRenderer,
    })

    expect(result.language).toBe("en")
    expect(result.voice).toBe("en-US-AriaNeural")
  })

  it("uses Edge voices for Asian languages without requiring an offline model", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-tts-zh-edge-"))
    tempDirs.push(root)
    const textFile = path.join(root, "summary.txt")
    await writeFile(textFile, "你好，Ragmir。", "utf8")

    const edgeRenderer: EdgeTtsRenderer = async (options) => {
      expect(options.voice).toBe("zh-CN-XiaoxiaoNeural")
      await writeFile(options.outputPath, "ID3 fake mp3", "utf8")
    }

    const result = await renderSpeech({
      cwd: root,
      textFile,
      engine: "edge",
      language: "zh",
      outputPath: path.join(root, ".ragmir/audio/summary.mp3"),
      edgeRenderer,
    })

    expect(result.language).toBe("zh")
    expect(result.model).toBeNull()
    expect(result.voice).toBe("zh-CN-XiaoxiaoNeural")
  })

  it("maps languages to self-contained MMS models and Edge voices", () => {
    expect(mmsModelForLanguage("en")).toBe("Xenova/mms-tts-eng")
    expect(mmsModelForLanguage("es")).toBe("Xenova/mms-tts-spa")
    expect(mmsModelForLanguage("fr")).toBe("Xenova/mms-tts-fra")
    expect(() => mmsModelForLanguage("ja")).toThrow("No default offline")
    expect(() => mmsModelForLanguage("th")).toThrow("No default offline")
    expect(() => mmsModelForLanguage("zh")).toThrow("No default offline")
    expect(edgeVoiceForLanguage("en")).toBe("en-US-AriaNeural")
    expect(edgeVoiceForLanguage("es")).toBe("es-ES-ElviraNeural")
    expect(edgeVoiceForLanguage("fr")).toBe("fr-FR-DeniseNeural")
    expect(edgeVoiceForLanguage("ja")).toBe("ja-JP-NanamiNeural")
    expect(edgeVoiceForLanguage("th")).toBe("th-TH-PremwadeeNeural")
    expect(edgeVoiceForLanguage("zh")).toBe("zh-CN-XiaoxiaoNeural")
  })

  it("rejects offline rendering for languages without a default Transformers.js model", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-tts-zh-offline-"))
    tempDirs.push(root)
    const textFile = path.join(root, "summary.txt")
    await writeFile(textFile, "你好，Ragmir。", "utf8")

    await expect(
      renderSpeech({
        cwd: root,
        textFile,
        language: "zh",
        outputPath: path.join(root, ".ragmir/audio/summary.wav"),
        synthesizer: silentSynthesizer,
      }),
    ).rejects.toThrow("No default offline Transformers.js TTS model is configured for zh")
  })

  it("rejects incompatible output formats", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-tts-format-"))
    tempDirs.push(root)
    const textFile = path.join(root, "summary.txt")
    await writeFile(textFile, "Bonjour depuis Ragmir.", "utf8")

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

  it("should reject empty text before initializing a renderer", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-tts-empty-"))
    tempDirs.push(root)

    await expect(
      renderSpeech({ cwd: root, text: "  \n\t", synthesizer: silentSynthesizer }),
    ).rejects.toThrow("A non-empty text input or text file is required")
  })

  it("should choose Edge automatically for an mp3 output path", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-tts-auto-edge-"))
    tempDirs.push(root)
    const outputPath = path.join(root, "summary.mp3")
    const edgeRenderer: EdgeTtsRenderer = async ({ outputPath: target }) => {
      await writeFile(target, "ID3 auto edge", "utf8")
    }

    const result = await renderSpeech({
      cwd: root,
      text: "Bonjour depuis le moteur automatique.",
      outputPath,
      engine: "auto",
      edgeRenderer,
    })

    expect(result.engine).toBe("edge")
    expect(await readFile(outputPath, "utf8")).toBe("ID3 auto edge")
  })

  it("should reject Edge rendering when edge-tts is unavailable", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-tts-missing-edge-"))
    tempDirs.push(root)

    await expect(
      renderSpeech({
        cwd: root,
        text: "Bonjour.",
        engine: "edge",
        outputPath: path.join(root, "summary.mp3"),
        edgeAvailable: () => false,
      }),
    ).rejects.toThrow("edge-tts is required")
  })

  it.skipIf(process.platform === "win32")(
    "should render through the Edge CLI with a private temporary input file",
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-tts-edge-cli-"))
      tempDirs.push(root)
      await installEdgeTtsStub(
        root,
        [
          'const fs = require("node:fs")',
          "const args = process.argv.slice(2)",
          'const inputPath = args[args.indexOf("--file") + 1]',
          'const outputPath = args[args.indexOf("--write-media") + 1]',
          'fs.writeFileSync(outputPath, "ID3 " + fs.readFileSync(inputPath, "utf8"))',
        ].join("\n"),
      )
      const outputPath = path.join(root, "summary.mp3")

      const result = await renderSpeech({
        cwd: root,
        text: "Private Edge input.",
        outputPath,
        engine: "edge",
        edgeAvailable: () => true,
      })

      expect(result.engine).toBe("edge")
      expect(await readFile(outputPath, "utf8")).toBe("ID3 Private Edge input.")
    },
  )

  it.skipIf(process.platform === "win32")(
    "should terminate the Edge CLI when its timeout expires",
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-tts-edge-timeout-"))
      tempDirs.push(root)
      await installEdgeTtsStub(root, "setInterval(() => {}, 1_000)\n")

      await expect(
        renderSpeech({
          cwd: root,
          text: "Bounded Edge input.",
          outputPath: path.join(root, "summary.mp3"),
          engine: "edge",
          edgeAvailable: () => true,
          edgeTimeoutMs: 25,
        }),
      ).rejects.toThrow("edge-tts timed out after 25 ms.")
    },
  )

  it.skipIf(process.platform === "win32")(
    "should terminate the Edge CLI when rendering is aborted",
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-tts-edge-abort-"))
      tempDirs.push(root)
      await installEdgeTtsStub(
        root,
        [
          'const fs = require("node:fs")',
          "const args = process.argv.slice(2)",
          'const outputPath = args[args.indexOf("--write-media") + 1]',
          'fs.writeFileSync(outputPath + ".ready", "ready")',
          "setInterval(() => {}, 1_000)",
        ].join("\n"),
      )
      const outputPath = path.join(root, "summary.mp3")
      const controller = new AbortController()
      const rendering = renderSpeech({
        cwd: root,
        text: "Cancellable Edge input.",
        outputPath,
        engine: "edge",
        edgeAvailable: () => true,
        signal: controller.signal,
      })
      await vi.waitFor(() => expect(existsSync(`${outputPath}.ready`)).toBe(true))

      controller.abort()

      await expect(rendering).rejects.toThrow("edge-tts was aborted.")
    },
  )

  it("should pass speaker and speed options to the Transformers synthesizer", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-tts-options-"))
    tempDirs.push(root)
    let receivedOptions: Parameters<TextToAudioSynthesizer>[1]
    const synthesizer: TextToAudioSynthesizer = async (_text, options) => {
      receivedOptions = options
      return silentSynthesizer("")
    }

    await renderSpeech({
      cwd: root,
      text: "Bonjour.",
      synthesizer,
      speakerEmbeddings: "speaker.bin",
      speed: 1.2,
    })

    expect(receivedOptions).toEqual({ speaker_embeddings: "speaker.bin", speed: 1.2 })
  })

  it("should restore the Transformers environment after pipeline creation", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-tts-transformers-env-"))
    tempDirs.push(root)
    const modelPath = path.join(root, "models")
    let environmentDuringCreation: typeof transformersMock.env | undefined
    const dispose = vi.fn(async () => undefined)
    transformersMock.pipeline.mockImplementation(async () => {
      environmentDuringCreation = { ...transformersMock.env }
      return Object.assign(silentSynthesizer, { dispose })
    })

    await renderSpeech({
      cwd: root,
      text: "Bonjour.",
      engine: "transformers",
      outputPath: path.join(root, "summary.wav"),
      modelPath,
      allowRemoteModels: true,
    })

    expect(environmentDuringCreation).toEqual({
      localModelPath: modelPath,
      cacheDir: modelPath,
      allowRemoteModels: true,
    })
    expect(transformersMock.env).toEqual({
      localModelPath: "initial-local-path",
      cacheDir: "initial-cache-dir",
      allowRemoteModels: false,
    })
    expect(dispose).toHaveBeenCalledOnce()
  })

  it("should dispose a loaded Transformers pipeline when cancellation wins during setup", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-tts-transformers-cancel-"))
    tempDirs.push(root)
    const controller = new AbortController()
    const synthesize = vi.fn(silentSynthesizer)
    const dispose = vi.fn(async () => undefined)
    let finishLoading:
      | ((value: TextToAudioSynthesizer & { dispose: () => Promise<void> }) => void)
      | undefined
    transformersMock.pipeline.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishLoading = resolve
        }),
    )

    const rendering = renderSpeech({
      cwd: root,
      text: "Bonjour.",
      engine: "transformers",
      outputPath: path.join(root, "summary.wav"),
      signal: controller.signal,
    })
    await vi.waitFor(() => expect(finishLoading).toBeTypeOf("function"))
    controller.abort()
    finishLoading?.(Object.assign(synthesize, { dispose }))

    await expect(rendering).rejects.toThrow("Speech rendering was aborted.")
    expect(synthesize).not.toHaveBeenCalled()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it("should use valid language and Edge options from the environment", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-tts-env-"))
    tempDirs.push(root)
    vi.stubEnv("RAGMIR_TTS_LANG", "JA")
    vi.stubEnv("RAGMIR_TTS_EDGE_VOICE", "ja-JP-KeitaNeural")
    vi.stubEnv("RAGMIR_TTS_EDGE_RATE", "+15%")
    let rendererOptions: Parameters<EdgeTtsRenderer>[0] | undefined

    const result = await renderSpeech({
      cwd: root,
      text: "こんにちは。",
      engine: "edge",
      outputPath: path.join(root, "summary.mp3"),
      edgeRenderer: async (options) => {
        rendererOptions = options
        await writeFile(options.outputPath, "ID3 env", "utf8")
      },
    })

    expect(result.language).toBe("ja")
    expect(rendererOptions).toMatchObject({ voice: "ja-JP-KeitaNeural", rate: "+15%" })
  })

  it("should report whether the configured local model cache exists", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-tts-cache-"))
    tempDirs.push(root)

    expect(modelCacheExists(root)).toBe(false)
    await mkdir(path.join(root, ".ragmir/models/tts"), { recursive: true })
    expect(modelCacheExists(root)).toBe(true)
  })
})

describe("doctor", () => {
  it("reports Python-free renderers and the offline default engine", async () => {
    await expect(doctor()).resolves.toMatchObject({
      defaultEngine: "transformers",
      defaultLanguage: "fr",
      languages: ["en", "es", "fr", "ja", "th", "zh"],
      offlineLanguages: ["en", "es", "fr"],
      edgeLanguages: ["en", "es", "fr", "ja", "th", "zh"],
      defaultAllowRemoteModels: false,
      edgeDefaultVoice: "fr-FR-DeniseNeural",
      pythonRequired: false,
      ffmpegRequired: false,
      outputFormat: "mp3-or-wav",
    })
  })

  it("does not allow remote model loading by default", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-tts-remote-default-"))
    tempDirs.push(root)
    const textFile = path.join(root, "summary.txt")
    const outputPath = path.join(root, ".ragmir/audio/summary.wav")
    await writeFile(textFile, "Bonjour depuis Ragmir.", "utf8")

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
