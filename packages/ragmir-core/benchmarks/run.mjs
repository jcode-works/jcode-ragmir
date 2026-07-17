import { fork, execFile } from "node:child_process"
import { subscribe, unsubscribe } from "node:diagnostics_channel"
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import {
  createMcpServer,
  createRagmirClient,
  evaluateGoldenQueries,
  search,
} from "../dist/index.js"
import { CORPUS_PRESETS, generateCorpus } from "./lib/corpus.mjs"
import {
  directorySize,
  environmentMetadata,
  measureOperation,
  measureSeries,
  settleMeasurement,
} from "./lib/metrics.mjs"

const execFileAsync = promisify(execFile)
const here = path.dirname(fileURLToPath(import.meta.url))
const options = parseArguments(process.argv.slice(2))
const profile = normalizeProfile(options.profile ?? "smoke")
const size = normalizeSize(options.size ?? process.env.RAGMIR_BENCH_SIZE ?? profile.defaultSize)
const provider = normalizeProvider(
  options.provider ?? process.env.RAGMIR_BENCH_PROVIDER ?? "local-hash",
)
const targetChunks = CORPUS_PRESETS[size]
const seed = String(options.seed ?? process.env.RAGMIR_BENCH_SEED ?? "ragmir-benchmark-v1")
const model = String(
  options.model ?? process.env.RAGMIR_BENCH_MODEL ?? "intfloat/multilingual-e5-small",
)
const modelRevision = String(
  options.modelRevision ?? process.env.RAGMIR_BENCH_MODEL_REVISION ?? "main",
)
const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-benchmark-"))
const invocationRoot = process.env.INIT_CWD ?? process.cwd()
const modelPath = path.resolve(
  options.modelPath ??
    process.env.RAGMIR_BENCH_MODEL_PATH ??
    path.join(invocationRoot, ".ragmir", "models"),
)
const resultPath = options.result
  ? path.resolve(invocationRoot, options.result)
  : path.resolve(
    path.join(
      here,
      ".results",
      `${new Date().toISOString().replaceAll(":", "-")}-${profile.name}-${size}-${provider}.json`,
    ),
  )

