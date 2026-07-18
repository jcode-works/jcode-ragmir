import { spawn } from "node:child_process"
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { fileURLToPath } from "node:url"
import {
  AutoModelForSequenceClassification,
  AutoTokenizer,
  env,
} from "@huggingface/transformers"
import { createRagmirClient } from "../dist/index.js"
import { CORPUS_PRESETS, generateCorpus } from "./lib/corpus.mjs"
import { environmentMetadata } from "./lib/metrics.mjs"

const benchmarkPath = fileURLToPath(import.meta.url)
const packageRoot = path.resolve(path.dirname(benchmarkPath), "..")
const invocationRoot = process.env.INIT_CWD ?? process.cwd()
const options = parseArguments(process.argv.slice(2))
const model = options.model ?? "mixedbread-ai/mxbai-rerank-xsmall-v1"
const revision = options.revision ?? "b5c6e9da73abc3711f593f705371cdbe9e0fe422"
const dtype = options.dtype ?? "q8"
const modelPath = path.resolve(options.modelPath ?? path.join(invocationRoot, ".ragmir/models"))

if (options.coldWorker) {
  const startedAt = performance.now()
  const rssBeforeBytes = process.memoryUsage().rss
  const reranker = await loadReranker({ localFilesOnly: true })
  const result = {
    coldStartMs: performance.now() - startedAt,
    rssBeforeBytes,
    rssAfterBytes: process.memoryUsage().rss,
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
  await reranker.model.dispose()
  process.exit(0)
}

const size = String(options.size ?? "XS").toUpperCase()
if (!(size in CORPUS_PRESETS)) throw new Error(`Unknown corpus size: ${size}`)
const seed = options.seed ?? "ragmir-benchmark-v1"
const candidateLimit = positiveInteger(options.candidateLimit ?? "20", "candidate-limit")
const p95BudgetMs = positiveNumber(options.p95BudgetMs ?? "100", "p95-budget-ms")
const rssBudgetBytes =
  positiveNumber(options.rssBudgetMib ?? "2048", "rss-budget-mib") * 1024 * 1024
const coldStartBudgetMs = positiveNumber(
  options.coldStartBudgetMs ?? "10000",
  "cold-start-budget-ms",
)
const resultPath = path.resolve(
  options.result ?? path.join(packageRoot, "benchmarks/.results/exp-002-reranker.json"),
)
const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ragmir-reranker-"))

try {
  await mkdir(modelPath, { recursive: true })
  const preparationStartedAt = performance.now()
  const prepared = await loadReranker({ localFilesOnly: false })
  const preparationMs = performance.now() - preparationStartedAt
  await prepared.model.dispose()

  const coldStart = await runColdStartWorker()
  const modelDirectory = path.join(modelPath, ...model.split("/"))
  const modelSizeBytes = await directorySize(modelDirectory)
  const reranker = await loadReranker({ localFilesOnly: true })
  const corpus = await generateCorpus({
    root: projectRoot,
    targetChunks: CORPUS_PRESETS[size],
    seed,
    provider: "local-hash",
    model: "intfloat/multilingual-e5-small",
    modelRevision: "main",
    modelPath,
    goldenCount: 100,
    retrievalProfile: "balanced",
  })
  const client = await createRagmirClient({ cwd: projectRoot })
  let ingest
  let evaluation
  try {
    ingest = await client.ingest({ rebuild: true })
    evaluation = await evaluateReranker(client, corpus.goldenQueries, reranker)
  } finally {
    await client.close()
    await reranker.model.dispose()
  }

  const ndcgGain = evaluation.reranked.quality.ndcgAt10 - evaluation.baseline.quality.ndcgAt10
  const gates = {
    ndcgGain: ndcgGain >= 0.03,
    p95Latency: evaluation.reranked.latency.p95Ms <= p95BudgetMs,
    peakRss: evaluation.peakRssBytes <= rssBudgetBytes,
    coldStart: coldStart.coldStartMs <= coldStartBudgetMs,
    citations:
      evaluation.reranked.quality.exactCitationRate >=
      evaluation.baseline.quality.exactCitationRate,
    localOfflineLoad: true,
  }
  const accepted = Object.values(gates).every(Boolean)
  const result = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    environment: environmentMetadata(),
    configuration: {
      size,
      seed,
      provider: "local-hash",
      retrievalProfile: "balanced",
      candidateLimit,
      model,
      revision,
      dtype,
      p95BudgetMs,
      rssBudgetBytes,
      coldStartBudgetMs,
    },
    corpus: {
      hash: corpus.corpusHash,
      files: ingest.indexedFiles,
      chunks: ingest.chunks,
      queries: corpus.goldenQueries.length,
    },
    model: {
      preparationMs,
      coldStartMs: coldStart.coldStartMs,
      coldStartRssDeltaBytes: coldStart.rssAfterBytes - coldStart.rssBeforeBytes,
      sizeBytes: modelSizeBytes,
      cachePath: path.relative(invocationRoot, modelDirectory),
      offlineEvaluation: true,
    },
    baseline: evaluation.baseline,
    reranked: evaluation.reranked,
    peakRssBytes: evaluation.peakRssBytes,
    ndcgGain,
    gates,
    decision: accepted ? "accept" : "reject",
    passed: true,
  }
  await mkdir(path.dirname(resultPath), { recursive: true })
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8")
  process.stdout.write(`${JSON.stringify({ resultPath, ...result }, null, 2)}\n`)
} finally {
  await rm(projectRoot, { recursive: true, force: true })
}

