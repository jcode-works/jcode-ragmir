import { VECTOR_DISTANCE_METRIC } from "./defaults.js"
import { indexPolicyFingerprint } from "./index-policy.js"
import { indexManifestRecoveryWarning, readIndexManifest } from "./store.js"
import type { Config, IndexConcentration, IndexManifest } from "./types.js"
import { vectorModelFingerprint } from "./vector-index.js"

/**
 * Bumped when the index layout or manifest meaning changes in a way that
 * invalidates previously indexed vectors (new columns, changed semantics, new
 * required metadata). A stored manifest with a lower schemaVersion means the
 * index predates the current code and should be rebuilt.
 */
export const INDEX_SCHEMA_VERSION = 11

/**
 * Detect a stale or incompatible index without re-scanning every source file.
 * Returns a human-readable warning when the stored manifest is missing, was
 * built with a different embedding provider/model, predates the current index
 * schema, or used different chunking settings. Each incompatible state points
 * to the staged upgrade flow. Returns `null` when the index is fresh, so callers
 * can treat the warning as purely informational.
 *
 * The hybrid lexical scan limit is also surfaced here so callers know when BM25
 * retrieval is truncating a large corpus and losing recall.
 */
export async function getIndexFreshnessWarning(config: Config): Promise<string | null> {
  const manifest = await readIndexManifest(config)

  return indexFreshnessWarning(config, manifest)
}

export function indexFreshnessWarning(
  config: Config,
  manifest: IndexManifest | null,
): string | null {
  const recoveryWarning = indexManifestRecoveryWarning(config)
  if (recoveryWarning) {
    return recoveryWarning
  }

  if (!manifest) {
    return null
  }

  if (manifest.schemaVersion !== INDEX_SCHEMA_VERSION) {
    return `Index schema is incompatible (stored v${manifest.schemaVersion}, current v${INDEX_SCHEMA_VERSION}). Run \`rgr upgrade\` to stage and activate the latest index format safely.`
  }

  if (manifest.embeddingProvider !== config.embeddingProvider) {
    return `Index was built with embedding provider "${manifest.embeddingProvider}" but the active config uses "${config.embeddingProvider}". Run \`rgr upgrade\` to rebuild safely.`
  }

  if (manifest.embeddingModel !== config.embeddingModel) {
    return `Index was built with embedding model "${manifest.embeddingModel}" but the active config uses "${config.embeddingModel}". Run \`rgr upgrade\` to refresh vectors safely.`
  }

  if (manifest.embeddingModelRevision !== config.embeddingModelRevision) {
    return `Index was built with embedding revision "${manifest.embeddingModelRevision ?? "unknown"}" but the active config uses "${config.embeddingModelRevision}". Run \`rgr upgrade\` to refresh vectors safely.`
  }

  if (manifest.embeddingModelDigest !== config.embeddingModelDigest) {
    return "Index embedding artifact identity differs from the active config. Run `rgr upgrade` to rebuild safely."
  }

  if (
    manifest.vectorDistanceMetric !== undefined &&
    manifest.vectorDistanceMetric !== VECTOR_DISTANCE_METRIC
  ) {
    return `Index was built with vector distance metric "${manifest.vectorDistanceMetric}" but the active code uses "${VECTOR_DISTANCE_METRIC}". Run \`rgr upgrade\` to rebuild safely.`
  }

  if (manifest.chunkCount > 0 && !manifest.vectorIndex) {
    return "Index vector strategy metadata is missing. Run `rgr upgrade` to rebuild safely."
  }

  if (manifest.vectorIndex) {
    if (
      manifest.vectorDimension === undefined ||
      manifest.vectorIndex.dimension !== manifest.vectorDimension ||
      manifest.vectorIndex.distanceMetric !== VECTOR_DISTANCE_METRIC ||
      manifest.vectorIndex.modelFingerprint !==
        vectorModelFingerprint(config, manifest.vectorIndex.dimension)
    ) {
      return "Index vector strategy is incompatible with the active model, dimension, or metric. Run `rgr upgrade` to rebuild safely."
    }
    if (manifest.vectorIndex.coverage < 1 || manifest.vectorIndex.unindexedRows > 0) {
      return "Active vector index coverage is incomplete. Run `rgr storage optimize` before searching."
    }
  }

  if (manifest.chunkSize !== config.chunkSize || manifest.chunkOverlap !== config.chunkOverlap) {
    return `Index was built with chunkSize=${manifest.chunkSize}/chunkOverlap=${manifest.chunkOverlap} but the active config uses chunkSize=${config.chunkSize}/chunkOverlap=${config.chunkOverlap}. Run \`rgr upgrade\` to rebuild safely.`
  }

  const activeFingerprint = indexPolicyFingerprint(config)
  if (manifest.indexPolicyFingerprint !== activeFingerprint) {
    return "Index content policy differs from the active parsing, chunking, or embedding policy. Run `rgr upgrade` to rebuild safely."
  }

  return null
}