let client
let mcpClient
let mcpServer
try {
  const corpus = await generateCorpus({
    root,
    targetChunks,
    seed,
    provider,
    model,
    modelRevision,
    modelPath,
    goldenCount: profile.goldenCount,
  })
  const environment = environmentMetadata()
  client = await createRagmirClient({ cwd: root })

  const rebuild = await measured("ingest-rebuild", () => client.ingest({ rebuild: true }))
  const noOp = await measured("ingest-no-op", () => client.ingest())
  const sourceBytes = await directorySize(corpus.rawDir)
  const physicalBytesAfterRebuild = await directorySize(path.join(root, ".ragmir", "storage"))
  const queries = corpus.goldenQueries.map((entry) => entry.query)
  const coldPersistent = await measured("search-persistent-cold", () =>
    client.search(queries[0], { topK: 5 }),
  )

  const persistentRun = await withIndexReadDiagnostics(root, () =>
    measureSeries({
      warmups: profile.warmups,
      samples: profile.samples,
      repetitions: profile.repetitions,
      operation: (index) => client.search(queries[index % queries.length], { topK: 5 }),
    }),
  )
  const persistent = persistentRun.value
  const oneShotRun = await withIndexReadDiagnostics(root, () =>
    measureSeries({
      warmups: profile.oneShotWarmups,
      samples: profile.oneShotSamples,
      repetitions: profile.oneShotRepetitions,
      operation: (index) => search(queries[index % queries.length], { cwd: root, topK: 5 }),
    }),
  )
  const oneShot = oneShotRun.value
  const filtered = await measureSeries({
    warmups: profile.warmups,
    samples: profile.samples,
    repetitions: profile.repetitions,
    operation: (index) =>
      client.search(queries[index % queries.length], {
        topK: 5,
        includePaths: [".ragmir/raw/documents/**"],
      }),
  })
  const contextual = await measureSeries({
    warmups: profile.warmups,
    samples: profile.samples,
    repetitions: profile.repetitions,
    operation: (index) =>
      client.search(queries[index % queries.length], { topK: 5, contextRadius: 2 }),
  })
  const concurrent = {}
  for (const concurrency of [1, 4, 16]) {
    concurrent[String(concurrency)] = await measureConcurrency({
      client,
      queries,
      concurrency,
      total: Math.max(profile.samples, concurrency),
    })
  }

  const cli = await measureSeries({
    warmups: profile.cliWarmups,
    samples: profile.cliSamples,
    repetitions: 1,
    operation: (index) => runCliSearch(root, queries[index % queries.length]),
  })

  ;({ client: mcpClient, server: mcpServer } = await connectMcp(root))
  const mcp = await measureSeries({
    warmups: profile.warmups,
    samples: profile.samples,
    repetitions: profile.repetitions,
    operation: async (index) => {
      const response = await mcpClient.callTool({
        name: "ragmir_search",
        arguments: { query: queries[index % queries.length], topK: 5 },
      })
      if (response.isError === true) {
        throw new Error("MCP benchmark search failed.")
      }
    },
  })

  const quality = await measured("evaluate", () =>
    evaluateGoldenQueries({ cwd: root, goldenPath: corpus.goldenPath, topK: 5 }),
  )
  const research = await measured("research", () =>
    client.research(queries[0], { topK: 5, includeCode: false }),
  )
  const mutationScenarios = await runMutationScenarios({ client, corpus, root, queries })
  await client.close()
  client = undefined
  const interruption = await runInterruptionScenario({ corpus, root })
  const physicalBytes = await directorySize(path.join(root, ".ragmir", "storage"))
  const resourceUsage = process.resourceUsage()
  const result = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    profile: profile.name,
    size,
    claimEligible:
      profile.warmups >= 10 && profile.samples >= 100 && profile.repetitions >= 5,
    environment,
    configuration: {
      embeddingProvider: provider,
      embeddingModel: model,
      embeddingModelRevision: modelRevision,
      embeddingModelPath: modelPath,
      chunkSize: corpus.config.chunkSize,
      chunkOverlap: corpus.config.chunkOverlap,
      ingestConcurrency: corpus.config.ingestConcurrency,
      embeddingBatchSize: corpus.config.embeddingBatchSize,
    },
    corpus: {
      corpusHash: corpus.corpusHash,
      seed,
      targetChunks,
      actualChunks: rebuild.value.chunks,
      files: corpus.files.length,
      sourceBytes,
      formats: Object.fromEntries(
        [...corpus.pathsByFormat.entries()].map(([format, paths]) => [format, paths.length]),
      ),
    },
    ingest: {
      rebuild: summarizeIngest(rebuild),
      noOp: summarizeIngest(noOp),
      scenarios: mutationScenarios,
      interruption,
    },
    quality: summarizeQuality(quality.value),
    search: {
      coldPersistent: {
        measurement: coldPersistent.measurement,
        resultCount: coldPersistent.value.length,
      },
      persistent,
      oneShot,
      indexReadDiagnostics: {
        persistent: persistentRun.diagnostics,
        oneShot: oneShotRun.diagnostics,
      },
      filtered,
      contextual,
      cli,
      mcp,
      concurrent,
    },
    research: {
      measurement: research.measurement,
      evidenceCount: research.value.evidence.length,
      ready: research.value.ready,
    },
    storage: {
      physicalBytesAfterRebuild,
      physicalBytes,
      bytesPerChunk: rebuild.value.chunks === 0 ? 0 : physicalBytes / rebuild.value.chunks,
    },
    resources: {
      maxRssKiB: resourceUsage.maxRSS,
      userCpuMs: resourceUsage.userCPUTime / 1_000,
      systemCpuMs: resourceUsage.systemCPUTime / 1_000,
    },
  }
  await mkdir(path.dirname(resultPath), { recursive: true })
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8")
  process.stdout.write(`${JSON.stringify({ resultPath, ...result }, null, 2)}\n`)
  if (result.claimEligible && !result.quality.passed) {
    process.exitCode = 1
  }
} finally {
  await Promise.allSettled([client?.close(), mcpClient?.close(), mcpServer?.close()])
  if (options.keep === true) {
    process.stderr.write(`Benchmark project preserved at ${root}\n`)
  } else {
    await rm(root, { recursive: true, force: true })
  }
}

