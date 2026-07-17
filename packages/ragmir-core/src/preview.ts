import { summarizeChunkStats } from "./chunk-stats.js"
import { chunkDocument } from "./chunking.js"
import { citationForCoordinates } from "./citation.js"
import { loadConfig } from "./config.js"
import { inventorySourceFiles } from "./files.js"
import { parseFile } from "./parsing.js"
import { redactDocument, totalRedactions } from "./redaction.js"
import type {
  PreviewChunk,
  PreviewChunksOptions,
  PreviewFile,
  PreviewReport,
  SourceFile,
  TextChunk,
} from "./types.js"

const DEFAULT_MAX_FILES = 5
const DEFAULT_MAX_CHUNKS_PER_FILE = 5
const MAX_PREVIEW_FILES = 25
const MAX_PREVIEW_CHUNKS_PER_FILE = 50

export async function previewChunks(options: PreviewChunksOptions = {}): Promise<PreviewReport> {
  const config = await loadConfig(String(options.cwd ?? process.cwd()))
  const inventory = await inventorySourceFiles(config)
  const requestedPaths = normalizePathPrefixes(options.paths)
  const maxFiles = boundedPositiveInteger(
    options.maxFiles,
    DEFAULT_MAX_FILES,
    MAX_PREVIEW_FILES,
    "maxFiles",
  )
  const maxChunksPerFile = boundedPositiveInteger(
    options.maxChunksPerFile,
    DEFAULT_MAX_CHUNKS_PER_FILE,
    MAX_PREVIEW_CHUNKS_PER_FILE,
    "maxChunksPerFile",
  )
  const matchingFiles = inventory.supportedFiles
    .filter((file) => requestedPaths.length === 0 || matchesAnyPath(file, requestedPaths))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  const selectedFiles = matchingFiles.slice(0, maxFiles)
  const unmatchedPaths = requestedPaths.filter(
    (prefix) => !inventory.supportedFiles.some((file) => matchesPath(file.relativePath, prefix)),
  )

  const previews = await Promise.all(
    selectedFiles.map((file) => previewFile(file, config, maxChunksPerFile)),
  )
  const files: PreviewFile[] = []
  const errors: PreviewReport["errors"] = []
  for (const preview of previews) {
    if ("error" in preview) {
      errors.push(preview.error)
    } else {
      files.push(preview.file)
    }
  }

  return {
    chunkSize: config.chunkSize,
    chunkOverlap: config.chunkOverlap,
    requestedPaths,
    unmatchedPaths,
    matchedFiles: matchingFiles.length,
    omittedFiles: Math.max(0, matchingFiles.length - selectedFiles.length),
    files,
    errors,
  }
}

async function previewFile(
  file: SourceFile,
  config: Awaited<ReturnType<typeof loadConfig>>,
  maxChunksPerFile: number,
): Promise<{ file: PreviewFile } | { error: { path: string; message: string } }> {
  try {
    const parsed = await parseFile(file, config)
    const redacted = redactDocument(parsed, config)
    const chunks = chunkDocument(redacted.document, config.chunkSize, config.chunkOverlap)
    return {
      file: {
        source: file.source,
        relativePath: file.relativePath,
        extension: file.extension,
        bytes: file.bytes,
        parsedChars: redacted.document.text.length,
        redactions: totalRedactions(redacted.counts),
        chunkStats: summarizeChunkStats(chunks),
        chunks: chunks.slice(0, maxChunksPerFile).map(previewChunk),
        omittedChunks: Math.max(0, chunks.length - maxChunksPerFile),
      },
    }
  } catch (error) {
    return {
      error: {
        path: file.relativePath,
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

function previewChunk(chunk: TextChunk): PreviewChunk {
  return {
    chunkIndex: chunk.chunkIndex,
    contextPath: chunk.contextPath,
    citation: citationForChunk(chunk),
    text: chunk.text,
    charStart: chunk.charStart,
    charEnd: chunk.charEnd,
    lineStart: chunk.lineStart ?? null,
    lineEnd: chunk.lineEnd ?? null,
    pageStart: chunk.pageStart ?? null,
    pageEnd: chunk.pageEnd ?? null,
  }
}

function citationForChunk(chunk: TextChunk): string {
  return citationForCoordinates(chunk)
}

function matchesAnyPath(file: SourceFile, prefixes: string[]): boolean {
  return prefixes.some((prefix) => matchesPath(file.relativePath, prefix))
}

function matchesPath(relativePath: string, prefix: string): boolean {
  return relativePath === prefix || relativePath.startsWith(`${prefix}/`)
}

function normalizePathPrefixes(prefixes: string[] | undefined): string[] {
  return [
    ...new Set(
      (prefixes ?? [])
        .map((prefix) => prefix.trim().replaceAll("\\", "/").replace(/^\.\//u, ""))
        .map((prefix) => prefix.replace(/\/+$/u, ""))
        .filter(Boolean),
    ),
  ]
}

function boundedPositiveInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
  name: string,
): number {
  if (value === undefined) {
    return fallback
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`)
  }
  return Math.min(value, maximum)
}
