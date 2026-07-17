import { registerHooks } from "node:module"
import path from "node:path"

const forbidden = /(?:@huggingface\/transformers|onnxruntime|sharp)/iu
const resolutions = []

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (forbidden.test(specifier)) {
      resolutions.push(specifier)
      throw new Error(`local-hash attempted to load forbidden runtime ${specifier}.`)
    }
    return nextResolve(specifier, context)
  },
})

const [{ embedTexts }, { DEFAULT_CONFIG }] = await Promise.all([
  import("../dist/embeddings.js"),
  import("../dist/defaults.js"),
])
const projectRoot = process.cwd()
const config = {
  ...DEFAULT_CONFIG,
  projectRoot,
  rawDir: path.join(projectRoot, DEFAULT_CONFIG.rawDir),
  storageDir: path.join(projectRoot, DEFAULT_CONFIG.storageDir),
  sourcesFile: path.join(projectRoot, DEFAULT_CONFIG.sourcesFile),
  accessLogPath: path.join(projectRoot, DEFAULT_CONFIG.accessLogPath),
  embeddingModelPath: path.join(projectRoot, DEFAULT_CONFIG.embeddingModelPath),
  accessLog: false,
}
const embeddings = await embedTexts(["offline local retrieval", "deterministic evidence"], config)

process.stdout.write(
  `${JSON.stringify({
    provider: config.embeddingProvider,
    rows: embeddings.length,
    dimensions: embeddings[0]?.length ?? 0,
    forbiddenResolutions: resolutions,
    passed: embeddings.length === 2 && embeddings[0]?.length === 384 && resolutions.length === 0,
  })}\n`,
)
