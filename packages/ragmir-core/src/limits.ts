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
    maxFiles: null,
    maxCorpusBytes: null,
    maxPdfPages: MAX_PDF_PAGES,
    maxPdfTextCharacters: MAX_PDF_TEXT_CHARACTERS,
    maxOfficeTextEntries: MAX_OFFICE_TEXT_ENTRY_COUNT,
    maxOfficeEntryBytes: MAX_OFFICE_XML_ENTRY_BYTES,
    maxOfficeTotalTextBytes: MAX_OFFICE_XML_TOTAL_BYTES,
    maxExternalTextOutputBytes: MAX_EXTERNAL_TEXT_STDIO_BYTES,
    notes: [
      "Ragmir has no hard file-count or total-corpus-size limit; available disk, memory, embedding throughput, and exact-search latency are the practical constraints.",
      "Files larger than maxFileBytes are skipped before parsing and reported by ingest, audit, and doctor.",
      "PDF, Office/archive, and external extractor limits are hard safety blocks and surface as ingestion errors.",
    ],
  }
}
