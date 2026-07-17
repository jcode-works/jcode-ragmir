import { execFile } from "node:child_process"
import { mkdir, mkdtemp, open, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { directorySize, environmentMetadata } from "./lib/metrics.mjs"

const execFileAsync = promisify(execFile)
const here = path.dirname(fileURLToPath(import.meta.url))
const invocationRoot = process.env.INIT_CWD ?? process.cwd()
const options = parseArguments(process.argv.slice(2))
const stress = options.stress === true
const fileBytes = integerOption(
  options.fileBytes,
  stress ? 50_000_000 : 5_000_000,
  "fileBytes",
)
const fileCounts = options.files
  ? [integerOption(options.files, 1, "files")]
  : stress
    ? [5, 25]
    : [2, 5]
const budgetMiB = integerOption(options.budgetMiB, 768, "budgetMiB")
const budgetBytes = budgetMiB * 1_024 * 1_024
const profile = stress ? "stress" : "smoke"
const resultPath = path.resolve(
  invocationRoot,
  options.result ??
    path.join(
      here,
      ".results",
      `${new Date().toISOString().replaceAll(":", "-")}-ingest-memory-${profile}.json`,
    ),
)
const cases = []
const preservedRoots = []

try {
  for (const fileCount of fileCounts) {
    const root = await mkdtemp(path.join(os.tmpdir(), `ragmir-ingest-memory-${fileCount}-`))
    try {
      await createCorpus(root, fileCount, fileBytes)
      const workerPath = path.join(here, "ingest-memory-worker.mjs")
      const { stdout, stderr } = await execFileAsync(process.execPath, [workerPath, root], {
        cwd: invocationRoot,
        maxBuffer: 8 * 1_024 * 1_024,
      })
      const worker = parseWorkerResult(stdout)
      const sourceBytes = fileCount * fileBytes
      const storageBytes = await directorySize(path.join(root, ".ragmir", "storage"))
      const passed =
        worker.peakRssBytes <= budgetBytes &&
        worker.result.indexedFiles === fileCount &&
        worker.result.chunks === fileCount &&
        worker.result.errors.length === 0
      cases.push({
        fileCount,
        fileBytes,
        sourceBytes,
        storageBytes,
        budgetBytes,
        ...worker,
        stderr: stderr.trim(),
        passed,
      })
    } finally {
      if (options.keep === true) {
        preservedRoots.push(root)
      } else {
        await rm(root, { recursive: true, force: true })
      }
    }
  }

  const report = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    profile,
    claimEligible: stress && fileCounts.includes(25) && fileBytes === 50_000_000,
    environment: environmentMetadata(),
    configuration: {
      fileCounts,
      fileBytes,
      budgetMiB,
      chunkSize: 1_000_000,
      chunkOverlap: 0,
      embeddingProvider: "local-hash",
    },
    cases,
    peakGrowthRatio:
      cases.length < 2 || !cases[0]
        ? null
        : (cases.at(-1)?.peakRssBytes ?? 0) / cases[0].peakRssBytes,
    passed: cases.every((entry) => entry.passed),
  }
  await mkdir(path.dirname(resultPath), { recursive: true })
  await writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  process.stdout.write(`${JSON.stringify({ resultPath, ...report }, null, 2)}\n`)
  if (!report.passed) {
    process.exitCode = 1
  }
} finally {
  for (const root of preservedRoots) {
    process.stderr.write(`Ingestion memory corpus preserved at ${root}\n`)
  }
}

async function createCorpus(root, fileCount, fileBytes) {
  const ragmirDir = path.join(root, ".ragmir")
  const rawDir = path.join(ragmirDir, "raw")
  await mkdir(rawDir, { recursive: true })
  await writeFile(
    path.join(ragmirDir, "config.json"),
    `${JSON.stringify(
      {
        accessLog: false,
        chunkSize: 1_000_000,
        chunkOverlap: 0,
        maxFileBytes: fileBytes,
        ingestConcurrency: 8,
        embeddingBatchSize: 32,
      },
      null,
      2,
    )}\n`,
    "utf8",
  )
  for (let index = 0; index < fileCount; index += 1) {
    await writePaddedEvidence(path.join(rawDir, `evidence-${index}.md`), index, fileBytes)
  }
}

async function writePaddedEvidence(targetPath, index, fileBytes) {
  const header = Buffer.from(
    `# Memory evidence ${index}\nMEMORY-EVIDENCE-${index} is stable and cited.\n`,
    "utf8",
  )
  if (header.length > fileBytes) {
    throw new Error(`fileBytes must be at least ${header.length}.`)
  }
  const whitespace = Buffer.alloc(1_024 * 1_024, 0x20)
  for (let index = 4_095; index < whitespace.length; index += 4_096) {
    whitespace[index] = 0x0a
  }
  const handle = await open(targetPath, "wx", 0o600)
  try {
    let position = 0
    await handle.write(header, 0, header.length, position)
    position += header.length
    while (position < fileBytes) {
      const length = Math.min(whitespace.length, fileBytes - position)
      await handle.write(whitespace, 0, length, position)
      position += length
    }
    await handle.sync()
  } finally {
    await handle.close()
  }
}

function parseWorkerResult(stdout) {
  const line = stdout
    .trim()
    .split("\n")
    .findLast((entry) => entry.length > 0)
  if (!line) {
    throw new Error("Ingestion memory worker returned no result.")
  }
  const result = JSON.parse(line)
  if (
    typeof result !== "object" ||
    result === null ||
    typeof result.peakRssBytes !== "number" ||
    typeof result.peakRssKiB !== "number" ||
    typeof result.baselineRssBytes !== "number" ||
    typeof result.wallMs !== "number" ||
    typeof result.result !== "object" ||
    result.result === null ||
    !Array.isArray(result.result.errors)
  ) {
    throw new Error("Ingestion memory worker returned an invalid result.")
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
    if (value === "--stress" || value === "--keep") {
      parsed[value.slice(2)] = true
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
