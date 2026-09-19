import { createHash } from "node:crypto"
import { PDF_OCR_PARSER_POLICY } from "./ocr-cache.js"
import type { Config } from "./types.js"

const INDEX_CONTENT_POLICY_VERSION = 2
const CHUNKING_ADAPTER_VERSION = 4

export function indexPolicyFingerprint(config: Config): string {
  const policy = {
    version: INDEX_CONTENT_POLICY_VERSION,
    embedding: {
      adapterVersion: 1,
      provider: config.embeddingProvider,
      model: config.embeddingModel,
      revision: config.embeddingModelRevision,
      digest: config.embeddingModelDigest,
    },
    chunking: {
      adapterVersion: CHUNKING_ADAPTER_VERSION,
      size: config.chunkSize,
      overlap: config.chunkOverlap,
    },
    extraction: {
      parserVersion: 3,
      pdfOcrCommand: config.pdfOcrCommand,
      pdfOcrParserPolicy: config.pdfOcrCommand.length > 0 ? PDF_OCR_PARSER_POLICY : null,
      imageOcrCommand: config.imageOcrCommand,
      legacyWordCommand: config.legacyWordCommand,
    },
  }

  return createHash("sha256").update(JSON.stringify(policy)).digest("hex")
}
