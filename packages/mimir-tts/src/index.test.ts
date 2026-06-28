import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { doctor, renderSpeech, type TextToAudioSynthesizer } from "./index.js"

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
    expect(result.allowRemoteModels).toBe(false)
    expect(result.samplingRate).toBe(16_000)
    expect(await readFile(outputPath, "utf8")).toBe("RIFF fake wav")
  })
})

describe("doctor", () => {
  it("reports a Python-free wav renderer", async () => {
    await expect(doctor()).resolves.toMatchObject({
      pythonRequired: false,
      ffmpegRequired: false,
      outputFormat: "wav",
    })
  })
})
