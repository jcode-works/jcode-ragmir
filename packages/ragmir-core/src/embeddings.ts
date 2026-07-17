import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { mkdir, readdir, stat } from "node:fs/promises"
import path from "node:path"
import { throwIfAborted } from "./operation.js"
import { tokenize } from "./text.js"
import type { Config, IngestionEmbeddingModelState } from "./types.js"
import { runWorkload, type WorkloadAdmission } from "./workload.js"

const LOCAL_HASH_DIMENSIONS = 384
const LONG_TOKEN_MIN_LENGTH = 6
const LONG_TOKEN_WEIGHT = 1.4
const CHARACTER_NGRAM_LENGTH = 3
const CHARACTER_NGRAM_WEIGHT = 0.35
/**
 * Maximum number of idle Transformers.js pipelines kept live in the process.
 * Active leases may temporarily overlap during a model switch, but a retired
 * pipeline is disposed as soon as its final lease is released.
 */
const MAX_TRANSFORMERS_PIPELINES = 1
const transformersPipelines = new Map<string, TransformersPipelineEntry>()
const transformersModelOwners = new Map<string, number>()

declare global {
  var __ragmirTransformersEnvironmentQueue: Promise<void> | undefined
}

interface TransformersExtractor {
  (texts: string[], options: { pooling: "mean"; normalize: true }): Promise<unknown>
  dispose?: () => Promise<void>
}

interface TransformersPipelineEntry {
  key: string
  creation: Promise<TransformersExtractor>
  leases: number
  retired: boolean
  idleWaiters: Array<() => void>
  disposal: Promise<void> | undefined
}

interface TransformersPipelineLease {
  extractor: TransformersExtractor
  release(): Promise<void>
}

type EmbeddingInputType = "document" | "query"

export interface PullEmbeddingModelResult {
  embeddingModel: string
  embeddingModelRevision: string
  embeddingModelDigest: string
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
  return runWorkload(config, "embedding", signal, async (admission) => {
    onAdmission?.(admission)
    throwIfAborted(signal)
    if (config.embeddingProvider === "local-hash") {
      return texts.map(localHashEmbedding)
    }

    const embeddings = await embedWithTransformers(texts, config, inputType)
    throwIfAborted(signal)
    return embeddings
  })
}

