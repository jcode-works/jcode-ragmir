import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { loadConfig } from "./config.js"
import { chooseEmbeddingModel } from "./embedding-model-choice.js"
import { EMBEDDING_MODELS } from "./embedding-models.js"
import type { HardwareProfile } from "./hardware.js"
import { initProject } from "./init.js"

const GIB = 1024 ** 3
const roots: string[] = []

const laptop: HardwareProfile = {
  platform: "darwin",
  architecture: "arm64",
  cpuModel: "Example",
  logicalCpus: 10,
  memoryBytes: 16 * GIB,
  availableMemoryBytes: 8 * GIB,
  memorySource: "system",
  appleSilicon: true,
  rosetta: false,
}

async function project(config?: Record<string, unknown>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-model-choice-"))
  roots.push(root)
  // A teammate clones a repository that already commits its shared config, then initializes.
  if (config) {
    await writeFile(path.join(root, "ragmir.config.json"), JSON.stringify(config))
  }
  await initProject(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("chooseEmbeddingModel", () => {
  it("recommends a model for this machine when the project names none", async () => {
    const root = await project()
    const choice = await chooseEmbeddingModel(root, await loadConfig(root), undefined, laptop)

    expect(choice).toMatchObject({
      embeddingModel: EMBEDDING_MODELS[0]?.id,
      embeddingModelRevision: EMBEDDING_MODELS[0]?.revision,
      source: "recommended",
    })
    expect(choice.assessment?.fit).toBe("fits")
  })

  it("keeps the model the shared config names, so every workstation uses the same one", async () => {
    const root = await project({ embeddingModel: "mixedbread-ai/mxbai-embed-xsmall-v1" })
    const choice = await chooseEmbeddingModel(root, await loadConfig(root), undefined, laptop)

    expect(choice).toMatchObject({
      embeddingModel: "mixedbread-ai/mxbai-embed-xsmall-v1",
      embeddingModelRevision: "e6ac24e5d6efb8782b59de1647b3ececb4ece94e",
      source: "configured",
    })
  })

  it("treats the defaults that init writes locally as no choice", async () => {
    const root = await project()
    const local = await chooseEmbeddingModel(root, await loadConfig(root), undefined, laptop)
    const tiny = await chooseEmbeddingModel(root, await loadConfig(root), undefined, {
      ...laptop,
      memoryBytes: 0.25 * GIB,
    })

    expect(local.source).toBe("recommended")
    expect(tiny).toMatchObject({
      embeddingModel: "intfloat/multilingual-e5-small",
      source: "default",
    })
  })

  it("installs an explicitly requested model with its pinned revision", async () => {
    const root = await project({ embeddingModel: "mixedbread-ai/mxbai-embed-xsmall-v1" })
    const choice = await chooseEmbeddingModel(
      root,
      await loadConfig(root),
      "intfloat/multilingual-e5-small",
      laptop,
    )

    expect(choice).toMatchObject({
      embeddingModel: "intfloat/multilingual-e5-small",
      embeddingModelRevision: "614241f622f53c4eeff9890bdc4f31cfecc418b3",
      source: "requested",
    })
  })
})
