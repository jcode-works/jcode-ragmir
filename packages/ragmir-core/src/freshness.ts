import { discoverSourceFiles } from "./files.js"
import { operationSignal, throwIfAborted } from "./operation.js"
import {
  readSourceFingerprintCache,
  reusableSourceFingerprint,
} from "./source-fingerprint-cache.js"
import { readEmptyTextFiles, readIndexManifest } from "./store.js"
import type { Config, IndexFreshnessReport, IndexManifest, OperationOptions } from "./types.js"

const DEFAULT_FRESHNESS_TIMEOUT_MS = 5_000
const DEFAULT_PREVIEW_LIMIT = 20

export interface IndexFreshnessOptions extends OperationOptions {
  /** A manifest already read with its file list, to avoid reading it twice. */
  manifest?: IndexManifest | null
  previewLimit?: number
  /** Time budget for discovery; the report is then marked unverified instead of guessing. */
  budgetMs?: number
}

/**
 * Compare the files on disk with the index manifest by path, size, and modification time, without
 * reading content: O(files) instead of the O(corpus) checksum audit. A file whose content is known
 * unchanged from the fingerprint cache is not reported, so a checkout that only touched files
 * stays fresh. Times out into an explicitly unverified report rather than claiming freshness.
 */
export async function checkIndexFreshness(
  config: Config,
  options: IndexFreshnessOptions = {},
): Promise<IndexFreshnessReport> {
  const startedAt = Date.now()
  const checkedAt = new Date(startedAt).toISOString()
  const timeout = AbortSignal.timeout(options.budgetMs ?? DEFAULT_FRESHNESS_TIMEOUT_MS)
  const callerSignal = operationSignal(options)
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout
  const previewLimit = Math.max(0, options.previewLimit ?? DEFAULT_PREVIEW_LIMIT)
  try {
    const manifest =
      options.manifest !== undefined ? options.manifest : await readIndexManifest(config)
    if (!manifest?.indexedFiles) {
      return unverifiedReport(
        checkedAt,
        startedAt,
        "No index manifest with a file list exists yet.",
      )
    }
    const [discovery, emptyTextFiles, fingerprints] = await Promise.all([
      discoverSourceFiles(config, { signal }),
      readEmptyTextFiles(config),
      config.sourceFingerprintMode === "strict" ? null : readSourceFingerprintCache(config),
    ])
    throwIfAborted(signal)
    const indexed = new Map(manifest.indexedFiles.map((file) => [file.relativePath, file]))
    const empty = new Map(emptyTextFiles.map((file) => [file.relativePath, file]))
    const missing: string[] = []
    const modified: string[] = []
    const onDisk = new Set<string>()
    for (const file of discovery.files) {
      onDisk.add(file.relativePath)
      const record = indexed.get(file.relativePath) ?? empty.get(file.relativePath)
      if (!record) {
        missing.push(file.relativePath)
        continue
      }
      const sameStat =
        (record.bytes === undefined || record.bytes === file.bytes) &&
        (record.mtimeMs === undefined || record.mtimeMs === file.mtimeMs)
      if (sameStat) {
        continue
      }
      const cached = reusableSourceFingerprint(
        fingerprints?.get(file.absolutePath),
        file.identity,
        config.sourceFingerprintMode,
      )
      if (cached?.checksum !== record.checksum) {
        modified.push(file.relativePath)
      }
    }
    const removed = [...indexed.keys()].filter((relativePath) => !onDisk.has(relativePath))
    const stale = [...modified, ...removed].sort()
    return {
      method: "stat",
      verified: true,
      checkedAt,
      durationMs: Date.now() - startedAt,
      missingFromIndex: missing.length,
      staleInIndex: stale.length,
      modifiedFiles: modified.length,
      removedFiles: removed.length,
      noncanonicalPaths: [...indexed.keys()].filter(
        (relativePath) => relativePath !== relativePath.normalize("NFC"),
      ).length,
      previews: {
        missingFromIndex: missing.slice(0, previewLimit),
        staleInIndex: stale.slice(0, previewLimit),
      },
      error: null,
    }
  } catch (error) {
    if (callerSignal?.aborted) {
      throw error
    }
    const reason = timeout.aborted
      ? "The freshness check timed out; run `rgr audit` for a complete comparison."
      : `The freshness check failed (${error instanceof Error ? error.message : String(error)}).`
    return unverifiedReport(checkedAt, startedAt, reason)
  }
}

function unverifiedReport(
  checkedAt: string,
  startedAt: number,
  error: string,
): IndexFreshnessReport {
  return {
    method: "stat",
    verified: false,
    checkedAt,
    durationMs: Date.now() - startedAt,
    missingFromIndex: 0,
    staleInIndex: 0,
    modifiedFiles: 0,
    removedFiles: 0,
    noncanonicalPaths: 0,
    previews: { missingFromIndex: [], staleInIndex: [] },
    error,
  }
}
