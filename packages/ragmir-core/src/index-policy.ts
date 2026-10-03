import { createHash } from "node:crypto"
import { PDF_OCR_PARSER_POLICY } from "./ocr-cache.js"
import type { Config, IndexManifest } from "./types.js"

const INDEX_CONTENT_POLICY_VERSION = 2
const CHUNKING_ADAPTER_VERSION = 4
/**
 * Version of the keyword text derived from each chunk. Searches keep using an index built with an
 * older version, while the next ingestion stages a full rebuild before activating it.
 */
export const LEXICAL_POLICY_VERSION = 2
const LEGACY_LEXICAL_POLICY_VERSION = 1

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

/** Fingerprint that keeps an interrupted ingestion from resuming under a different keyword policy. */
export function ingestionPolicyFingerprint(config: Config): string {
  return createHash("sha256")
    .update(
      JSON.stringify({ index: indexPolicyFingerprint(config), lexical: LEXICAL_POLICY_VERSION }),
    )
    .digest("hex")
}

export function lexicalPolicyCurrent(
  manifest: Pick<IndexManifest, "lexicalPolicyVersion">,
): boolean {
  return (manifest.lexicalPolicyVersion ?? LEGACY_LEXICAL_POLICY_VERSION) === LEXICAL_POLICY_VERSION
}
