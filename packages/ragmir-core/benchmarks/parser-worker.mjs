import { createHash } from "node:crypto"
import { stat } from "node:fs/promises"
import path from "node:path"
import { chunkDocument } from "../dist/chunking.js"
import { parseFile } from "../dist/parsing.js"

const [format, validPath, malformedPath] = process.argv.slice(2)
if (!format || !validPath || !malformedPath) {
  throw new Error("Expected a format, valid fixture path, and malformed fixture path.")
}

const validFile = await sourceFile(validPath, format)
const baselineRssBytes = process.memoryUsage().rss
const startedAt = performance.now()
const parsed = await parseFile(validFile)
const chunks = chunkDocument(parsed, 4_096, 512, { maxChunks: 50_000 })
const wallMs = performance.now() - startedAt
const evidenceChunk = chunks.find((chunk) => chunk.text.includes(`PARSER-EVIDENCE-${format}`))
const usageAfterValid = process.resourceUsage()

const malformedStartedAt = performance.now()
let malformedRejected = false
let malformedError = ""
try {
  await parseFile(await sourceFile(malformedPath, format))
} catch (error) {
  malformedRejected = true
  malformedError = error instanceof Error ? error.message : String(error)
}
const malformedWallMs = performance.now() - malformedStartedAt
const sourceMebibytes = validFile.bytes / (1_024 * 1_024)
const parsedMebibytes = Buffer.byteLength(parsed.text) / (1_024 * 1_024)

process.stdout.write(
  `${JSON.stringify({
    format,
    sourceBytes: validFile.bytes,
    parsedBytes: Buffer.byteLength(parsed.text),
    outputSha256: createHash("sha256").update(parsed.text).digest("hex"),
    chunks: chunks.length,
    wallMs,
    sourceMebibytesPerSecond: wallMs === 0 ? 0 : (sourceMebibytes * 1_000) / wallMs,
    parsedMebibytesPerSecond: wallMs === 0 ? 0 : (parsedMebibytes * 1_000) / wallMs,
    baselineRssBytes,
    peakRssBytes: usageAfterValid.maxRSS * 1_024,
    evidenceFound: evidenceChunk !== undefined,
    evidenceLocation: evidenceChunk ? locationFor(evidenceChunk) : null,
    malformed: {
      rejected: malformedRejected,
      wallMs: malformedWallMs,
      error: malformedError.slice(0, 240),
    },
  })}\n`,
)

async function sourceFile(filePath, extension) {
  const metadata = await stat(filePath)
  return {
    absolutePath: filePath,
    relativePath: path.basename(filePath),
    source: path.basename(filePath),
    extension: `.${extension}`,
    bytes: metadata.size,
    mtimeMs: metadata.mtimeMs,
    checksum: "parser-benchmark",
  }
}

function locationFor(chunk) {
  return {
    kind: chunk.locationKind ?? null,
    start: chunk.locationStart ?? null,
    end: chunk.locationEnd ?? null,
    label: chunk.locationLabel ?? null,
    cellStart: chunk.cellStart ?? null,
    cellEnd: chunk.cellEnd ?? null,
    pageStart: chunk.pageStart ?? null,
    pageEnd: chunk.pageEnd ?? null,
  }
}
