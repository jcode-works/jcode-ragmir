import {
  MAX_CONFIGURED_FILE_BYTES,
  MAX_EMBEDDING_BATCH_SIZE,
  MAX_INGEST_CHUNK_WINDOW,
  MAX_INGEST_CHUNKS_PER_FILE,
  MAX_INGEST_CONCURRENCY,
  MAX_INGEST_FILE_BATCH_SIZE,
  MAX_INGEST_SOURCE_WINDOW_BYTES,
  MAX_INGEST_VECTOR_BYTES_PER_FILE,
} from "./defaults.js"
import type { Config, IngestionLimitsReport } from "./types.js"

export const MAX_OFFICE_XML_ENTRY_BYTES = 25_000_000
export const MAX_OFFICE_TEXT_ENTRY_COUNT = 512
export const MAX_OFFICE_XML_TOTAL_BYTES = 50_000_000
export const MAX_EXTERNAL_TEXT_STDIO_BYTES = 25_000_000
export const MAX_PDF_PAGES = 1_000
export const MAX_PDF_TEXT_CHARACTERS = 25_000_000

export function ingestionLimits(config: Pick<Config, "maxFileBytes">): IngestionLimitsReport {
  return {
    maxFileBytes: config.maxFileBytes,
    hardMaxFileBytes: MAX_CONFIGURED_FILE_BYTES,
    maxFiles: null,
    maxCorpusBytes: null,
    maxFileBatchSize: MAX_INGEST_FILE_BATCH_SIZE,
    maxIngestConcurrency: MAX_INGEST_CONCURRENCY,
    maxEmbeddingBatchSize: MAX_EMBEDDING_BATCH_SIZE,
    maxSourceWindowBytes: MAX_INGEST_SOURCE_WINDOW_BYTES,
    maxChunkWindow: MAX_INGEST_CHUNK_WINDOW,
    maxChunksPerFile: MAX_INGEST_CHUNKS_PER_FILE,
    maxVectorBytesPerFile: MAX_INGEST_VECTOR_BYTES_PER_FILE,
    maxPdfPages: MAX_PDF_PAGES,
    maxPdfTextCharacters: MAX_PDF_TEXT_CHARACTERS,
    maxOfficeTextEntries: MAX_OFFICE_TEXT_ENTRY_COUNT,
    maxOfficeEntryBytes: MAX_OFFICE_XML_ENTRY_BYTES,
    maxOfficeTotalTextBytes: MAX_OFFICE_XML_TOTAL_BYTES,
    maxExternalTextOutputBytes: MAX_EXTERNAL_TEXT_STDIO_BYTES,
    notes: [
      "Ragmir has no hard file-count or total-corpus-size limit; source bytes, estimated chunks, vector bytes, concurrency, and commit size are bounded independently.",
      "Files larger than maxFileBytes are skipped before parsing and reported by ingest, audit, and doctor.",
      "Each successful file is committed independently, so cancellation or restart repeats at most one bounded file commit.",
      "PDF, Office/archive, and external extractor limits are hard safety blocks and surface as ingestion errors.",
    ],
  }
}