async function withIndexReadDiagnostics(projectRoot, operation) {
  const diagnostics = { manifestReads: 0, tableOpens: 0 }
  const onDiagnostic = (event) => {
    if (!event || typeof event !== "object" || event.projectRoot !== projectRoot) {
      return
    }
    if (event.kind === "manifest-read") {
      diagnostics.manifestReads += 1
    } else if (event.kind === "table-open") {
      diagnostics.tableOpens += 1
    }
  }
  subscribe("ragmir:index-read", onDiagnostic)
  try {
    return { value: await operation(), diagnostics }
  } finally {
    unsubscribe("ragmir:index-read", onDiagnostic)
  }
}

async function runCliSearch(root, query) {
  try {
    await execFileAsync(
      process.execPath,
      [path.resolve(here, "..", "dist", "cli.js"), "search", query, "--top-k", "5", "--json"],
      { cwd: root, maxBuffer: 4 * 1_024 * 1_024 },
    )
  } catch (error) {
    if (!isExpectedEmptyCliSearch(error)) {
      throw error
    }
  }
}

function isExpectedEmptyCliSearch(error) {
  if (!error || typeof error !== "object" || error.code !== 1 || typeof error.stdout !== "string") {
    return false
  }
  try {
    const output = JSON.parse(error.stdout)
    return output && typeof output === "object" && Array.isArray(output.results) && output.results.length === 0
  } catch {
    return false
  }
}

async function runMutationScenarios({ client, corpus, root, queries }) {
  const appendSafeFiles = corpus.textFiles.filter(
    (file) => file.format === "md" || file.format === "txt",
  )
  const mutable = appendSafeFiles.slice(
    -Math.max(4, Math.ceil(appendSafeFiles.length * 0.1)),
  )
  const onePercentDelta = await runDeltaScenario({
    client,
    files: mutable,
    percentage: 0.01,
    name: "ingest-delta-one-percent",
  })
  const tenPercentDelta = await runDeltaScenario({
    client,
    files: appendSafeFiles,
    percentage: 0.1,
    name: "ingest-delta-ten-percent",
  })

  const deleted = mutable.at(-1)
  let deletion = null
  if (deleted) {
    await unlink(deleted.absolutePath)
    deletion = await measured("ingest-deletion", () => client.ingest())
    await writeFile(deleted.absolutePath, deleted.original, "utf8")
    await client.ingest()
  }

  const shortened = mutable.at(-2)
  let shortening = null
  if (shortened) {
    await writeFile(
      shortened.absolutePath,
      `Short retained evidence ${shortened.relativePath}.\n`,
      "utf8",
    )
    shortening = await measured("ingest-shortened", () => client.ingest())
    await writeFile(shortened.absolutePath, shortened.original, "utf8")
    await client.ingest()
  }

  const jsonPath = corpus.pathsByFormat.get("json")?.at(-1)
  let parseFailure = null
  if (jsonPath) {
    const absolutePath = path.join(root, jsonPath)
    const original = await readFile(absolutePath)
    const jsonFile = corpus.files.find((file) => file.relativePath === jsonPath)
    const query = `Find the exact evidence identifier ${jsonFile?.evidenceKey ?? jsonPath}`
    await writeFile(absolutePath, "{ invalid benchmark json", "utf8")
    const failed = await measured("ingest-parse-failure", () => client.ingest())
    const retrieval = await client.search(query, { topK: 5 })
    const lastKnownGoodFound = retrieval.some((result) => result.relativePath === jsonPath)
    await writeFile(absolutePath, original)
    const repair = await measured("ingest-parse-repair", () => client.ingest())
    const repairedResults = await client.search(query, { topK: 5 })
    const incrementalRepairFound = repairedResults.some(
      (result) => result.relativePath === jsonPath,
    )
    let rebuildRecovery = null
    if (!incrementalRepairFound) {
      const recovery = await measured("ingest-parse-recovery-rebuild", () =>
        client.ingest({ rebuild: true }),
      )
      const recoveredResults = await client.search(query, { topK: 5 })
      rebuildRecovery = {
        ...summarizeIngest(recovery),
        expectedPathFound: recoveredResults.some((result) => result.relativePath === jsonPath),
      }
    }
    parseFailure = {
      ...summarizeIngest(failed),
      lastKnownGoodFound,
      incrementalRepair: {
        ...summarizeIngest(repair),
        expectedPathFound: incrementalRepairFound,
      },
      rebuildRecovery,
    }
  }

  const embeddingFailure = await runEmbeddingFailureScenario({ root, query: queries[0] })
  return {
    onePercentDelta,
    tenPercentDelta,
    deletion: deletion === null ? null : summarizeIngest(deletion),
    shortened: shortening === null ? null : summarizeIngest(shortening),
    parseFailure,
    embeddingFailure,
  }
}