/**
 * Describe the extra fallback work when a complete lexical scan needs multiple batches. A complete
 * full-text index makes the fallback unreachable, so it produces no warning.
 */
export function getLexicalScanWarning(
  config: Config,
  chunkCount: number,
  fullTextIndexComplete = false,
): string | null {
  if (fullTextIndexComplete || chunkCount <= config.hybridTextScanLimit) {
    return null
  }
  const batches = Math.ceil(chunkCount / config.hybridTextScanLimit)
  return `Lexical fallback will scan all ${chunkCount} chunks in ${batches} batches of at most ${config.hybridTextScanLimit} when full-text search is unavailable. Run \`rgr storage optimize\` or rebuild the index to restore the faster full-text path.`
}

/**
 * Readiness from the persisted manifest alone: indexed chunks, a complete last health snapshot, and
 * a compatible index. Security advisories are reported separately and never change readiness.
 */
export function manifestReady(
  manifest: IndexManifest | null,
  freshnessWarning: string | null,
): boolean {
  const health = manifest?.health
  return (
    manifest !== null &&
    health !== undefined &&
    manifest.chunkCount > 0 &&
    health.missingFromIndex === 0 &&
    health.staleInIndex === 0 &&
    health.emptyTextFiles === 0 &&
    health.oversizedFiles === 0 &&
    freshnessWarning === null
  )
}

const CONCENTRATION_TOP_FILES = 5
const LARGEST_FILE_SHARE_WARNING = 0.2
const TOP_THREE_SHARE_WARNING = 0.5

/**
 * Share of the index held by the largest files. Above a fifth for one file, or half for three, a
 * data export or log tends to fill the candidate pools of unrelated questions.
 */
export function indexConcentration(
  files: Iterable<{ relativePath: string; chunkCount: number }>,
): IndexConcentration {
  const sorted = [...files]
    .filter((file) => file.chunkCount > 0)
    .sort((left, right) => right.chunkCount - left.chunkCount)
  const totalChunks = sorted.reduce((sum, file) => sum + file.chunkCount, 0)
  const share = (chunks: number): number =>
    totalChunks === 0 ? 0 : Math.round((chunks / totalChunks) * 1_000) / 1_000
  const topFiles = sorted.slice(0, CONCENTRATION_TOP_FILES).map((file) => ({
    relativePath: file.relativePath,
    chunks: file.chunkCount,
    share: share(file.chunkCount),
  }))
  const top3Share = share(sorted.slice(0, 3).reduce((sum, file) => sum + file.chunkCount, 0))
  const largest = topFiles[0]
  const concentrated =
    sorted.length > 3 &&
    largest !== undefined &&
    (largest.share > LARGEST_FILE_SHARE_WARNING || top3Share > TOP_THREE_SHARE_WARNING)
  return {
    totalChunks,
    topFiles,
    top3Share,
    warning: concentrated
      ? `${Math.min(3, sorted.length)} file(s) hold ${Math.round(top3Share * 100)}% of the index (${topFiles
          .slice(0, 3)
          .map((file) => `${file.relativePath} ${Math.round(file.share * 100)}%`)
          .join(
            ", ",
          )}). Exclude data exports that agents do not need, cap them with maxChunksPerDataFile, or lower their rank with sourceWeights.`
      : null,
  }
}
