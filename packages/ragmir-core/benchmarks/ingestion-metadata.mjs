import { execFile } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { environmentMetadata } from "./lib/metrics.mjs"

const execFileAsync = promisify(execFile)
const here = path.dirname(fileURLToPath(import.meta.url))
const invocationRoot = process.env.INIT_CWD ?? process.cwd()
const options = parseArguments(process.argv.slice(2))
const stress = options.stress === true
const fileCount = integerOption(options.files, stress ? 100_000 : 10_000, "files")
const chunksPerFile = integerOption(options.chunksPerFile, 10, "chunksPerFile")
const budgetMiB = integerOption(options.budgetMiB, 256, "budgetMiB")
const budgetBytes = budgetMiB * 1_024 * 1_024
const resultPath = path.resolve(
  invocationRoot,
  options.result ??
    path.join(
      here,
      ".results",
      `${new Date().toISOString().replaceAll(":", "-")}-ingestion-metadata.json`,
    ),
)
const workerPath = path.join(here, "ingestion-metadata-worker.mjs")
const halfWorker = stress
  ? await runWorker(Math.ceil(fileCount / 2), chunksPerFile)
  : null
const fullWorker = await runWorker(fileCount, chunksPerFile)
const worker = fullWorker.result
const scaling = halfWorker
  ? {
      smallerFileCount: Math.ceil(fileCount / 2),
      largerFileCount: fileCount,
      smallerWallMs: halfWorker.result.wallMs,
      largerWallMs: worker.wallMs,
      wallTimeRatio: worker.wallMs / halfWorker.result.wallMs,
      maximumNearLinearRatio: 2.5,
      passed: worker.wallMs / halfWorker.result.wallMs <= 2.5,
    }
  : null
const report = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  profile: stress ? "stress" : "smoke",
  claimEligible: stress && fileCount === 100_000 && chunksPerFile === 10,
  environment: environmentMetadata(),
  configuration: { fileCount, chunksPerFile, chunkCount: fileCount * chunksPerFile, budgetMiB },
  ...worker,
  scaling,
  stderr: [halfWorker?.stderr, fullWorker.stderr].filter(Boolean).join("\n"),
  passed:
    worker.peakRssBytes <= budgetBytes &&
    worker.progress.totalFiles === fileCount &&
    worker.progress.chunksIndexed === fileCount * chunksPerFile &&
    /^[0-9a-f]{64}$/u.test(worker.corpusFingerprint) &&
    (scaling?.passed ?? true),
}

await mkdir(path.dirname(resultPath), { recursive: true })
await writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
process.stdout.write(`${JSON.stringify({ resultPath, ...report }, null, 2)}\n`)
if (!report.passed) {
  process.exitCode = 1
}

async function runWorker(files, chunks) {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    ["--expose-gc", workerPath, String(files), String(chunks)],
    { cwd: invocationRoot, maxBuffer: 8 * 1_024 * 1_024 },
  )
  return { result: parseWorkerResult(stdout), stderr: stderr.trim() }
}

function parseWorkerResult(stdout) {
  const line = stdout
    .trim()
    .split("\n")
    .findLast((entry) => entry.length > 0)
  const result = line ? JSON.parse(line) : null
  if (
    typeof result !== "object" ||
    result === null ||
    typeof result.peakRssBytes !== "number" ||
    typeof result.wallMs !== "number" ||
    typeof result.progress !== "object" ||
    result.progress === null
  ) {
    throw new Error("Ingestion metadata worker returned an invalid result.")
  }
  return result
}

function parseArguments(values) {
  const parsed = {}
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (value === "--") {
      continue
    }
    if (value === "--stress") {
      parsed.stress = true
      continue
    }
    if (!value?.startsWith("--")) {
      throw new Error(`Unknown argument ${JSON.stringify(value)}.`)
    }
    const next = values[index + 1]
    if (!next || next.startsWith("--")) {
      throw new Error(`${value} requires a value.`)
    }
    parsed[toCamelCase(value.slice(2))] = next
    index += 1
  }
  return parsed
}

function integerOption(value, fallback, name) {
  const selected = value === undefined ? fallback : Number(value)
  if (!Number.isSafeInteger(selected) || selected <= 0) {
    throw new Error(`${name} must be a positive integer.`)
  }
  return selected
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/gu, (_match, letter) => letter.toUpperCase())
}
