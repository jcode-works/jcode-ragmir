import { formatMemory, type HardwareProfile } from "./hardware.js"

/** How a model turns token vectors into one passage vector. */
export type EmbeddingPooling = "mean" | "cls"

/** Weight precision Transformers.js loads; `fp32` is its default on Node.js CPU. */
export type EmbeddingDtype = "fp32" | "q8"

/**
 * A semantic model Ragmir knows how to run: its pinned files, how to call it, and what it costs.
 * Models outside this list still work with mean pooling and no prefix, but nothing is calibrated.
 */
export interface EmbeddingModelProfile {
  id: string
  /** Immutable commit the setup downloads and pins. */
  revision: string
  languages: "multilingual" | "english"
  parameters: string
  dimensions: number
  maxTokens: number
  license: string
  dtype: EmbeddingDtype
  pooling: EmbeddingPooling
  /** Download for the weights and tokenizer, in megabytes. */
  downloadMegabytes: number
  /**
   * Memory a CPU ingestion needs, with a margin over the peak resident size measured while
   * indexing on Apple Silicon (Granite R2 0.66 GB, e5-small 1.06 GB, mxbai 0.49 GB).
   */
  memoryBytes: number
  /** Search evidence thresholds measured for this model ship with Ragmir. */
  calibrated: boolean
  summary: string
}

const GIB = 1024 ** 3

/** Known models, best general choice first. Ordering drives the recommendation. */
export const EMBEDDING_MODELS: readonly EmbeddingModelProfile[] = [
  {
    id: "onnx-community/granite-embedding-97m-multilingual-r2-ONNX",
    revision: "536a9f241cb3f02a9c5995a1e708c784bd274859",
    languages: "multilingual",
    parameters: "97M",
    dimensions: 384,
    maxTokens: 32_768,
    license: "Apache-2.0",
    dtype: "q8",
    pooling: "cls",
    downloadMegabytes: 124,
    memoryBytes: 1 * GIB,
    calibrated: true,
    summary:
      "IBM Granite R2: multilingual, 32k-token context, ahead of e5-small on public retrieval and code benchmarks for a quarter of the download.",
  },
  {
    id: "intfloat/multilingual-e5-small",
    revision: "614241f622f53c4eeff9890bdc4f31cfecc418b3",
    languages: "multilingual",
    parameters: "118M",
    dimensions: 384,
    maxTokens: 512,
    license: "MIT",
    dtype: "fp32",
    pooling: "mean",
    downloadMegabytes: 492,
    memoryBytes: 1.5 * GIB,
    calibrated: true,
    summary: "The established multilingual default; short 512-token passages.",
  },
  {
    id: "mixedbread-ai/mxbai-embed-xsmall-v1",
    revision: "e6ac24e5d6efb8782b59de1647b3ececb4ece94e",
    languages: "english",
    parameters: "24M",
    dimensions: 384,
    maxTokens: 4_096,
    license: "Apache-2.0",
    dtype: "fp32",
    pooling: "mean",
    downloadMegabytes: 97,
    memoryBytes: 0.75 * GIB,
    calibrated: true,
    summary: "The lightest option, for English corpora on small machines.",
  },
]

export function embeddingModelProfile(model: string): EmbeddingModelProfile | undefined {
  return EMBEDDING_MODELS.find((profile) => profile.id === model)
}

/** Pooling for any model id: the profile's, or mean pooling for models Ragmir does not know. */
export function embeddingPooling(model: string): EmbeddingPooling {
  return embeddingModelProfile(model)?.pooling ?? "mean"
}

/**
 * The precision to request, or undefined to keep Transformers.js's default. Models that predate
 * profiles load exactly as before, so their existing indexes stay valid.
 */
export function embeddingDtype(model: string): EmbeddingDtype | undefined {
  const dtype = embeddingModelProfile(model)?.dtype
  return dtype === "fp32" ? undefined : dtype
}

export type ModelFit = "fits" | "tight" | "too-large"

export interface ModelAssessment {
  model: EmbeddingModelProfile
  fit: ModelFit
  /** One sentence for a person or an agent choosing a model on this machine. */
  reason: string
}

/**
 * How a model suits this machine. Memory decides: a model needing more than the machine has will
 * swap or fail, and one needing more than half of it competes with the editor and the agent.
 */
export function assessEmbeddingModel(
  model: EmbeddingModelProfile,
  hardware: HardwareProfile,
): ModelAssessment {
  const memory = formatMemory(hardware.memoryBytes)
  if (hardware.memoryBytes < model.memoryBytes) {
    return {
      model,
      fit: "too-large",
      reason: `Needs about ${formatMemory(model.memoryBytes)} to index; this machine has ${memory}.`,
    }
  }
  if (hardware.memoryBytes < model.memoryBytes * 2 || hardware.logicalCpus < 2) {
    return {
      model,
      fit: "tight",
      reason: `Runs within ${memory}, but indexing will be slow and compete with other work.`,
    }
  }
  return {
    model,
    fit: "fits",
    reason: `Comfortable with ${memory} and ${hardware.logicalCpus} CPUs.`,
  }
}

/**
 * The model `rgr setup --semantic` picks when the project has not chosen one: the first known
 * model that fits comfortably, else the first that runs at all, else none (stay on local-hash).
 */
export function recommendEmbeddingModel(
  hardware: HardwareProfile,
  models: readonly EmbeddingModelProfile[] = EMBEDDING_MODELS,
): ModelAssessment | null {
  const assessments = models.map((model) => assessEmbeddingModel(model, hardware))
  return (
    assessments.find((assessment) => assessment.fit === "fits") ??
    assessments.find((assessment) => assessment.fit === "tight") ??
    null
  )
}
