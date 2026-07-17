import { subscribe, unsubscribe } from "node:diagnostics_channel"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { fileURLToPath } from "node:url"
import {
  createRagmirClient,
  evaluateGoldenQueries,
  initProject,
  search,
} from "../dist/index.js"
import { createMcpClientLifecycle } from "../dist/mcp.js"
import { environmentMetadata } from "./lib/metrics.mjs"

const EVALUATION_CASES = 100
const EVALUATION_REPETITIONS = 3
const MINIMUM_WALL_IMPROVEMENT = 0.25
const SEARCH_ITERATIONS = positiveInteger(process.env.RAGMIR_RUNTIME_SEARCHES ?? "10000")
const FD_TOLERANCE = 5
const benchmarkDir = path.dirname(fileURLToPath(import.meta.url))
const resultDir = path.join(benchmarkDir, ".results")
const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-runtime-reuse-"))
const sourcePath = path.join(root, ".ragmir", "raw", "evidence.md")
const goldenPath = path.join(root, "golden.json")

try {
  await initProject(root)
  await writeFile(
    sourcePath,
    "Phoenix approval policy requires signed release evidence before production.\n",
    "utf8",
  )
  await disableAccessLog(root)
  const goldenQueries = Array.from({ length: EVALUATION_CASES }, (_value, index) => ({
    id: `runtime-${index}`,
    query: "phoenix approval signed release evidence",
    expectedPaths: [".ragmir/raw/evidence.md"],
  }))
  await writeFile(goldenPath, `${JSON.stringify(goldenQueries, null, 2)}\n`, "utf8")
  const ingestionClient = await createRagmirClient({ cwd: root })
  const ingestion = await ingestionClient.ingest({ rebuild: true })
  await ingestionClient.close()

  await runLegacyEvaluation(root, goldenQueries.slice(0, 5))
  await evaluateGoldenQueries({
    cwd: root,
    goldenPath,
    persistCompatibleReport: false,
  })

  const legacyRuns = []
  const optimizedRuns = []
  for (let repetition = 0; repetition < EVALUATION_REPETITIONS; repetition += 1) {
    legacyRuns.push(await measuredLegacyEvaluation(root, goldenQueries))
    optimizedRuns.push(await measuredOptimizedEvaluation(root, goldenPath))
  }
  const legacyMedianMs = median(legacyRuns.map((run) => run.wallMs))
  const optimizedMedianMs = median(optimizedRuns.map((run) => run.wallMs))
  const wallImprovement = 1 - optimizedMedianMs / legacyMedianMs
  const equivalentResults = optimizedRuns.every(
    (optimized, index) =>
      JSON.stringify(optimized.results) === JSON.stringify(legacyRuns[index]?.results),
  )

  const persistentClient = await createRagmirClient({ cwd: root })
  await persistentClient.search("phoenix approval")
  const fdBaseline = await fileDescriptorCount()
  const hotPathEvents = []
  const onHotPathEvent = (event) => hotPathEvents.push(event)
  subscribe("ragmir:index-read", onHotPathEvent)
  const hotPathStartedAt = performance.now()
  try {
    for (let index = 0; index < SEARCH_ITERATIONS; index += 1) {
      await persistentClient.search("phoenix approval")
    }
  } finally {
    unsubscribe("ragmir:index-read", onHotPathEvent)
  }
  const hotPathWallMs = performance.now() - hotPathStartedAt
  const fdAfterSearches = await fileDescriptorCount()
  const fdDelta = fdAfterSearches - fdBaseline

  await writeFile(
    sourcePath,
    "Phoenix approval policy now requires signed comet evidence before production.\n",
    "utf8",
  )
  const writer = await createRagmirClient({ cwd: root })
  await writer.ingest({ rebuild: true })
  await writer.close()
  const generationEvents = []
  const onGenerationEvent = (event) => generationEvents.push(event)
  subscribe("ragmir:index-read", onGenerationEvent)
  let refreshedResults
  try {
    refreshedResults = await persistentClient.search("signed comet evidence")
  } finally {
    unsubscribe("ragmir:index-read", onGenerationEvent)
  }
  const generationInvalidatedAtomically =
    refreshedResults[0]?.text.includes("comet") === true &&
    generationEvents.filter((event) => event?.kind === "table-close").length === 1 &&
    generationEvents.filter((event) => event?.kind === "table-open").length === 1
  await persistentClient.close()

  const configInvalidation = await measureConfigInvalidation(root)
  const optimizedConnectionCounts = optimizedRuns.map(
    (run) => run.events.filter((event) => event?.kind === "connection-open").length,
  )
  const optimizedTableCounts = optimizedRuns.map(
    (run) => run.events.filter((event) => event?.kind === "table-open").length,
  )
  const gates = {
    hundredCases: optimizedRuns.every((run) => run.results.length === EVALUATION_CASES),
    oneConnection: optimizedConnectionCounts.every((count) => count === 1),
    oneTableGeneration: optimizedTableCounts.every((count) => count === 1),
    equivalentResults,
    wallImprovement: wallImprovement >= MINIMUM_WALL_IMPROVEMENT,
    fileDescriptorsStable: fdDelta <= FD_TOLERANCE,
    cachedTableStable:
      hotPathEvents.filter((event) => event?.kind === "table-open").length === 0,
    generationInvalidatedAtomically,
    configInvalidatedAtomically: configInvalidation.atomic,
  }
  const result = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    environment: environmentMetadata(),
    configuration: {
      evaluationCases: EVALUATION_CASES,
      evaluationRepetitions: EVALUATION_REPETITIONS,
      minimumWallImprovement: MINIMUM_WALL_IMPROVEMENT,
      searchIterations: SEARCH_ITERATIONS,
      fdTolerance: FD_TOLERANCE,
    },
    corpus: { files: ingestion.indexedFiles, chunks: ingestion.chunks },
    evaluation: {
      legacyRuns: legacyRuns.map(summarizeEvaluationRun),
      optimizedRuns: optimizedRuns.map(summarizeEvaluationRun),
      legacyMedianMs,
      optimizedMedianMs,
      wallImprovement,
      equivalentResults,
      optimizedConnectionCounts,
      optimizedTableCounts,
    },
    searches: {
      iterations: SEARCH_ITERATIONS,
      wallMs: hotPathWallMs,
      throughputPerSecond: (SEARCH_ITERATIONS * 1_000) / hotPathWallMs,
      fdBaseline,
      fdAfter: fdAfterSearches,
      fdDelta,
      tableOpenEvents: hotPathEvents.filter((event) => event?.kind === "table-open").length,
    },
    invalidation: {
      generation: {
        atomic: generationInvalidatedAtomically,
        events: generationEvents.map((event) => event?.kind),
      },
      config: configInvalidation,
    },
    gates,
    passed: Object.values(gates).every(Boolean),
  }
  await mkdir(resultDir, { recursive: true })
  const resultPath = path.join(
    resultDir,
    `${new Date().toISOString().replaceAll(":", "-")}-runtime-reuse.json`,
  )
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8")
  process.stdout.write(`${JSON.stringify({ resultPath, ...result }, null, 2)}\n`)
  if (!result.passed) {
    process.exitCode = 1
  }
} finally {
  await rm(root, { recursive: true, force: true })
}

