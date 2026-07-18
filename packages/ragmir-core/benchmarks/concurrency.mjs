import { execFile } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { createRagmirClient, initProject } from "../dist/index.js"
import { DEFAULT_CONFIG } from "../dist/defaults.js"

const execFileAsync = promisify(execFile)
const here = path.dirname(fileURLToPath(import.meta.url))
const invocationRoot = process.env.INIT_CWD ?? process.cwd()
const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-concurrency-benchmark-"))
const requests = positiveInteger(process.env.RAGMIR_CONCURRENCY_REQUESTS ?? "100")
const corpusFiles = positiveInteger(process.env.RAGMIR_CONCURRENCY_CORPUS_FILES ?? "1500")
const provider = process.env.RAGMIR_BENCH_PROVIDER === "transformers" ? "transformers" : "local-hash"
const rssCeilingBytes =
  positiveInteger(process.env.RAGMIR_CONCURRENCY_RSS_CEILING_MIB ?? "768") * 1_024 * 1_024
const resultPath = path.resolve(
  process.env.RAGMIR_BENCH_RESULT ??
    path.join(here, ".results", `${new Date().toISOString().replaceAll(":", "-")}-concurrency.json`),
)
const queries = Array.from(
  { length: 20 },
  (_value, index) =>
    `admission evidence token-${index} ${Array.from(
      { length: 16 },
      () => "workload bounded local retrieval performance",
    ).join(" ")}`,
)

try {
  await initProject(root)
  const rawDir = path.join(root, ".ragmir", "raw")
  await mkdir(rawDir, { recursive: true })
  await Promise.all(
    Array.from({ length: corpusFiles }, (_value, index) =>
      writeFile(
        path.join(rawDir, `evidence-${index}.md`),
        `# Admission ${index}\n\nWorkload admission evidence token-${index % queries.length} remains local and bounded.\n`,
      ),
    ),
  )
  await writeBenchmarkConfig(root, provider, baselineLimits(requests))
  const ingestionClient = await createRagmirClient({ cwd: root })
  const ingestion = await ingestionClient.ingest({ rebuild: true })
  await ingestionClient.close()

  const baseline = await runVariant(root, queries, requests, provider, "baseline", baselineLimits(requests))
  const bounded = await runVariant(root, queries, requests, provider, "bounded", boundedLimits(requests))
  const gates = {
    completed: bounded.completed === requests && Object.keys(bounded.errors).length === 0,
    drained: Object.values(bounded.final).every((snapshot) => snapshot.active === 0 && snapshot.queued === 0),
    rssCeiling: bounded.peakRssBytes <= rssCeilingBytes,
    p95Stable: bounded.latencyMs.p95 <= baseline.latencyMs.p95 * 1.01,
    rssImproved: bounded.peakRssBytes <= baseline.peakRssBytes,
    throughputStable: bounded.throughputPerSecond >= baseline.throughputPerSecond * 0.95,
  }
  const report = {
    schemaVersion: 1,
    provider,
    requests,
    corpus: { files: corpusFiles, chunks: ingestion.chunks },
    limits: {
      baseline: baselineLimits(requests),
      bounded: boundedLimits(requests),
      rssCeilingBytes,
    },
    baseline,
    bounded,
    gates,
    passed: Object.values(gates).every(Boolean),
  }
  await mkdir(path.dirname(resultPath), { recursive: true })
  await writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify({ resultPath, ...report }, null, 2)}\n`)
  if (!report.passed) {
    process.exitCode = 1
  }
} finally {
  await rm(root, { recursive: true, force: true })
}

async function runVariant(root, queries, requests, provider, name, workloadLimits) {
  await writeBenchmarkConfig(root, provider, workloadLimits)
  const { stdout } = await execFileAsync(process.execPath, [path.join(here, "concurrency-worker.mjs")], {
    env: {
      ...process.env,
      RAGMIR_CONCURRENCY_ROOT: root,
      RAGMIR_CONCURRENCY_REQUESTS: String(requests),
      RAGMIR_CONCURRENCY_QUERIES: JSON.stringify(queries),
    },
    maxBuffer: 10 * 1_024 * 1_024,
  })
  return { name, ...JSON.parse(stdout) }
}

async function writeBenchmarkConfig(root, provider, workloadLimits) {
  await writeFile(
    path.join(root, ".ragmir", "config.json"),
    `${JSON.stringify(
      {
        ...DEFAULT_CONFIG,
        embeddingProvider: provider,
        embeddingModel: process.env.RAGMIR_BENCH_MODEL ?? DEFAULT_CONFIG.embeddingModel,
        embeddingModelRevision:
          process.env.RAGMIR_BENCH_MODEL_REVISION ?? DEFAULT_CONFIG.embeddingModelRevision,
        embeddingModelPath: path.resolve(
          process.env.RAGMIR_BENCH_MODEL_PATH ?? path.join(invocationRoot, ".ragmir", "models"),
        ),
        transformersAllowRemoteModels: false,
        accessLog: false,
        workloadLimits,
      },
      null,
      2,
    )}\n`,
  )
}

function baselineLimits(maxQueue) {
  return {
    search: { concurrency: 16, maxQueue, queueTimeoutMs: 120_000 },
    embedding: { concurrency: 16, maxQueue, queueTimeoutMs: 120_000 },
    ingestion: { concurrency: 1, maxQueue: 4, queueTimeoutMs: 120_000 },
  }
}

function boundedLimits(maxQueue) {
  return {
    search: { concurrency: 8, maxQueue, queueTimeoutMs: 120_000 },
    embedding: { concurrency: 1, maxQueue, queueTimeoutMs: 120_000 },
    ingestion: { concurrency: 1, maxQueue: 4, queueTimeoutMs: 120_000 },
  }
}

function positiveInteger(value) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received ${value}.`)
  }
  return parsed
}
