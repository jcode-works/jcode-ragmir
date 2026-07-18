import { subscribe, unsubscribe } from "node:diagnostics_channel"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { fileURLToPath } from "node:url"
import { activeIngestionMetrics } from "../dist/ingestion-metrics.js"
import { ingest, INGESTION_DIAGNOSTICS_CHANNEL, initProject } from "../dist/index.js"
import { environmentMetadata } from "./lib/metrics.mjs"

const PROBE_ITERATIONS = 2_000_000
const PROBE_SAMPLES = 7
const DISABLED_PROBE_BUDGET_NS = 100
const here = path.dirname(fileURLToPath(import.meta.url))
const resultDir = path.join(here, ".results")
const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-observability-benchmark-"))
const privateText = "PRIVATE-OBSERVABILITY-BENCHMARK-EVIDENCE"
const relativePath = ".ragmir/raw/private-observability.md"
const events = []
const onDiagnostic = (event) => events.push(event)

try {
  await initProject(root)
  await writeFile(
    path.join(root, relativePath),
    `${privateText}\n${"bounded local evidence ".repeat(1_000)}\n`,
    "utf8",
  )

  subscribe(INGESTION_DIAGNOSTICS_CHANNEL, onDiagnostic)
  let ingestion
  try {
    ingestion = await ingest({ cwd: root, rebuild: true, collectMetrics: true })
  } finally {
    unsubscribe(INGESTION_DIAGNOSTICS_CHANNEL, onDiagnostic)
  }

  const baselineProbeMs = measureProbe(() => undefined)
  const disabledProbeMs = measureProbe(activeIngestionMetrics)
  const disabledOverheadNs = Math.max(
    0,
    ((median(disabledProbeMs) - median(baselineProbeMs)) * 1_000_000) / PROBE_ITERATIONS,
  )
  const metrics = ingestion.metrics
  const phaseValues = metrics ? Object.values(metrics.phaseDurations) : []
  const serializedDiagnostics = JSON.stringify(events)
  const gates = {
    metricsReturned: metrics !== undefined,
    phaseAttribution:
      phaseValues.length === 11 &&
      phaseValues.every((value) => Number.isFinite(value) && value >= 0) &&
      (metrics?.phaseDurations.hashingMs ?? 0) > 0 &&
      (metrics?.phaseDurations.parsingMs ?? 0) > 0 &&
      (metrics?.phaseDurations.embeddingMs ?? 0) > 0 &&
      (metrics?.phaseDurations.storageWriteMs ?? 0) > 0 &&
      (metrics?.phaseDurations.maintenanceMs ?? 0) > 0,
    throughput:
      (metrics?.throughput.filesPerSecond ?? 0) > 0 &&
      (metrics?.throughput.chunksPerSecond ?? 0) > 0 &&
      (metrics?.sourceBytesRead ?? 0) > 0 &&
      (metrics?.storagePayloadBytes ?? 0) > 0,
    boundedDiagnostics: events.length === 1,
    privacySafe:
      !serializedDiagnostics.includes(root) &&
      !serializedDiagnostics.includes(relativePath) &&
      !serializedDiagnostics.includes(privateText),
    disabledProbeInactive: activeIngestionMetrics() === undefined,
    disabledProbeOverhead: disabledOverheadNs <= DISABLED_PROBE_BUDGET_NS,
  }
  const report = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    environment: environmentMetadata(),
    configuration: {
      probeIterations: PROBE_ITERATIONS,
      probeSamples: PROBE_SAMPLES,
      disabledProbeBudgetNs: DISABLED_PROBE_BUDGET_NS,
    },
    ingestion: {
      indexedFiles: ingestion.indexedFiles,
      chunks: ingestion.chunks,
      metrics,
    },
    disabledPath: {
      baselineProbeMs,
      disabledProbeMs,
      disabledOverheadNs,
    },
    diagnosticEvents: events.length,
    gates,
    passed: Object.values(gates).every(Boolean),
  }
  await mkdir(resultDir, { recursive: true })
  const resultPath = path.join(
    resultDir,
    `${new Date().toISOString().replaceAll(":", "-")}-observability.json`,
  )
  await writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  process.stdout.write(`${JSON.stringify({ resultPath, ...report }, null, 2)}\n`)
  if (!report.passed) {
    process.exitCode = 1
  }
} finally {
  await rm(root, { recursive: true, force: true })
}

function measureProbe(probe) {
  for (let index = 0; index < 100_000; index += 1) {
    probe()
  }
  const samples = []
  let sink = 0
  for (let sample = 0; sample < PROBE_SAMPLES; sample += 1) {
    const startedAt = performance.now()
    for (let index = 0; index < PROBE_ITERATIONS; index += 1) {
      if (probe() === undefined) {
        sink += 1
      }
    }
    samples.push(performance.now() - startedAt)
  }
  if (sink === 0) {
    throw new Error("Observability probe did not execute.")
  }
  return samples
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}
