import { createHash } from "node:crypto"
import type { Config } from "./types.js"

const LOCAL_HASH_DIMENSIONS = 384
const LONG_TOKEN_MIN_LENGTH = 6
const LONG_TOKEN_WEIGHT = 1.4
const transformersPipelines = new Map<string, TransformersExtractor>()

type TransformersExtractor = (
  texts: string[],
  options: { pooling: "mean"; normalize: true },
) => Promise<unknown>

export async function embedTexts(texts: string[], config: Config): Promise<number[][]> {
  if (texts.length === 0) {
    return []
  }

  if (config.embeddingProvider === "local-hash") {
    return texts.map(localHashEmbedding)
  }

  return embedWithTransformers(texts, config)
}

export async function embedText(text: string, config: Config): Promise<number[]> {
  const [embedding] = await embedTexts([text], config)
  if (!embedding) {
    throw new Error("No embedding returned for query.")
  }
  return embedding
}

async function embedWithTransformers(texts: string[], config: Config): Promise<number[][]> {
  const extractor = await transformersExtractor(config)
  const output = await extractor(texts, { pooling: "mean", normalize: true })
  const rows = tensorToEmbeddingRows(output)

  if (rows.length !== texts.length) {
    throw new Error(`Expected ${texts.length} embeddings, received ${rows.length}.`)
  }

  return rows
}

async function transformersExtractor(config: Config): Promise<TransformersExtractor> {
  const key = [
    config.embeddingModel,
    config.embeddingModelPath,
    String(config.transformersAllowRemoteModels),
  ].join("\n")
  const cached = transformersPipelines.get(key)
  if (cached) {
    return cached
  }

  const transformers = await import("@huggingface/transformers")
  transformers.env.localModelPath = config.embeddingModelPath
  transformers.env.cacheDir = config.embeddingModelPath
  transformers.env.allowRemoteModels = config.transformersAllowRemoteModels

  const extractor = (await transformers.pipeline(
    "feature-extraction",
    config.embeddingModel,
  )) as TransformersExtractor
  transformersPipelines.set(key, extractor)
  return extractor
}

function localHashEmbedding(text: string): number[] {
  const vector = Array.from({ length: LOCAL_HASH_DIMENSIONS }, () => 0)
  const tokens = tokenize(text)

  for (const token of tokens) {
    const hash = createHash("sha256").update(token).digest()
    const index = hash.readUInt32BE(0) % LOCAL_HASH_DIMENSIONS
    const sign = (hash.at(4) ?? 0) % 2 === 0 ? 1 : -1
    vector[index] = (vector[index] ?? 0) + sign * tokenWeight(token)
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  if (magnitude === 0) {
    return vector
  }
  return vector.map((value) => value / magnitude)
}

function tokenize(text: string): string[] {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/\p{Diacritic}/gu, "")
      .match(/[\p{L}\p{N}]{2,}/gu) ?? []
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
