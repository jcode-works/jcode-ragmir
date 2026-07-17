import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { validateIngestionMetadata } from "../dist/ingest.js"
import {
  compactIngestionState,
  createIngestionRunState,
  ingestionProgress,
  readIngestionState,
  writeIngestionState,
} from "../dist/ingestion-state.js"
import { writeIndexManifest } from "../dist/store.js"

const fileCount = positiveInteger(process.argv[2], "fileCount")
const chunksPerFile = positiveInteger(process.argv[3], "chunksPerFile")
const chunkCount = fileCount * chunksPerFile
const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-ingestion-metadata-"))
const config = {
  projectRoot: root,
  storageDir: path.join(root, ".ragmir", "storage"),
  tableName: "chunks",
}
const startedAt = performance.now()
const rssCheckpoints = []

try {
  let state = createState(root, fileCount, chunksPerFile)
  collectGarbage()
  recordRss("created", rssCheckpoints)
  await writeIngestionState(state, config)
  recordRss("snapshotted", rssCheckpoints)
  state = null
  collectGarbage()
  recordRss("released", rssCheckpoints)
  state = await readIngestionState(config)
  if (!state) {
    throw new Error("Expected the 100k-file ingestion snapshot to resume.")
  }
  recordRss("resumed", rssCheckpoints)
  const progress = ingestionProgress(state)
  await compactIngestionState(state, config)
  collectGarbage()
  recordRss("compacted", rssCheckpoints)

  const expectedFiles = state.files
  recordRss("expected-files", rssCheckpoints)
  await validateIngestionMetadata({
    expectedChunkCount: chunkCount,
    actualChunkCount: chunkCount,
    expectedFiles,
    idRows: generatedIdRows(chunkCount),
    fileRows: generatedFileRows(state.files, chunksPerFile),
  })
  recordRss("validated", rssCheckpoints)
  await writeIndexManifest(
    {
      schemaVersion: 8,
      createdAt: new Date().toISOString(),
      ragmirVersion: "benchmark",
      embeddingProvider: "local-hash",
      embeddingModel: "benchmark",
      chunkSize: 1_200,
      chunkOverlap: 200,
      fileCount,
      chunkCount,
      tableName: config.tableName,
    },
    config,
    manifestFiles(state.files),
  )
  recordRss("manifest-written", rssCheckpoints)

  const usage = process.resourceUsage()
  process.stdout.write(
    `${JSON.stringify({
      peakRssKiB: usage.maxRSS,
      peakRssBytes: usage.maxRSS * 1_024,
      wallMs: performance.now() - startedAt,
      rssCheckpoints,
      progress,
    })}\n`,
  )
} finally {
  await rm(root, { recursive: true, force: true })
}

function createState(root, count, chunks) {
  const files = Array.from({ length: count }, (_entry, index) => {
    const id = String(index).padStart(6, "0")
    return {
      absolutePath: path.join(root, "raw", `evidence-${id}.md`),
      relativePath: `raw/evidence-${id}.md`,
      source: "synthetic",
      extension: ".md",
      bytes: 1_024,
      mtimeMs: 1,
      checksum: index.toString(16).padStart(64, "0"),
    }
  })
  return createIngestionRunState({
    mode: "incremental",
    tableName: "chunks",
    previousTableName: null,
    policyFingerprint: "ingestion-metadata-benchmark",
    batchSize: 128,
    files,
    reusablePaths: new Set(files.map((file) => file.relativePath)),
    reusableChunkCounts: new Map(files.map((file) => [file.relativePath, chunks])),
  })
}

async function* generatedIdRows(count) {
  for (let index = 0; index < count; index += 1) {
    yield { id: index.toString(16).padStart(64, "0") }
  }
}

async function* generatedFileRows(files, chunksPerSource) {
  for (const file of files) {
    for (let index = 0; index < chunksPerSource; index += 1) {
      yield { relativePath: file.relativePath, checksum: file.checksum }
    }
  }
}

function* manifestFiles(files) {
  for (const file of files) {
    yield {
      relativePath: file.relativePath,
      checksum: file.checksum,
      chunkCount: file.chunkCount,
      bytes: file.bytes,
      mtimeMs: file.mtimeMs,
    }
  }
}

function positiveInteger(value, name) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`)
  }
  return parsed
}

function collectGarbage() {
  globalThis.gc?.()
}

function recordRss(phase, checkpoints) {
  checkpoints.push({ phase, rssBytes: process.memoryUsage().rss })
}