async function loadReranker({ localFilesOnly }) {
  env.cacheDir = modelPath
  env.allowRemoteModels = !localFilesOnly
  const modelSource = localFilesOnly
    ? path.join(modelPath, ...model.split("/"), revision)
    : model
  const common = localFilesOnly
    ? { local_files_only: true }
    : { revision, cache_dir: modelPath, local_files_only: false }
  const [tokenizer, loadedModel] = await Promise.all([
    AutoTokenizer.from_pretrained(modelSource, common),
    AutoModelForSequenceClassification.from_pretrained(modelSource, { ...common, dtype }),
  ])
  return { tokenizer, model: loadedModel }
}

async function runColdStartWorker() {
  const args = [
    benchmarkPath,
    "--cold-worker",
    "--model",
    model,
    "--revision",
    revision,
    "--dtype",
    dtype,
    "--model-path",
    modelPath,
  ]
  const { stdout } = await spawnResult(process.execPath, args)
  return JSON.parse(stdout.trim())
}

async function evaluateReranker(client, goldenQueries, reranker) {
  const baselineCases = []
  const rerankedCases = []
  const baselineLatencies = []
  const rerankedLatencies = []
  let peakRssBytes = process.memoryUsage().rss

  for (const testCase of goldenQueries) {
    const startedAt = performance.now()
    const rows = await client.search(testCase.query, {
      topK: candidateLimit,
      ...(testCase.includePaths === undefined ? {} : { includePaths: testCase.includePaths }),
      ...(testCase.excludePaths === undefined ? {} : { excludePaths: testCase.excludePaths }),
      ...(testCase.contextPaths === undefined ? {} : { contextPaths: testCase.contextPaths }),
    })
    const searchMs = performance.now() - startedAt
    const reranked = await rerankRows(testCase.query, rows, reranker)
    const rerankedMs = performance.now() - startedAt
    baselineLatencies.push(searchMs)
    rerankedLatencies.push(rerankedMs)
    baselineCases.push(evaluateCase(testCase, rows.slice(0, 10)))
    rerankedCases.push(evaluateCase(testCase, reranked.slice(0, 10)))
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss)
  }

  return {
    baseline: summarize(baselineCases, baselineLatencies),
    reranked: summarize(rerankedCases, rerankedLatencies),
    peakRssBytes,
  }
}

async function rerankRows(query, rows, reranker) {
  if (rows.length < 2) return rows
  const inputs = reranker.tokenizer(new Array(rows.length).fill(query), {
    text_pair: rows.map((row) => row.text),
    padding: true,
    truncation: true,
    max_length: 512,
  })
  let logits
  let probabilities
  try {
    ;({ logits } = await reranker.model(inputs))
    probabilities = logits.sigmoid()
    const scores = probabilities.tolist().map(([score]) => score)
    return rows
      .map((row, rank) => ({ row, rank, score: scores[rank] ?? Number.NEGATIVE_INFINITY }))
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.rank - right.rank ||
          left.row.relativePath.localeCompare(right.row.relativePath) ||
          left.row.chunkIndex - right.row.chunkIndex,
      )
      .map(({ row }) => row)
  } finally {
    disposeTensors(inputs)
    probabilities?.dispose()
    logits?.dispose()
  }
}

function evaluateCase(testCase, rows) {
  const answerable = testCase.answerable !== false
  const exactCitation = (testCase.expectedCitations ?? []).length > 0
  const returned = rows.map((row) => (exactCitation ? row.citation : row.relativePath))
  const expected = exactCitation ? testCase.expectedCitations : testCase.expectedPaths
  const judgments =
    exactCitation || (testCase.relevanceJudgments ?? []).length === 0
      ? expected.map((value) => ({ value, relevance: 1 }))
      : testCase.relevanceJudgments
          .filter((judgment) => judgment.kind === "path")
          .map(({ value, relevance }) => ({ value, relevance }))
  return {
    answerable,
    exactCitation,
    locale: testCase.locale ?? "unknown",
    returned: rows.length,
    recallAt1: answerable ? recallAtK(returned, judgments, 1) : 0,
    recallAt3: answerable ? recallAtK(returned, judgments, 3) : 0,
    recallAt5: answerable ? recallAtK(returned, judgments, 5) : 0,
    recallAt10: answerable ? recallAtK(returned, judgments, 10) : 0,
    reciprocalRankAt10: answerable ? reciprocalRankAtK(returned, judgments, 10) : 0,
    ndcgAt10: answerable ? gradedNdcgAtK(returned, judgments, 10) : 0,
    exactCitationHit: exactCitation ? recallAtK(returned, judgments, 10) > 0 : null,
    falsePositive: !answerable && rows.length > 0,
  }
}

