import { createHash } from "node:crypto"
import type { Config } from "./types.js"

const INDEX_CONTENT_POLICY_VERSION = 1
const CHUNKING_ADAPTER_VERSION = 3

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
    redaction: config.redaction,
    extraction: {
      parserVersion: 2,
      pdfOcrCommand: config.pdfOcrCommand,
      imageOcrCommand: config.imageOcrCommand,
      legacyWordCommand: config.legacyWordCommand,
    },
  }

  return createHash("sha256").update(JSON.stringify(policy)).digest("hex")
}
