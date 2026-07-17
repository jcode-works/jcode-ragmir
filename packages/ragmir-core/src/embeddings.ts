import { createHash } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { throwIfAborted } from "./operation.js"
import { tokenize } from "./text.js"
import type { Config } from "./types.js"
import { runWorkload, type WorkloadAdmission } from "./workload.js"

const LOCAL_HASH_DIMENSIONS = 384
const LONG_TOKEN_MIN_LENGTH = 6
const LONG_TOKEN_WEIGHT = 1.4
const CHARACTER_NGRAM_LENGTH = 3
const CHARACTER_NGRAM_WEIGHT = 0.35
/**
 * Maximum number of Transformers.js pipelines kept live in the process. Each
 * pipeline pins ONNX runtime weights (often hundreds of MB), so a long-lived
 * process such as the MCP server that changes embedding config could otherwise
 * leak memory. A small bound is enough: a single project uses one model at a
 * time; the cache is keyed by (model, path, allowRemoteModels).
 */
const MAX_TRANSFORMERS_PIPELINES = 3
const transformersPipelines = new Map<string, TransformersExtractor>()
const pendingTransformersPipelines = new Map<string, Promise<TransformersExtractor>>()
let transformersCacheGeneration = 0
let transformersCacheMutationQueue = Promise.resolve()

declare global {
  var __ragmirTransformersEnvironmentQueue: Promise<void> | undefined
}

interface TransformersExtractor {
  (texts: string[], options: { pooling: "mean"; normalize: true }): Promise<unknown>
  dispose?: () => Promise<void>
}

type EmbeddingInputType = "document" | "query"

export interface PullEmbeddingModelResult {
  embeddingModel: string
  embeddingModelPath: string
}

export async function embedTexts(
  texts: string[],
  config: Config,
  inputType: EmbeddingInputType = "document",
  signal?: AbortSignal,
  onAdmission?: (admission: WorkloadAdmission) => void,
): Promise<number[][]> {
  if (texts.length === 0) {
    return []
  }
  const pendingExtractor =
    config.embeddingProvider === "transformers"
      ? pendingTransformersPipelines.get(transformersCacheKey(config))
      : undefined

  return runWorkload(config, "embedding", signal, async (admission) => {
    onAdmission?.(admission)
    throwIfAborted(signal)
    if (config.embeddingProvider === "local-hash") {
      return texts.map(localHashEmbedding)
    }

    const embeddings = await embedWithTransformers(texts, config, inputType, pendingExtractor)
    throwIfAborted(signal)
    return embeddings
  })
}

export async function pullEmbeddingModel(config: Config): Promise<PullEmbeddingModelResult> {
  await mkdir(config.embeddingModelPath, { recursive: true })
  const extractor = await transformersExtractor({
    ...config,
    embeddingProvider: "transformers",
    transformersAllowRemoteModels: true,
  })
  await extractor(["Ragmir semantic embedding model bootstrap."], {
    pooling: "mean",
    normalize: true,
  })
  return {
    embeddingModel: config.embeddingModel,
    embeddingModelPath: config.embeddingModelPath,
  }
}

export async function embedText(
  text: string,
  config: Config,
  signal?: AbortSignal,
  onAdmission?: (admission: WorkloadAdmission) => void,
): Promise<number[]> {
  const [embedding] = await embedTexts([text], config, "query", signal, onAdmission)
  if (!embedding) {
    throw new Error("No embedding returned for query.")
  }
  return embedding
}

async function embedWithTransformers(
  texts: string[],
  config: Config,
  inputType: EmbeddingInputType,
  pendingExtractor?: Promise<TransformersExtractor>,
): Promise<number[][]> {
  const extractor = await (pendingExtractor ?? transformersExtractor(config))
  const preparedTexts = texts.map((text) =>
    prepareEmbeddingText(text, config.embeddingModel, inputType),
  )
  const output = await extractor(preparedTexts, { pooling: "mean", normalize: true })
  const rows = tensorToEmbeddingRows(output)

  if (rows.length !== texts.length) {
    throw new Error(`Expected ${texts.length} embeddings, received ${rows.length}.`)
  }

  return rows
}

export function prepareEmbeddingText(
  text: string,
  model: string,
  inputType: EmbeddingInputType,
): string {
  if (/(^|\/)(multilingual-)?e5-/iu.test(model)) {
    return `${inputType === "query" ? "query" : "passage"}: ${text}`
  }
  if (inputType === "query" && /(^|\/)mxbai-embed/iu.test(model)) {
    return `Represent this sentence for searching relevant passages: ${text}`
  }
  return text
}

async function transformersExtractor(config: Config): Promise<TransformersExtractor> {
  const key = transformersCacheKey(config)
  const cached = transformersPipelines.get(key)
  if (cached) {
    // Move to the end so the Map insertion order reflects recent use (LRU).
    transformersPipelines.delete(key)
    transformersPipelines.set(key, cached)
    return cached
  }

  const pending = pendingTransformersPipelines.get(key)
  if (pending) {
    return pending
  }

  const generation = transformersCacheGeneration
  const creation = createTransformersExtractor(config).then((extractor) =>
    cacheTransformersPipeline(key, extractor, generation),
  )
  pendingTransformersPipelines.set(key, creation)
  try {
    return await creation
  } finally {
    if (pendingTransformersPipelines.get(key) === creation) {
      pendingTransformersPipelines.delete(key)
    }
  }
}

function transformersCacheKey(config: Config): string {
  return [
    config.embeddingModel,
    config.embeddingModelRevision,
    config.embeddingModelPath,
    String(config.transformersAllowRemoteModels),
  ].join("\n")
}

