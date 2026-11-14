import { describe, expect, it } from "vitest"
import { defaultEmbeddingModelRevision } from "./defaults.js"
import {
  assessEmbeddingModel,
  EMBEDDING_MODELS,
  embeddingDtype,
  embeddingModelProfile,
  embeddingPooling,
  recommendEmbeddingModel,
} from "./embedding-models.js"
import type { HardwareProfile } from "./hardware.js"

const GIB = 1024 ** 3

function machine(memoryGigabytes: number, logicalCpus = 8): HardwareProfile {
  return {
    platform: "linux",
    architecture: "x64",
    cpuModel: "Example CPU",
    logicalCpus,
    memoryBytes: memoryGigabytes * GIB,
    availableMemoryBytes: memoryGigabytes * GIB,
    memorySource: "system",
    appleSilicon: false,
    rosetta: false,
  }
}

describe("embedding model profiles", () => {
  it("pin every known model to the revision the setup downloads", () => {
    for (const model of EMBEDDING_MODELS) {
      expect(model.revision).toMatch(/^[0-9a-f]{40}$/u)
      expect(defaultEmbeddingModelRevision(model.id)).toBe(model.revision)
    }
  })

  it("keep the models that predate profiles on mean pooling and default precision", () => {
    for (const id of ["intfloat/multilingual-e5-small", "mixedbread-ai/mxbai-embed-xsmall-v1"]) {
      expect(embeddingPooling(id)).toBe("mean")
      expect(embeddingDtype(id)).toBeUndefined()
    }
    expect(embeddingPooling("acme/custom-embedder")).toBe("mean")
    expect(embeddingDtype("acme/custom-embedder")).toBeUndefined()
  })

  it("run Granite R2 quantized with CLS pooling", () => {
    const granite = embeddingModelProfile(
      "onnx-community/granite-embedding-97m-multilingual-r2-ONNX",
    )

    expect(granite).toMatchObject({ dimensions: 384, license: "Apache-2.0" })
    expect(embeddingPooling(granite?.id ?? "")).toBe("cls")
    expect(embeddingDtype(granite?.id ?? "")).toBe("q8")
  })
})

describe("assessEmbeddingModel", () => {
  const e5 = embeddingModelProfile("intfloat/multilingual-e5-small")
  if (!e5) throw new Error("e5 profile missing")

  it("rates a model by the memory it needs to index", () => {
    expect(assessEmbeddingModel(e5, machine(1)).fit).toBe("too-large")
    expect(assessEmbeddingModel(e5, machine(2)).fit).toBe("tight")
    expect(assessEmbeddingModel(e5, machine(16)).fit).toBe("fits")
    expect(assessEmbeddingModel(e5, machine(16, 1)).fit).toBe("tight")
    expect(assessEmbeddingModel(e5, machine(1)).reason).toContain("1.0 GB")
  })
})

describe("recommendEmbeddingModel", () => {
  it("picks the first model that fits comfortably, then one that runs, then none", () => {
    expect(recommendEmbeddingModel(machine(16))?.model.id).toBe(EMBEDDING_MODELS[0]?.id)
    expect(recommendEmbeddingModel(machine(1.2))).toMatchObject({
      model: { id: EMBEDDING_MODELS[0]?.id },
      fit: "tight",
    })
    expect(recommendEmbeddingModel(machine(0.9))?.model.id).toBe(
      "mixedbread-ai/mxbai-embed-xsmall-v1",
    )
    expect(recommendEmbeddingModel(machine(0.25))).toBeNull()
  })
})