function summarize(cases, latencies) {
  const answerable = cases.filter((item) => item.answerable)
  const citations = cases.filter((item) => item.exactCitation)
  const unanswerable = cases.filter((item) => !item.answerable)
  const quality = summarizeQuality(answerable, citations, unanswerable)
  const locales = Object.fromEntries(
    [...new Set(cases.map((item) => item.locale))]
      .sort()
      .map((locale) => {
        const localeCases = cases.filter((item) => item.locale === locale)
        return [
          locale,
          summarizeQuality(
            localeCases.filter((item) => item.answerable),
            localeCases.filter((item) => item.exactCitation),
            localeCases.filter((item) => !item.answerable),
          ),
        ]
      }),
  )
  return {
    quality,
    locales,
    latency: latencySummary(latencies),
  }
}

function summarizeQuality(answerable, citations, unanswerable) {
  return {
    recallAt1: mean(answerable.map((item) => item.recallAt1)),
    recallAt3: mean(answerable.map((item) => item.recallAt3)),
    recallAt5: mean(answerable.map((item) => item.recallAt5)),
    recallAt10: mean(answerable.map((item) => item.recallAt10)),
    meanReciprocalRankAt10: mean(answerable.map((item) => item.reciprocalRankAt10)),
    ndcgAt10: mean(answerable.map((item) => item.ndcgAt10)),
    exactCitationRate:
      citations.length === 0
        ? 1
        : citations.filter((item) => item.exactCitationHit === true).length / citations.length,
    falsePositiveRate:
      unanswerable.length === 0
        ? 0
        : unanswerable.filter((item) => item.falsePositive).length / unanswerable.length,
  }
}

function recallAtK(returned, judgments, topK) {
  const relevant = new Set(
    judgments.filter((judgment) => judgment.relevance > 0).map((judgment) => judgment.value),
  )
  if (relevant.size === 0) return 0
  return uniqueAtK(returned, topK).filter((value) => relevant.has(value)).length / relevant.size
}

function reciprocalRankAtK(returned, judgments, topK) {
  const relevant = new Set(
    judgments.filter((judgment) => judgment.relevance > 0).map((judgment) => judgment.value),
  )
  const rank = returned.slice(0, topK).findIndex((value) => relevant.has(value))
  return rank < 0 ? 0 : 1 / (rank + 1)
}

function gradedNdcgAtK(returned, judgments, topK) {
  const relevance = new Map(judgments.map((judgment) => [judgment.value, judgment.relevance]))
  const seen = new Set()
  const dcg = returned.slice(0, topK).reduce((score, value, index) => {
    if (seen.has(value)) return score
    seen.add(value)
    return score + (2 ** (relevance.get(value) ?? 0) - 1) / Math.log2(index + 2)
  }, 0)
  const idealGrades = [...relevance.values()]
    .filter((grade) => grade > 0)
    .sort((left, right) => right - left)
    .slice(0, topK)
  const ideal = idealGrades.reduce(
    (score, grade, index) => score + (2 ** grade - 1) / Math.log2(index + 2),
    0,
  )
  return ideal === 0 ? 0 : dcg / ideal
}

function uniqueAtK(values, topK) {
  return [...new Set(values.slice(0, topK))]
}

function latencySummary(values) {
  const sorted = [...values].sort((left, right) => left - right)
  return {
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
  }
}

function percentile(sorted, quantile) {
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)] ?? 0
}

function mean(values) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
}

function disposeTensors(value) {
  for (const tensor of Object.values(value)) tensor?.dispose?.()
}

async function directorySize(directory) {
  let total = 0
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    total += entry.isDirectory() ? await directorySize(target) : (await stat(target)).size
  }
  return total
}

function spawnResult(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: invocationRoot, env: process.env })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`Cold-start worker exited with code ${code}: ${stderr}`))
    })
  })
}

function positiveInteger(value, name) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be positive.`)
  return parsed
}

function positiveNumber(value, name) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be positive.`)
  return parsed
}

function parseArguments(args) {
  const parsed = {}
  const valueOptions = new Set([
    "--size",
    "--seed",
    "--candidate-limit",
    "--model",
    "--revision",
    "--dtype",
    "--model-path",
    "--p95-budget-ms",
    "--rss-budget-mib",
    "--cold-start-budget-ms",
    "--result",
  ])
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === "--") continue
    if (argument === "--cold-worker") {
      parsed.coldWorker = true
      continue
    }
    if (valueOptions.has(argument)) {
      const value = args[index + 1]
      if (!value) throw new Error(`${argument} requires a value.`)
      parsed[toCamelCase(argument.slice(2))] = value
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${argument}`)
  }
  return parsed
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())
}
