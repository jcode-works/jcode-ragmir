import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createRagmirClient, evaluateGoldenQueries } from "../dist/index.js"
import { CORPUS_PRESETS, generateCorpus } from "./lib/corpus.mjs"
import { environmentMetadata, sha256, stableJson } from "./lib/metrics.mjs"

const options = parseArguments(process.argv.slice(2))
const invocationRoot = process.env.INIT_CWD ?? process.cwd()
const size = String(options.size ?? "S").toUpperCase()
if (!(size in CORPUS_PRESETS)) {
  throw new Error(`Unknown corpus size: ${size}`)
}
const provider = String(options.provider ?? "local-hash")
if (provider !== "local-hash" && provider !== "transformers") {
  throw new Error(`Unknown embedding provider: ${provider}`)
}
const seed = String(options.seed ?? "ragmir-benchmark-v1")
const model = String(options.model ?? "intfloat/multilingual-e5-small")
const modelRevision = String(options.modelRevision ?? "main")
const modelPath = path.resolve(
  options.modelPath ?? path.join(invocationRoot, ".ragmir", "models"),
)
const resultPath = path.resolve(
  invocationRoot,
  options.result ??
    `packages/ragmir-core/benchmarks/.results/quality-${size}-${provider}.json`,
)
const roots = []

try {
  const first = await runCleanEvaluation("first")
  const second = await runCleanEvaluation("second")
  const reproducible =
    first.corpusHash === second.corpusHash &&
    first.qualityFingerprint === second.qualityFingerprint
  const result = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    environment: environmentMetadata(),
    configuration: { size, provider, model, modelRevision, seed },
    reproducible,
    first,
    second,
    passed: reproducible && first.quality.passed && second.quality.passed,
  }
  await mkdir(path.dirname(resultPath), { recursive: true })
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8")
  process.stdout.write(`${JSON.stringify({ resultPath, ...result }, null, 2)}\n`)
  if (!result.passed) {
    process.exitCode = 1
  }
} finally {
  if (options.keep === true) {
    for (const root of roots) {
      process.stderr.write(`Quality project preserved at ${root}\n`)
    }
  } else {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
  }
}

async function runCleanEvaluation(label) {
  const root = await mkdtemp(path.join(os.tmpdir(), `ragmir-quality-${label}-`))
  roots.push(root)
  const corpus = await generateCorpus({
    root,
    targetChunks: CORPUS_PRESETS[size],
    seed,
    provider,
    model,
    modelRevision,
    modelPath,
    goldenCount: 100,
  })
  const client = await createRagmirClient({ cwd: root })
  let ingest
  try {
    ingest = await client.ingest({ rebuild: true })
  } finally {
    await client.close()
  }
  const evaluation = await evaluateGoldenQueries({
    cwd: root,
    goldenPath: corpus.goldenPath,
    topK: 10,
  })
  const quality = reproducibleQuality(evaluation)
  return {
    corpusHash: corpus.corpusHash,
    goldenFingerprint: evaluation.goldenFingerprint,
    actualChunks: ingest.chunks,
    files: ingest.indexedFiles,
    qualityFingerprint: sha256(stableJson(quality)),
    quality,
  }
}

function reproducibleQuality(result) {
  return {
    total: result.total,
    hits: result.hits,
    misses: result.misses,
    recallAt: result.recallAt,
    precisionAt5: result.precisionAt5,
    meanReciprocalRankAt10: result.meanReciprocalRankAt10,
    ndcgAt10: result.ndcgAt10,
    exactCitationRate: result.exactCitationRate,
    falsePositiveRate: result.falsePositiveRate,
    abstentionAccuracy: result.abstentionAccuracy,
    thresholds: result.thresholds,
    gates: result.gates,
    groups: result.groups,
    passed: result.passed,
    verificationEligible: result.verificationEligible,
    cases: result.cases.map((testCase) => ({
      id: testCase.id,
      category: testCase.category,
      locale: testCase.locale,
      answerable: testCase.answerable,
      returnedPaths: testCase.returnedPaths,
      returnedCitations: testCase.returnedCitations,
      recallAt: testCase.recallAt,
      precisionAt5: testCase.precisionAt5,
      reciprocalRankAt10: testCase.reciprocalRankAt10,
      ndcgAt10: testCase.ndcgAt10,
      abstained: testCase.abstained,
    })),
  }
}

function parseArguments(values) {
  const parsed = {}
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (!value?.startsWith("--")) {
      continue
    }
    const key = value.slice(2).replace(/-([a-z])/gu, (_match, letter) => letter.toUpperCase())
    const next = values[index + 1]
    if (next === undefined || next.startsWith("--")) {
      parsed[key] = true
    } else {
      parsed[key] = next
      index += 1
    }
  }
  return parsed
}