async function runDeltaScenario({ client, files, percentage, name }) {
  const count = Math.max(1, Math.ceil(files.length * percentage))
  const targets = files.slice(-count)
  for (const [index, file] of targets.entries()) {
    await writeFile(file.absolutePath, `${file.original}\nDelta evidence ${index}.\n`, "utf8")
  }
  const result = await measured(name, () => client.ingest())
  for (const file of targets) {
    await writeFile(file.absolutePath, file.original, "utf8")
  }
  await client.ingest()
  return summarizeIngest(result)
}

async function runEmbeddingFailureScenario({ root, query }) {
  const configPath = path.join(root, ".ragmir", "config.json")
  const original = await readFile(configPath, "utf8")
  const config = JSON.parse(original)
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        ...config,
        embeddingProvider: "transformers",
        embeddingModel: path.join(root, "missing-benchmark-model"),
        transformersAllowRemoteModels: false,
      },
      null,
      2,
    )}\n`,
    "utf8",
  )
  let failedAsExpected = false
  let errorCode = null
  let measurement = null
  const failingClient = await createRagmirClient({ cwd: root })
  try {
    await measureOperation("ingest-embedding-failure", () =>
      failingClient.ingest({ rebuild: true }),
    )
  } catch (error) {
    failedAsExpected = true
    errorCode = typeof error?.code === "string" ? error.code : error?.name ?? "Error"
    measurement =
      error?.benchmarkMeasurement === undefined
        ? null
        : await settleMeasurement(error.benchmarkMeasurement)
  } finally {
    await failingClient.close()
    await writeFile(configPath, original, "utf8")
  }
  const healthyClient = await createRagmirClient({ cwd: root })
  try {
    const results = await healthyClient.search(query, { topK: 5 })
    return { failedAsExpected, errorCode, measurement, healthyResults: results.length }
  } finally {
    await healthyClient.close()
  }
}

async function runInterruptionScenario({ corpus, root }) {
  const target = corpus.textFiles.filter((file) => file.format === "md").at(-1)
  if (!target) {
    return { attempted: false }
  }
  await writeFile(target.absolutePath, `${target.original}\nInterrupted ingest delta.\n`, "utf8")
  const targetFile = corpus.files.find((file) => file.relativePath === target.relativePath)
  const query = `Find the exact evidence identifier ${
    targetFile?.evidenceKey ?? target.relativePath
  }`
  const workerPath = path.join(here, "ingest-worker.mjs")
  const child = fork(workerPath, [root], { stdio: ["ignore", "ignore", "ignore", "ipc"] })
  const outcome = await new Promise((resolve) => {
    let interrupted = false
    const timeout = setTimeout(() => {
      interrupted = child.kill("SIGKILL")
    }, 5_000)
    child.on("message", (message) => {
      if (message?.type === "started") {
        setTimeout(() => {
          interrupted = child.kill("SIGKILL")
        }, 20)
      }
    })
    child.on("exit", (code, signal) => {
      clearTimeout(timeout)
      resolve({ interrupted, code, signal })
    })
  })
  const resumeClient = await createRagmirClient({ cwd: root })
  try {
    const resumed = await measured("ingest-resume-after-interruption", () => resumeClient.ingest())
    const results = await resumeClient.search(query, { topK: 5 })
    return {
      attempted: true,
      ...outcome,
      resumed: resumed.value.resumed,
      indexedFiles: resumed.value.indexedFiles,
      chunks: resumed.value.chunks,
      searchResults: results.length,
      expectedPathFound: results.some((result) => result.relativePath === target.relativePath),
      measurement: resumed.measurement,
    }
  } finally {
    await resumeClient.close()
  }
}

async function measureConcurrency({ client, queries, concurrency, total }) {
  const durations = []
  const startedAt = performance.now()
  for (let offset = 0; offset < total; offset += concurrency) {
    const batch = Array.from({ length: Math.min(concurrency, total - offset) }, (_value, index) => {
      const query = queries[(offset + index) % queries.length]
      const sampleStartedAt = performance.now()
      return client.search(query, { topK: 5 }).then(() => {
        durations.push(performance.now() - sampleStartedAt)
      })
    })
    await Promise.all(batch)
  }
  const wallMs = performance.now() - startedAt
  durations.sort((left, right) => left - right)
  return {
    concurrency,
    total,
    wallMs,
    throughputPerSecond: wallMs === 0 ? 0 : (total * 1_000) / wallMs,
    p50Ms: percentileFromSorted(durations, 0.5),
    p95Ms: percentileFromSorted(durations, 0.95),
    p99Ms: percentileFromSorted(durations, 0.99),
  }
}

async function connectMcp(root) {
  const client = new Client({ name: "ragmir-benchmark", version: "1.0.0" })
  const server = createMcpServer(root)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
  return { client, server }
}

async function measured(name, operation) {
  const result = await measureOperation(name, operation)
  return { ...result, measurement: await settleMeasurement(result.measurement) }
}

function summarizeIngest(result) {
  return {
    measurement: result.measurement,
    resumed: result.value.resumed,
    indexedFiles: result.value.indexedFiles,
    rebuiltFiles: result.value.rebuiltFiles,
    reusedFiles: result.value.reusedFiles,
    chunks: result.value.chunks,
    errors: result.value.errors.length,
  }
}

function summarizeQuality(result) {
  return {
    total: result.total,
    hits: result.hits,
    misses: result.misses,
    hitRate: result.hitRate,
    recall: result.recall,
    precision: result.precision,
    meanReciprocalRank: result.meanReciprocalRank,
    ndcg: result.ndcg,
    recallAt: result.recallAt,
    precisionAt5: result.precisionAt5,
    meanReciprocalRankAt10: result.meanReciprocalRankAt10,
    ndcgAt10: result.ndcgAt10,
    exactCitationRate: result.exactCitationRate,
    falsePositiveRate: result.falsePositiveRate,
    abstentionAccuracy: result.abstentionAccuracy,
    thresholds: result.thresholds,
    gates: result.gates,
    passed: result.passed,
    verificationEligible: result.verificationEligible,
    reportStored: result.reportStored,
    groups: result.groups,
    p50LatencyMs: result.p50LatencyMs,
    p95LatencyMs: result.p95LatencyMs,
  }
}

function normalizeProfile(value) {
  const profiles = {
    smoke: {
      name: "smoke",
      defaultSize: "XS",
      goldenCount: 20,
      warmups: 2,
      samples: 20,
      repetitions: 1,
      oneShotWarmups: 1,
      oneShotSamples: 5,
      oneShotRepetitions: 1,
      cliWarmups: 0,
      cliSamples: 3,
    },
    quality: {
      name: "quality",
      defaultSize: "S",
      goldenCount: 100,
      warmups: 10,
      samples: 100,
      repetitions: 5,
      oneShotWarmups: 10,
      oneShotSamples: 100,
      oneShotRepetitions: 5,
      cliWarmups: 2,
      cliSamples: 20,
    },
    scale: {
      name: "scale",
      defaultSize: "S",
      goldenCount: 100,
      warmups: 10,
      samples: 100,
      repetitions: 5,
      oneShotWarmups: 10,
      oneShotSamples: 100,
      oneShotRepetitions: 5,
      cliWarmups: 2,
      cliSamples: 20,
    },
  }
  const profile = profiles[value]
  if (!profile) {
    throw new Error(`Unknown benchmark profile: ${value}`)
  }
  return profile
}

function normalizeSize(value) {
  const normalized = String(value).toUpperCase()
  if (!(normalized in CORPUS_PRESETS)) {
    throw new Error(`Unknown corpus size: ${value}`)
  }
  return normalized
}

function normalizeProvider(value) {
  if (value !== "local-hash" && value !== "transformers") {
    throw new Error(`Unknown embedding provider: ${value}`)
  }
  return value
}

function percentileFromSorted(values, quantile) {
  if (values.length === 0) {
    return 0
  }
  return values[Math.max(0, Math.ceil(values.length * quantile) - 1)] ?? 0
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