async function createTransformersExtractor(config: Config): Promise<TransformersExtractor> {
  return withTransformersEnvironment(async () => {
    const transformers = await import("@huggingface/transformers")
    const previous = {
      localModelPath: transformers.env.localModelPath,
      cacheDir: transformers.env.cacheDir,
      allowRemoteModels: transformers.env.allowRemoteModels,
    }
    transformers.env.localModelPath = config.embeddingModelPath
    transformers.env.cacheDir = config.embeddingModelPath
    transformers.env.allowRemoteModels = config.transformersAllowRemoteModels
    try {
      return (await transformers.pipeline("feature-extraction", config.embeddingModel, {
        revision: config.embeddingModelRevision,
      })) as TransformersExtractor
    } finally {
      transformers.env.localModelPath = previous.localModelPath
      transformers.env.cacheDir = previous.cacheDir
      transformers.env.allowRemoteModels = previous.allowRemoteModels
    }
  })
}

async function evictTransformersPipeline(): Promise<void> {
  const evicted: TransformersExtractor[] = []
  while (transformersPipelines.size >= MAX_TRANSFORMERS_PIPELINES) {
    // Map iteration order is insertion order, so the first key is the least
    // recently used entry.
    const oldest = transformersPipelines.keys().next()
    if (oldest.done) {
      break
    }
    const extractor = transformersPipelines.get(oldest.value)
    transformersPipelines.delete(oldest.value)
    if (extractor) {
      evicted.push(extractor)
    }
  }
  await Promise.allSettled(evicted.map((extractor) => extractor.dispose?.()))
}

function cacheTransformersPipeline(
  key: string,
  extractor: TransformersExtractor,
  generation: number,
): Promise<TransformersExtractor> {
  return withTransformersCacheMutation(async () => {
    if (generation !== transformersCacheGeneration) {
      await extractor.dispose?.()
      throw new Error("Transformers cache was cleared while the pipeline was loading.")
    }
    await evictTransformersPipeline()
    if (generation !== transformersCacheGeneration) {
      await extractor.dispose?.()
      throw new Error("Transformers cache was cleared while the pipeline was loading.")
    }
    transformersPipelines.set(key, extractor)
    return extractor
  })
}

/**
 * Release all cached Transformers.js pipelines. Used by `destroy-index` and on
 * embedding-config changes in long-lived processes (MCP server) so stale model
 * weights are not pinned in memory.
 */
export function clearTransformersCache(): void {
  const extractors = takeTransformersCache()
  void disposeTransformersExtractors(extractors)
}

export async function disposeTransformersCache(): Promise<void> {
  const extractors = takeTransformersCache()
  await disposeTransformersExtractors(extractors)
}

function takeTransformersCache(): TransformersExtractor[] {
  transformersCacheGeneration += 1
  const extractors = [...transformersPipelines.values()]
  transformersPipelines.clear()
  pendingTransformersPipelines.clear()
  return extractors
}

function disposeTransformersExtractors(extractors: TransformersExtractor[]): Promise<void> {
  return withTransformersCacheMutation(async () => {
    await Promise.allSettled(extractors.map((extractor) => extractor.dispose?.()))
  })
}

function withTransformersCacheMutation<T>(operation: () => Promise<T>): Promise<T> {
  const queued = transformersCacheMutationQueue.then(operation)
  transformersCacheMutationQueue = queued.then(
    () => undefined,
    () => undefined,
  )
  return queued
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

function localHashEmbedding(text: string): number[] {
  const vector = Array.from({ length: LOCAL_HASH_DIMENSIONS }, () => 0)
  const tokens = tokenize(text)

  for (const token of tokens) {
    addHashedFeature(vector, token, tokenWeight(token))
    for (const ngram of characterNgrams(token)) {
      addHashedFeature(vector, `ngram:${ngram}`, CHARACTER_NGRAM_WEIGHT)
    }
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  if (magnitude === 0) {
    return vector
  }
  return vector.map((value) => value / magnitude)
}

function addHashedFeature(vector: number[], feature: string, weight: number): void {
  const hash = createHash("sha256").update(feature).digest()
  const index = hash.readUInt32BE(0) % LOCAL_HASH_DIMENSIONS
  const sign = (hash.at(4) ?? 0) % 2 === 0 ? 1 : -1
  vector[index] = (vector[index] ?? 0) + sign * weight
}

function characterNgrams(token: string): string[] {
  const characters = [...token]
  if (characters.length < CHARACTER_NGRAM_LENGTH) {
    return []
  }
  return Array.from({ length: characters.length - CHARACTER_NGRAM_LENGTH + 1 }, (_value, index) =>
    characters.slice(index, index + CHARACTER_NGRAM_LENGTH).join(""),
  )
}

function tokenWeight(token: string): number {
  return token.length >= LONG_TOKEN_MIN_LENGTH ? LONG_TOKEN_WEIGHT : 1
}

function tensorToEmbeddingRows(output: unknown): number[][] {
  if (!hasToList(output)) {
    throw new Error("Transformers embedding output does not expose tolist().")
  }

  const value = output.tolist()
  if (isNumberMatrix(value)) {
    return value
  }
  if (isNumberArray(value)) {
    return [value]
  }

  throw new Error("Transformers embedding output is not a numeric vector matrix.")
}

function hasToList(value: unknown): value is { tolist: () => unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    "tolist" in value &&
    typeof value.tolist === "function"
  )
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number")
}

function isNumberMatrix(value: unknown): value is number[][] {
  return Array.isArray(value) && value.every(isNumberArray)
}
