import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { DEFAULT_CONFIG } from "../dist/defaults.js"
import { inventorySourceFiles } from "../dist/files.js"
import { environmentMetadata } from "./lib/metrics.mjs"

const stress = process.argv.includes("--stress")
const totalFiles = stress ? 100_000 : 1_000
const includedFiles = Math.ceil(totalFiles / 10)
const excludedFiles = totalFiles - includedFiles
const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-discovery-benchmark-"))
const rawDir = path.join(root, ".ragmir", "raw")
const result = { first: null, noOp: null, excluded: null }

try {
  await createCorpus(path.join(rawDir, "included"), includedFiles, 0)
  await createCorpus(path.join(rawDir, "excluded"), excludedFiles, includedFiles)
  const config = benchmarkConfig(root, "storage-full", [])
  const excludedConfig = benchmarkConfig(root, "storage-excluded", [
    `!${DEFAULT_CONFIG.rawDir}/excluded/**`,
  ])

  result.first = await measuredInventory(config)
  result.noOp = await measuredInventory(config)
  result.excluded = await measuredInventory(excludedConfig)

  const report = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    profile: stress ? "stress" : "smoke",
    claimEligible: stress,
    environment: environmentMetadata(),
    configuration: { totalFiles, includedFiles, excludedFiles },
    ...result,
    passed:
      result.first.inventory.hashedFiles === totalFiles &&
      result.first.inventory.contentBytesRead > 0 &&
      result.noOp.inventory.hashedFiles === 0 &&
      result.noOp.inventory.contentBytesRead === 0 &&
      result.noOp.inventory.reusedFingerprints === totalFiles &&
      result.noOp.inventory.supportedFiles === totalFiles &&
      result.excluded.inventory.hashedFiles === includedFiles &&
      result.excluded.inventory.supportedFiles === includedFiles,
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (!report.passed) {
    process.exitCode = 1
  }
} finally {
  await rm(root, { recursive: true, force: true })
}

async function createCorpus(directory, count, offset) {
  await mkdir(directory, { recursive: true })
  const indices = Array.from({ length: count }, (_entry, index) => index)
  await mapLimit(indices, 64, async (index) => {
    const id = String(offset + index).padStart(6, "0")
    await writeFile(path.join(directory, `evidence-${id}.md`), `evidence ${id}\n`, "utf8")
  })
}

function benchmarkConfig(projectRoot, storageName, sources) {
  return {
    ...DEFAULT_CONFIG,
    projectRoot,
    acceptedRisks: [...DEFAULT_CONFIG.acceptedRisks],
    rawDir: path.join(projectRoot, DEFAULT_CONFIG.rawDir),
    storageDir: path.join(projectRoot, ".ragmir", storageName),
    sourcesFile: path.join(projectRoot, DEFAULT_CONFIG.sourcesFile),
    sources,
    accessLogPath: path.join(projectRoot, DEFAULT_CONFIG.accessLogPath),
    embeddingModelPath: path.join(projectRoot, DEFAULT_CONFIG.embeddingModelPath),
    redaction: { ...DEFAULT_CONFIG.redaction, patterns: [...DEFAULT_CONFIG.redaction.patterns] },
    includeExtensions: [...DEFAULT_CONFIG.includeExtensions],
    pdfOcrCommand: [...DEFAULT_CONFIG.pdfOcrCommand],
    imageOcrCommand: [...DEFAULT_CONFIG.imageOcrCommand],
    legacyWordCommand: [...DEFAULT_CONFIG.legacyWordCommand],
  }
}

async function measuredInventory(config) {
  const startedAt = performance.now()
  const inventory = await inventorySourceFiles(config)
  return {
    wallMs: performance.now() - startedAt,
    inventory: {
      discoveredFiles: inventory.discoveredFiles,
      supportedFiles: inventory.supportedFiles.length,
      skippedFiles: inventory.skippedFiles.length,
      contentBytesRead: inventory.contentBytesRead,
      hashedFiles: inventory.hashedFiles,
      reusedFingerprints: inventory.reusedFingerprints,
    },
  }
}

async function mapLimit(values, limit, worker) {
  let nextIndex = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      while (nextIndex < values.length) {
        const value = values[nextIndex]
        nextIndex += 1
        await worker(value)
      }
    }),
  )
}
