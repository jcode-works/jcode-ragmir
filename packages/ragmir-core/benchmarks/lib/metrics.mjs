import { createHash } from "node:crypto"
import { readFile, readdir, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { monitorEventLoopDelay, performance } from "node:perf_hooks"
import { spawnSync } from "node:child_process"

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

export function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

export function percentile(values, quantile) {
  if (values.length === 0) {
    return 0
  }
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.max(0, Math.ceil(quantile * sorted.length) - 1)
  return sorted[index] ?? 0
}

export function summarizeSamples(values) {
  const total = values.reduce((sum, value) => sum + value, 0)
  return {
    count: values.length,
    minMs: values.length === 0 ? 0 : Math.min(...values),
    meanMs: values.length === 0 ? 0 : total / values.length,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    p99Ms: percentile(values, 0.99),
    maxMs: values.length === 0 ? 0 : Math.max(...values),
  }
}

export async function measureOperation(name, operation) {
  const beforeUsage = process.resourceUsage()
  const beforeIo = await readProcessIo()
  const delay = monitorEventLoopDelay({ resolution: 10 })
  delay.enable()
  const startedAt = performance.now()
  try {
    const value = await operation()
    return {
      value,
      measurement: finishMeasurement(name, startedAt, beforeUsage, beforeIo, delay),
    }
  } catch (error) {
    const measurement = finishMeasurement(name, startedAt, beforeUsage, beforeIo, delay)
    if (error !== null && typeof error === "object") {
      Object.defineProperty(error, "benchmarkMeasurement", {
        configurable: true,
        enumerable: false,
        value: measurement,
      })
    }
    throw error
  }
}

export async function measureSeries({ warmups, samples, repetitions, operation }) {
  for (let index = 0; index < warmups; index += 1) {
    await operation(index)
  }

  const repetitionResults = []
  const allDurations = []
  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    const durations = []
    const startedAt = performance.now()
    for (let index = 0; index < samples; index += 1) {
      const sampleStartedAt = performance.now()
      await operation(index)
      durations.push(performance.now() - sampleStartedAt)
    }
    const wallMs = performance.now() - startedAt
    allDurations.push(...durations)
    repetitionResults.push({
      repetition: repetition + 1,
      wallMs,
      throughputPerSecond: wallMs === 0 ? 0 : (samples * 1_000) / wallMs,
      latency: summarizeSamples(durations),
    })
  }

  const totalWallMs = repetitionResults.reduce((sum, result) => sum + result.wallMs, 0)
  return {
    warmups,
    samplesPerRepetition: samples,
    repetitions,
    latency: summarizeSamples(allDurations),
    throughputPerSecond:
      totalWallMs === 0 ? 0 : (samples * repetitions * 1_000) / totalWallMs,
    runs: repetitionResults,
  }
}

export async function directorySize(root) {
  let total = 0
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      total += await directorySize(entryPath)
    } else if (entry.isFile()) {
      total += (await stat(entryPath)).size
    }
  }
  return total
}

export function environmentMetadata() {
  const cpu = os.cpus()[0]
  const commit = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" })
  const machine = {
    platform: process.platform,
    release: os.release(),
    architecture: process.arch,
    cpuModel: cpu?.model ?? "unknown",
    logicalCpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    nodeVersion: process.version,
  }
  return {
    commit: commit.status === 0 ? commit.stdout.trim() : "unknown",
    machine,
    machineFingerprint: sha256(stableJson(machine)),
  }
}

function finishMeasurement(name, startedAt, beforeUsage, beforeIo, delay) {
  const wallMs = performance.now() - startedAt
  delay.disable()
  const usage = process.resourceUsage()
  const eventLoopDelay = {
    meanMs: Number.isNaN(delay.mean) ? 0 : delay.mean / 1_000_000,
    p95Ms: delay.percentile(95) / 1_000_000,
    maxMs: delay.max / 1_000_000,
  }
  const afterIoPromise = readProcessIo()
  return {
    name,
    wallMs,
    userCpuMs: (usage.userCPUTime - beforeUsage.userCPUTime) / 1_000,
    systemCpuMs: (usage.systemCPUTime - beforeUsage.systemCPUTime) / 1_000,
    maxRssKiB: usage.maxRSS,
    fsReadOperations: usage.fsRead - beforeUsage.fsRead,
    fsWriteOperations: usage.fsWrite - beforeUsage.fsWrite,
    eventLoopDelay,
    ioBytes: afterIoPromise.then((afterIo) => diffIo(beforeIo, afterIo)),
  }
}

async function readProcessIo() {
  if (process.platform !== "linux") {
    return null
  }
  try {
    const raw = await readFile("/proc/self/io", "utf8")
    const fields = Object.fromEntries(
      raw
        .trim()
        .split("\n")
        .map((line) => {
          const [key, value] = line.split(":")
          return [key?.trim(), Number(value?.trim())]
        }),
    )
    return {
      readBytes: fields.read_bytes ?? 0,
      writeBytes: fields.write_bytes ?? 0,
    }
  } catch {
    return null
  }
}

function diffIo(before, after) {
  if (before === null || after === null) {
    return null
  }
  return {
    readBytes: Math.max(0, after.readBytes - before.readBytes),
    writeBytes: Math.max(0, after.writeBytes - before.writeBytes),
  }
}

export async function settleMeasurement(measurement) {
  return {
    ...measurement,
    ioBytes: await measurement.ioBytes,
  }
}
