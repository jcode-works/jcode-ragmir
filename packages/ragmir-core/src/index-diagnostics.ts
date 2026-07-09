import { VECTOR_DISTANCE_METRIC } from "./defaults.js"
import { readIndexManifest } from "./store.js"
import type { Config } from "./types.js"

/**
 * Bumped when the index layout or manifest meaning changes in a way that
 * invalidates previously indexed vectors (new columns, changed semantics, new
 * required metadata). A stored manifest with a lower schemaVersion means the
 * index predates the current code and should be rebuilt.
 */
export const INDEX_SCHEMA_VERSION = 2

/**
 * Detect a stale or incompatible index without re-scanning every source file.
 * Returns a human-readable warning when the stored manifest is missing, was
 * built with a different embedding provider/model, predates the current index
 * schema, or used different chunking settings. Returns `null` when the index is
 * fresh, so callers can treat the warning as purely informational.
 *
 * The hybrid lexical scan limit is also surfaced here so callers know when BM25
 * retrieval is truncating a large corpus and losing recall.
 */
export async function getIndexFreshnessWarning(config: Config): Promise<string | null> {
  const manifest = await readIndexManifest(config)

  if (!manifest) {
    return null
  }

  if (manifest.schemaVersion < INDEX_SCHEMA_VERSION) {
    return `Index schema is outdated (stored v${manifest.schemaVersion}, current v${INDEX_SCHEMA_VERSION}). Rebuild with \`rgr ingest --rebuild\` to use the latest index format.`
  }

  if (manifest.embeddingProvider !== config.embeddingProvider) {
    return `Index was built with embedding provider "${manifest.embeddingProvider}" but the active config uses "${config.embeddingProvider}". Rebuild with \`rgr ingest --rebuild\`.`
  }

  if (manifest.embeddingModel !== config.embeddingModel) {
    return `Index was built with embedding model "${manifest.embeddingModel}" but the active config uses "${config.embeddingModel}". Rebuild with \`rgr ingest --rebuild\` to refresh vectors.`
  }

  if (
    manifest.vectorDistanceMetric !== undefined &&
    manifest.vectorDistanceMetric !== VECTOR_DISTANCE_METRIC
  ) {
    return `Index was built with vector distance metric "${manifest.vectorDistanceMetric}" but the active code uses "${VECTOR_DISTANCE_METRIC}". Rebuild with \`rgr ingest --rebuild\`.`
  }

  if (manifest.chunkSize !== config.chunkSize || manifest.chunkOverlap !== config.chunkOverlap) {
    return `Index was built with chunkSize=${manifest.chunkSize}/chunkOverlap=${manifest.chunkOverlap} but the active config uses chunkSize=${config.chunkSize}/chunkOverlap=${config.chunkOverlap}. Rebuild with \`rgr ingest --rebuild\`.`
  }

  return null
}

/**
 * Warn when the indexed corpus exceeds the hybrid lexical scan limit, because
 * BM25 retrieval then scans only the first N chunks and silently loses recall.
 * Independent of model freshness so callers can surface both diagnostics.
 */
export function getLexicalScanWarning(config: Config, chunkCount: number): string | null {
  if (chunkCount <= config.hybridTextScanLimit) {
    return null
  }
  return `Lexical fallback scans at most ${config.hybridTextScanLimit} of ${chunkCount} chunks when full-text search is unavailable. Raise \`hybridTextScanLimit\` in .ragmir/config.json only if keyword recall is still weak after rebuilding the index.`
}
