import { createHash } from "node:crypto"
import path from "node:path"
import { DEFAULT_CONFIG } from "../dist/defaults.js"
import {
  embedTexts,
  retainEmbeddingModel,
  transformersCacheSnapshotForTests,
} from "../dist/embeddings.js"

const variant = process.env.RAGMIR_MODEL_LIFECYCLE_VARIANT === "switch" ? "switch" : "single"
const projectRoot = process.cwd()
const invocationRoot = process.env.INIT_CWD ?? projectRoot
const modelPath = path.resolve(
  process.env.RAGMIR_BENCH_MODEL_PATH ?? path.join(invocationRoot, ".ragmir", "models"),
)
const model = process.env.RAGMIR_BENCH_MODEL ?? "mixedbread-ai/mxbai-embed-xsmall-v1"
const revision =
  process.env.RAGMIR_BENCH_MODEL_REVISION ?? "e6ac24e5d6efb8782b59de1647b3ececb4ece94e"
const digest =
  process.env.RAGMIR_BENCH_MODEL_DIGEST ??
  "sha256:8da5ea361dddbfd4203fbae01eb1708b22357577eee88a00f236c4f9c2f823fd"

const firstConfig = modelConfig(
  variant === "switch" ? `sha256:${"a".repeat(64)}` : digest,
  "first",
)
const secondConfig = modelConfig(digest, "second")
const first = await loadModel(firstConfig)
await first.releaseOwner()
await settleMemory()
const afterFirstDisposeRssBytes = process.memoryUsage().rss
const live = await loadModel(secondConfig)
const liveRssBytes = process.memoryUsage().rss
await live.releaseOwner()
await settleMemory()

process.stdout.write(
  `${JSON.stringify({
    variant,
    firstLiveRssBytes: first.liveRssBytes,
    afterFirstDisposeRssBytes,
    liveRssBytes,
    vectorFingerprint: live.vectorFingerprint,
    finalRssBytes: process.memoryUsage().rss,
    finalCache: transformersCacheSnapshotForTests(),
  })}\n`,
)

function modelConfig(embeddingModelDigest, suffix) {
  return {
    ...DEFAULT_CONFIG,
    projectRoot: path.join(projectRoot, `.ragmir-model-lifecycle-${suffix}`),
    rawDir: path.join(projectRoot, DEFAULT_CONFIG.rawDir),
    storageDir: path.join(projectRoot, DEFAULT_CONFIG.storageDir),
    sourcesFile: path.join(projectRoot, DEFAULT_CONFIG.sourcesFile),
    accessLogPath: path.join(projectRoot, DEFAULT_CONFIG.accessLogPath),
    embeddingModelPath: modelPath,
    embeddingProvider: "transformers",
    embeddingModel: model,
    embeddingModelRevision: revision,
    embeddingModelDigest,
    transformersAllowRemoteModels: false,
    accessLog: false,
  }
}

async function loadModel(config) {
  const releaseOwner = retainEmbeddingModel(config)
  const [vector] = await embedTexts(["Represent local model lifecycle evidence."], config, "query")
  return {
    releaseOwner,
    liveRssBytes: process.memoryUsage().rss,
    vectorFingerprint: createHash("sha256")
      .update(JSON.stringify(vector ?? []))
      .digest("hex"),
  }
}

async function settleMemory() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    global.gc?.()
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}
