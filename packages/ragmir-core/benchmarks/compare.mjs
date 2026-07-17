import { readFile } from "node:fs/promises"
import path from "node:path"

const options = parseArguments(process.argv.slice(2))
if (!options.baseline || !options.current) {
  throw new Error("Usage: compare.mjs --baseline <result.json> --current <result.json>")
}

const invocationRoot = process.env.INIT_CWD ?? process.cwd()
const baselinePath = path.resolve(invocationRoot, options.baseline)
const currentPath = path.resolve(invocationRoot, options.current)
const baseline = JSON.parse(await readFile(baselinePath, "utf8"))
const current = JSON.parse(await readFile(currentPath, "utf8"))
const sameMachine =
  baseline.environment?.machineFingerprint === current.environment?.machineFingerprint
const sameCorpus = baseline.corpus?.corpusHash === current.corpus?.corpusHash
const sameProvider =
  baseline.configuration?.embeddingProvider === current.configuration?.embeddingProvider
const comparable = sameCorpus && sameProvider && (sameMachine || options.allowCrossMachine === true)

const comparisons = [
  compareMetric("persistentSearchP95", baseline, current, ["search", "persistent", "latency", "p95Ms"], 0.15, "lower"),
  compareMetric("persistentSearchThroughput", baseline, current, ["search", "persistent", "throughputPerSecond"], 0.1, "higher"),
  compareMetric("peakRss", baseline, current, ["resources", "maxRssKiB"], 0.1, "lower"),
  compareMetric("storageBytes", baseline, current, ["storage", "physicalBytes"], 0.1, "lower"),
  compareMetric("recall", baseline, current, ["quality", "recall"], 0, "higher"),
  compareMetric("ndcg", baseline, current, ["quality", "ndcg"], 0, "higher"),
]
const failed = comparisons.filter((comparison) => comparison.status === "fail")
const status = comparable ? (failed.length === 0 ? "pass" : "fail") : "inconclusive"
const result = {
  schemaVersion: 1,
  status,
  comparable,
  reasons: {
    sameMachine,
    sameCorpus,
    sameProvider,
    crossMachineAllowed: options.allowCrossMachine === true,
  },
  comparisons,
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
if (status === "fail") {
  process.exitCode = 1
}

function compareMetric(name, baseline, current, fieldPath, tolerance, direction) {
  const baselineValue = readPath(baseline, fieldPath)
  const currentValue = readPath(current, fieldPath)
  if (typeof baselineValue !== "number" || typeof currentValue !== "number") {
    return { name, status: "missing", baseline: baselineValue, current: currentValue }
  }
  const deltaRatio = baselineValue === 0 ? 0 : (currentValue - baselineValue) / baselineValue
  const failed = direction === "lower" ? deltaRatio > tolerance : deltaRatio < -tolerance
  return {
    name,
    status: failed ? "fail" : "pass",
    direction,
    tolerance,
    baseline: baselineValue,
    current: currentValue,
    deltaRatio,
  }
}

function readPath(value, fieldPath) {
  return fieldPath.reduce((current, key) => current?.[key], value)
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
