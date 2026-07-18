import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { readFile, readdir, stat } from "node:fs/promises"
import { createRequire } from "node:module"
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

export function environmentMetadata(options = {}) {
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
    runtimeDependencies: runtimeDependencyVersions(options.includeSemanticDependencies !== false),
  }
}

function runtimeDependencyVersions(includeSemanticDependencies) {
  const requireFrom = createRequire(import.meta.url)
  const lanceDbEntry = resolvePackageEntry(requireFrom, "@lancedb/lancedb")
  const lanceDbRequire = lanceDbEntry ? createRequire(lanceDbEntry) : requireFrom
  const transformersEntry = includeSemanticDependencies
    ? resolvePackageEntry(requireFrom, "@huggingface/transformers")
    : null
  const transformersRequire = transformersEntry ? createRequire(transformersEntry) : requireFrom
  return {
    lanceDb: resolvedPackageVersion(requireFrom, "@lancedb/lancedb"),
    lanceDbNative: resolvedLanceDbNative(lanceDbRequire),
    apacheArrow: resolvedPackageVersion(lanceDbRequire, "apache-arrow"),
    transformers: includeSemanticDependencies
      ? resolvedPackageVersion(requireFrom, "@huggingface/transformers")
      : null,
    onnxRuntime: includeSemanticDependencies
      ? resolvedPackageVersion(transformersRequire, "onnxruntime-node")
      : null,
    sharp: includeSemanticDependencies
      ? resolvedPackageVersion(transformersRequire, "sharp")
      : null,
  }
}

function resolvedLanceDbNative(requireFrom) {
  const base = `@lancedb/lancedb-${process.platform}-${process.arch}`
  const candidates =
    process.platform === "linux" ? [`${base}-gnu`, `${base}-musl`] : [`${base}-msvc`, base]
  for (const packageName of candidates) {
    const resolved = resolvedPackageVersion(requireFrom, packageName)
    if (resolved) {
      return { name: packageName, version: resolved }
    }
  }
  return null
}

function resolvedPackageVersion(requireFrom, packageName) {
  const entry = resolvePackageEntry(requireFrom, packageName)
  if (!entry) {
    return null
  }
  let directory = path.dirname(entry)
  while (true) {
    const manifestPath = path.join(directory, "package.json")
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
        if (manifest?.name === packageName && typeof manifest.version === "string") {
          return manifest.version
        }
      } catch {
        return null
      }
    }
    const parent = path.dirname(directory)
    if (parent === directory) {
      return null
    }
    directory = parent
  }
}

function resolvePackageEntry(requireFrom, packageName) {
  try {
    return requireFrom.resolve(packageName)
  } catch {
    return null
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
