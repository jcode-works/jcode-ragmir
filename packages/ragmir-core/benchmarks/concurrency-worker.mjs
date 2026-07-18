import { performance } from "node:perf_hooks"
import { createRagmirClient } from "../dist/index.js"
import { loadConfig } from "../dist/config.js"
import { workloadSnapshot } from "../dist/workload.js"

const root = requiredEnvironment("RAGMIR_CONCURRENCY_ROOT")
const requests = positiveInteger(process.env.RAGMIR_CONCURRENCY_REQUESTS ?? "100")
const queries = JSON.parse(requiredEnvironment("RAGMIR_CONCURRENCY_QUERIES"))
if (!Array.isArray(queries) || queries.some((query) => typeof query !== "string")) {
  throw new Error("RAGMIR_CONCURRENCY_QUERIES must be a JSON string array.")
}

const rssSamples = [process.memoryUsage().rss]
const sampler = setInterval(() => rssSamples.push(process.memoryUsage().rss), 5)
sampler.unref?.()
let client

try {
  client = await createRagmirClient({ cwd: root })
  for (let index = 0; index < 5; index += 1) {
    await client.search(queries[index % queries.length], { topK: 5 })
  }

  const durations = []
  const queueTimes = []
  const startedAt = performance.now()
  const settled = await Promise.allSettled(
    Array.from({ length: requests }, async (_value, index) => {
      const sampleStartedAt = performance.now()
      const results = await client.search(queries[index % queries.length], {
        topK: 5,
        explain: true,
        timeoutMs: 120_000,
      })
      durations.push(performance.now() - sampleStartedAt)
      queueTimes.push(results[0]?.score?.workloadQueueMs ?? 0)
    }),
  )
  const wallMs = performance.now() - startedAt
  await client.close()
  client = undefined
  rssSamples.push(process.memoryUsage().rss)
  const config = await loadConfig(root)
  const errors = settled
    .filter((result) => result.status === "rejected")
    .map((result) => errorCode(result.reason))
  durations.sort((left, right) => left - right)
  queueTimes.sort((left, right) => left - right)
  process.stdout.write(
    `${JSON.stringify({
      requests,
      completed: durations.length,
      errors: Object.fromEntries(
        [...new Set(errors)].sort().map((code) => [code, errors.filter((item) => item === code).length]),
      ),
      wallMs,
      throughputPerSecond: wallMs === 0 ? 0 : (durations.length * 1_000) / wallMs,
      latencyMs: summarize(durations),
      queueMs: summarize(queueTimes),
      peakRssBytes: Math.max(...rssSamples),
      final: {
        search: workloadSnapshot(config, "search"),
        embedding: workloadSnapshot(config, "embedding"),
        ingestion: workloadSnapshot(config, "ingestion"),
      },
    })}\n`,
  )
} finally {
  clearInterval(sampler)
  await client?.close()
}

function summarize(sorted) {
  return {
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted.at(-1) ?? 0,
  }
}

function percentile(sorted, ratio) {
  if (sorted.length === 0) {
    return 0
  }
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ?? 0
}

function requiredEnvironment(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is required.`)
  }
  return value
}

function positiveInteger(value) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received ${value}.`)
  }
  return parsed
}

function errorCode(error) {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : "UNKNOWN"
}
