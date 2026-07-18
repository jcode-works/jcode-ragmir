import { spawnSync } from "node:child_process"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { fileURLToPath } from "node:url"

const benchmarkRoot = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(benchmarkRoot, "..")
const workerPath = path.join(benchmarkRoot, "cli-startup-worker.mjs")
const entryCliPath = path.join(packageRoot, "dist", "cli-entry.js")
const warmups = positiveInteger(process.env.RAGMIR_CLI_STARTUP_WARMUPS ?? "2")
const samples = positiveInteger(process.env.RAGMIR_CLI_STARTUP_SAMPLES ?? "10")
const latencyGateMs = positiveNumber(process.env.RAGMIR_CLI_STARTUP_P95_MS ?? "100")
const rssGateBytes =
  positiveNumber(process.env.RAGMIR_CLI_STARTUP_RSS_MIB ?? "70") * 1024 * 1024

const scenarios = {
  version: measureCli(["--version"]),
  routePrompt: measureCli([
    "route-prompt",
    "--json",
    "find indexed architecture evidence",
  ]),
}

const gates = Object.fromEntries(
  Object.entries(scenarios).map(([name, measurement]) => [
    name,
    {
      latency: measurement.p95Ms <= latencyGateMs,
      rss: measurement.maxRssBytes <= rssGateBytes,
    },
  ]),
)
const passed = Object.values(gates).every((gate) => gate.latency && gate.rss)

console.log(
  JSON.stringify(
    {
      environment: {
        node: process.version,
        platform: process.platform,
        architecture: process.arch,
      },
      samples,
      warmups,
      thresholds: { latencyGateMs, rssGateBytes },
      scenarios,
      gates,
      passed,
    },
    null,
    2,
  ),
)

if (!passed) {
  process.exitCode = 1
}

function measureCli(arguments_) {
  const measurements = []
  for (let index = 0; index < warmups + samples; index += 1) {
    const startedAt = performance.now()
    const result = spawnSync(process.execPath, [workerPath, entryCliPath, ...arguments_], {
      cwd: packageRoot,
      encoding: "utf8",
      env: process.env,
    })
    const elapsedMs = performance.now() - startedAt
    if (result.status !== 0) {
      throw new Error(
        `CLI startup scenario failed for ${path.basename(entryCliPath)}: ${result.stderr || result.stdout}`,
      )
    }
    const marker = result.stdout
      .split("\n")
      .findLast((line) => line.startsWith("RAGMIR_CLI_STARTUP="))
    if (!marker) {
      throw new Error(`CLI startup scenario did not report resource usage for ${entryCliPath}.`)
    }
    if (index >= warmups) {
      const resourceUsage = JSON.parse(marker.slice("RAGMIR_CLI_STARTUP=".length))
      measurements.push({ elapsedMs, maxRssBytes: resourceUsage.maxRssKiB * 1024 })
    }
  }

  const latencies = measurements.map((measurement) => measurement.elapsedMs).sort((a, b) => a - b)
  return {
    medianMs: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    maxRssBytes: Math.max(...measurements.map((measurement) => measurement.maxRssBytes)),
  }
}

function percentile(sorted, quantile) {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)]
}

function positiveInteger(value) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received ${value}.`)
  }
  return parsed
}

function positiveNumber(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive number, received ${value}.`)
  }
  return parsed
}
