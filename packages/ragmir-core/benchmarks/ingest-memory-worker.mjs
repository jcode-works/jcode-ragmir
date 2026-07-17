import { ingest } from "../dist/index.js"

const root = process.argv[2]
if (!root) {
  throw new Error("Expected an ingestion-memory project root.")
}

const baselineRssBytes = process.memoryUsage().rss
const startedAt = performance.now()
const result = await ingest({ cwd: root, rebuild: true, batchSize: 128 })
const wallMs = performance.now() - startedAt
const usage = process.resourceUsage()

process.stdout.write(
  `${JSON.stringify({
    baselineRssBytes,
    peakRssKiB: usage.maxRSS,
    peakRssBytes: usage.maxRSS * 1_024,
    wallMs,
    result: {
      chunks: result.chunks,
      indexedFiles: result.indexedFiles,
      errors: result.errors,
    },
  })}\n`,
)
