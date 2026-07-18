import childProcess from "node:child_process"
import { subscribe, unsubscribe } from "node:diagnostics_channel"
import { syncBuiltinESMExports } from "node:module"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { performance } from "node:perf_hooks"
import { environmentMetadata } from "./lib/metrics.mjs"

const SAMPLE_COUNT = 100
const WARMUP_COUNT = 10
const STATUS_P95_BUDGET_MS = 50
const CHUNK_COUNT_STRESS = 1_000_000
const benchmarkDir = path.dirname(fileURLToPath(import.meta.url))
const resultDir = path.join(benchmarkDir, ".results")
const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-status-benchmark-"))
const originalExecFile = childProcess.execFile
let childProcessCalls = 0

childProcess.execFile = (...args) => {
  childProcessCalls += 1
  const callback = args.findLast((value) => typeof value === "function")
  const error = new Error("Status benchmark blocked an unexpected child process.")
  if (callback) {
    queueMicrotask(() => callback(error, "", ""))
    return { kill() {} }
  }
  throw error
}
syncBuiltinESMExports()

try {
  const [{ initProject }, { ingest }, { getKnowledgeBaseContext }] = await Promise.all([
    import("../dist/init.js"),
    import("../dist/ingest.js"),
    import("../dist/context-resources.js"),
  ])
  await initProject(root)
  await writeFile(
    path.join(root, ".ragmir", "raw", "evidence.md"),
    "Verified lightweight status evidence.\n",
  )
  await ingest({ cwd: root })

  const indexEvents = []
  const onIndexEvent = (event) => indexEvents.push(event)
  subscribe("ragmir:index-read", onIndexEvent)
  let xs
  let stressed
  try {
    xs = await measureStatus(getKnowledgeBaseContext, root)
    await replaceChunkCount(root, CHUNK_COUNT_STRESS)
    stressed = await measureStatus(getKnowledgeBaseContext, root)
  } finally {
    unsubscribe("ragmir:index-read", onIndexEvent)
  }

  const tableOpenEvents = indexEvents.filter((event) => event?.kind === "table-open").length
  const chunkCountDeltaMs = Math.abs(stressed.p95Ms - xs.p95Ms)
  const gates = {
    xsP95: xs.p95Ms < STATUS_P95_BUDGET_MS,
    stressedP95: stressed.p95Ms < STATUS_P95_BUDGET_MS,
    chunkCountIndependent: chunkCountDeltaMs <= Math.max(5, xs.p95Ms),
    noChildProcess: childProcessCalls === 0,
    noTableOrChunkRead: tableOpenEvents === 0,
    ready: xs.last.ready && stressed.last.ready,
  }
  const result = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    environment: environmentMetadata(),
    configuration: {
      samples: SAMPLE_COUNT,
      warmups: WARMUP_COUNT,
      statusP95BudgetMs: STATUS_P95_BUDGET_MS,
      stressedChunkCount: CHUNK_COUNT_STRESS,
    },
    xs,
    stressed,
    chunkCountDeltaMs,
    childProcessCalls,
    tableOpenEvents,
    manifestReadEvents: indexEvents.filter((event) => event?.kind === "manifest-read").length,
    gates,
    passed: Object.values(gates).every(Boolean),
  }
  await mkdir(resultDir, { recursive: true })
  const resultPath = path.join(
    resultDir,
    `${new Date().toISOString().replaceAll(":", "-")}-status.json`,
  )
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify({ resultPath, ...result }, null, 2)}\n`)
  if (!result.passed) {
    process.exitCode = 1
  }
} finally {
  childProcess.execFile = originalExecFile
  syncBuiltinESMExports()
  await rm(root, { recursive: true, force: true })
}

async function measureStatus(getKnowledgeBaseContext, projectRoot) {
  for (let index = 0; index < WARMUP_COUNT; index += 1) {
    await getKnowledgeBaseContext(projectRoot)
  }
  const durations = []
  let last = null
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    const startedAt = performance.now()
    last = await getKnowledgeBaseContext(projectRoot)
    durations.push(performance.now() - startedAt)
  }
  durations.sort((left, right) => left - right)
  return {
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    p99Ms: percentile(durations, 0.99),
    last: {
      ready: last?.ready === true,
      indexedFiles: last?.coverage.indexedFiles ?? 0,
      chunksIndexed: last?.coverage.chunksIndexed ?? 0,
    },
  }
}

async function replaceChunkCount(projectRoot, chunkCount) {
  const manifestPath = path.join(projectRoot, ".ragmir", "storage", "index-manifest.json")
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
  manifest.chunkCount = chunkCount
  if (manifest.vectorIndex) {
    manifest.vectorIndex.indexedRows = chunkCount
    manifest.vectorIndex.unindexedRows = 0
    manifest.vectorIndex.coverage = 1
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

function percentile(sorted, quantile) {
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)] ?? 0
}