async function measuredLegacyEvaluation(projectRoot, goldenQueries) {
  const events = []
  const onEvent = (event) => events.push(event)
  subscribe("ragmir:index-read", onEvent)
  const startedAt = performance.now()
  let results
  try {
    results = await runLegacyEvaluation(projectRoot, goldenQueries)
  } finally {
    unsubscribe("ragmir:index-read", onEvent)
  }
  return { wallMs: performance.now() - startedAt, results, events }
}

async function runLegacyEvaluation(projectRoot, goldenQueries) {
  const cases = []
  for (const goldenQuery of goldenQueries) {
    const rows = await search(goldenQuery.query, { cwd: projectRoot, topK: 10 })
    cases.push(compactRows(rows))
  }
  return cases
}

async function measuredOptimizedEvaluation(projectRoot, projectGoldenPath) {
  const events = []
  const onEvent = (event) => events.push(event)
  subscribe("ragmir:index-read", onEvent)
  const startedAt = performance.now()
  let report
  try {
    report = await evaluateGoldenQueries({
      cwd: projectRoot,
      goldenPath: projectGoldenPath,
      persistCompatibleReport: false,
    })
  } finally {
    unsubscribe("ragmir:index-read", onEvent)
  }
  return {
    wallMs: performance.now() - startedAt,
    results: report.cases.map((testCase) =>
      testCase.returnedPaths.map((relativePath, index) => ({
        relativePath,
        citation: testCase.returnedCitations[index],
      })),
    ),
    events,
  }
}

function compactRows(rows) {
  return rows.map((row) => ({ relativePath: row.relativePath, citation: row.citation }))
}

function summarizeEvaluationRun(run) {
  return {
    wallMs: run.wallMs,
    connections: run.events.filter((event) => event?.kind === "connection-open").length,
    tables: run.events.filter((event) => event?.kind === "table-open").length,
    tableCloses: run.events.filter((event) => event?.kind === "table-close").length,
  }
}

async function measureConfigInvalidation(projectRoot) {
  const lifecycle = createMcpClientLifecycle(projectRoot)
  const first = await lifecycle.getClient()
  await first.search("signed comet evidence")
  const configPath = path.join(projectRoot, ".ragmir", "config.json")
  const config = JSON.parse(await readFile(configPath, "utf8"))
  await writeFile(configPath, `${JSON.stringify({ ...config, topK: config.topK + 1 }, null, 2)}\n`)
  const events = []
  const onEvent = (event) => events.push(event)
  subscribe("ragmir:index-read", onEvent)
  let refreshed
  try {
    refreshed = await lifecycle.getClient()
    await refreshed.search("signed comet evidence")
  } finally {
    unsubscribe("ragmir:index-read", onEvent)
    await lifecycle.close()
  }
  const kinds = events.map((event) => event?.kind)
  const tableClose = kinds.indexOf("table-close")
  const connectionOpen = kinds.indexOf("connection-open")
  return {
    atomic:
      refreshed !== first &&
      first.isClosed &&
      tableClose >= 0 &&
      connectionOpen > tableClose,
    events: kinds,
  }
}

async function disableAccessLog(projectRoot) {
  const configPath = path.join(projectRoot, ".ragmir", "config.json")
  const config = JSON.parse(await readFile(configPath, "utf8"))
  await writeFile(configPath, `${JSON.stringify({ ...config, accessLog: false }, null, 2)}\n`)
}

async function fileDescriptorCount() {
  const directory = existsSync("/proc/self/fd") ? "/proc/self/fd" : "/dev/fd"
  return (await readdir(directory)).length
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

function positiveInteger(value) {
  const parsed = Number.parseInt(String(value), 10)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received ${value}.`)
  }
  return parsed
}