export async function pullEmbeddingModel(config: Config): Promise<PullEmbeddingModelResult> {
  await mkdir(config.embeddingModelPath, { recursive: true })
  const pullConfig = {
    ...config,
    embeddingProvider: "transformers",
    transformersAllowRemoteModels: true,
  } satisfies Config
  const lease = await acquireTransformersPipeline(pullConfig)
  try {
    await lease.extractor(["Ragmir semantic embedding model bootstrap."], {
      pooling: "mean",
      normalize: true,
    })
    const embeddingModelDigest = await resolveEmbeddingModelDigest(pullConfig)
    if (
      config.embeddingModelDigest !== null &&
      config.embeddingModelDigest !== embeddingModelDigest
    ) {
      throw new Error(
        `Embedding model digest mismatch: expected ${config.embeddingModelDigest}, received ${embeddingModelDigest}.`,
      )
    }
    return {
      embeddingModel: config.embeddingModel,
      embeddingModelRevision: config.embeddingModelRevision,
      embeddingModelDigest,
      embeddingModelPath: config.embeddingModelPath,
    }
  } finally {
    await lease.release()
    await disposeTransformersModel(pullConfig)
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

export function embeddingModelState(
  config: Config,
): Exclude<IngestionEmbeddingModelState, "mixed" | "unused"> {
  if (config.embeddingProvider === "local-hash") {
    return "stateless"
  }
  return transformersPipelines.has(transformersCacheKey(config)) ? "warm" : "cold"
}

async function embedWithTransformers(
  texts: string[],
  config: Config,
  inputType: EmbeddingInputType,
): Promise<number[][]> {
  const lease = await acquireTransformersPipeline(config)
  try {
    const preparedTexts = texts.map((text) =>
      prepareEmbeddingText(text, config.embeddingModel, inputType),
    )
    const output = await lease.extractor(preparedTexts, { pooling: "mean", normalize: true })
    const rows = tensorToEmbeddingRows(output)

    if (rows.length !== texts.length) {
      throw new Error(`Expected ${texts.length} embeddings, received ${rows.length}.`)
    }

    return rows
  } finally {
    await lease.release()
  }
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

async function acquireTransformersPipeline(config: Config): Promise<TransformersPipelineLease> {
  const key = transformersCacheKey(config)
  let entry = transformersPipelines.get(key)
  if (entry) {
    transformersPipelines.delete(key)
    transformersPipelines.set(key, entry)
  } else {
    entry = {
      key,
      creation: createTransformersExtractor(config),
      leases: 0,
      retired: false,
      idleWaiters: [],
      disposal: undefined,
    }
    transformersPipelines.set(key, entry)
    void entry.creation.catch(() => {
      if (transformersPipelines.get(key) === entry) {
        transformersPipelines.delete(key)
      }
    })
    evictTransformersPipelines(key)
  }

  entry.leases += 1
  try {
    const extractor = await entry.creation
    let released = false
    return {
      extractor,
      async release() {
        if (released) {
          return
        }
        released = true
        await releaseTransformersLease(entry)
      },
    }
  } catch (error) {
    await releaseTransformersLease(entry)
    throw error
  }
}

function transformersCacheKey(config: Config): string {
  return [
    config.embeddingModel,
    config.embeddingModelRevision,
    config.embeddingModelDigest ?? "unverified",
    config.embeddingModelPath,
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

function evictTransformersPipelines(retainedKey: string): void {
  while (transformersPipelines.size > MAX_TRANSFORMERS_PIPELINES) {
    const candidate = [...transformersPipelines.entries()].find(([key]) => key !== retainedKey)
    if (!candidate) {
      break
    }
    void retireTransformersPipeline(candidate[1])
  }
}

async function releaseTransformersLease(entry: TransformersPipelineEntry): Promise<void> {
  entry.leases -= 1
  if (entry.leases < 0) {
    throw new Error("Transformers pipeline lease count became negative.")
  }
  if (entry.leases === 0) {
    for (const resolve of entry.idleWaiters.splice(0)) {
      resolve()
    }
  }
  if (entry.retired) {
    await entry.disposal
  }
}

function retireTransformersPipeline(entry: TransformersPipelineEntry): Promise<void> {
  if (!entry.retired) {
    entry.retired = true
    if (transformersPipelines.get(entry.key) === entry) {
      transformersPipelines.delete(entry.key)
    }
  }
  entry.disposal ??= (async () => {
    if (entry.leases > 0) {
      await new Promise<void>((resolve) => entry.idleWaiters.push(resolve))
    }
    try {
      const extractor = await entry.creation
      await extractor.dispose?.()
    } catch {
      // Failed pipeline creation has no live native session to release.
    }
  })()
  return entry.disposal
}

/**
 * Release all cached Transformers.js pipelines. Used by `destroy-index` and on
 * embedding-config changes in long-lived processes (MCP server) so stale model
 * weights are not pinned in memory.
 */
export function clearTransformersCache(): void {
  for (const entry of takeTransformersCache()) {
    void retireTransformersPipeline(entry)
  }
}

export async function disposeTransformersCache(): Promise<void> {
  await Promise.all(takeTransformersCache().map(retireTransformersPipeline))
}

export async function disposeTransformersModel(config: Config): Promise<void> {
  const entry = transformersPipelines.get(transformersCacheKey(config))
  if (entry) {
    await retireTransformersPipeline(entry)
  }
}

export function retainEmbeddingModel(config: Config): () => Promise<void> {
  if (config.embeddingProvider !== "transformers") {
    return async () => undefined
  }
  const key = transformersCacheKey(config)
  transformersModelOwners.set(key, (transformersModelOwners.get(key) ?? 0) + 1)
  let released = false
  return async () => {
    if (released) {
      return
    }
    released = true
    const owners = transformersModelOwners.get(key) ?? 0
    if (owners <= 1) {
      transformersModelOwners.delete(key)
      await disposeTransformersModel(config)
      return
    }
    transformersModelOwners.set(key, owners - 1)
  }
}

export function transformersCacheSnapshotForTests(): {
  entries: number
  activeLeases: number
  owners: number
} {
  return {
    entries: transformersPipelines.size,
    activeLeases: [...transformersPipelines.values()].reduce(
      (total, entry) => total + entry.leases,
      0,
    ),
    owners: [...transformersModelOwners.values()].reduce((total, owners) => total + owners, 0),
  }
}

function takeTransformersCache(): TransformersPipelineEntry[] {
  const entries = [...transformersPipelines.values()]
  transformersPipelines.clear()
  return entries
}

async function resolveEmbeddingModelDigest(config: Config): Promise<string> {
  const modelRoot = embeddingModelRoot(config)
  const files = await modelArtifactFiles(modelRoot)
  if (files.length === 0) {
    throw new Error(`No embedding model artifacts found under ${modelRoot}.`)
  }
  const identity = createHash("sha256")
  for (const filename of files) {
    const relativePath = path.relative(modelRoot, filename).split(path.sep).join("/")
    const metadata = await stat(filename)
    const digest = await sha256File(filename)
    identity.update(relativePath)
    identity.update("\0")
    identity.update(String(metadata.size))
    identity.update("\0")
    identity.update(digest)
    identity.update("\n")
  }
  return `sha256:${identity.digest("hex")}`
}

function embeddingModelRoot(config: Config): string {
  const base = path.resolve(config.embeddingModelPath)
  const root = path.resolve(base, config.embeddingModel)
  if (root === base || !root.startsWith(`${base}${path.sep}`)) {
    throw new Error("embeddingModel must resolve inside embeddingModelPath.")
  }
  return root
}

async function modelArtifactFiles(directory: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await modelArtifactFiles(filename)))
    } else if (entry.isFile()) {
      files.push(filename)
    } else if (entry.isSymbolicLink()) {
      throw new Error(`Embedding model artifacts must not contain symbolic links: ${filename}`)
    }
  }
  return files.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
}

async function sha256File(filename: string): Promise<string> {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(filename)) {
    hash.update(chunk)
  }
  return hash.digest("hex")
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
