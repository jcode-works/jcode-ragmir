import { type FileHandle, open } from "node:fs/promises"
import path from "node:path"
import { loadConfig } from "./config.js"
import { doctorWithConfig } from "./doctor.js"
import { MARKDOWN_EXTENSIONS, markdownFrontmatter } from "./document-structure.js"
import { RagmirError } from "./errors.js"
import { checkIndexFreshness } from "./freshness.js"
import { knowledgeBaseIdentity, knowledgeBaseProfile } from "./knowledge-bases.js"
import { operationSignal, throwIfAborted } from "./operation.js"
import { pathMatchesFilter } from "./path-globs.js"
import { documentOutlineWithConfig } from "./query.js"
import { canonicalUserPath } from "./source-paths.js"
import {
  readIndexManifest,
  readIndexManifestFilePage,
  readIndexManifestHeader,
  readPreviousIndexFiles,
} from "./store.js"
import type {
  Config,
  IndexManifestFile,
  KnowledgeBaseContextReport,
  KnowledgeBaseSourceCatalog,
  KnowledgeBaseSourceCatalogOptions,
  OperationOptions,
  SourceChanges,
} from "./types.js"

const SOURCE_CATALOG_LIMIT = 50
// Front matter opens a page and stays short: the head of the file holds it.
const FRONTMATTER_HEAD_BYTES = 16_384
export const MAX_SOURCE_CATALOG_LIMIT = 100
const RAGMIR_MCP_TOOLS = [
  "ragmir_status",
  "ragmir_search",
  "ragmir_expand",
  "ragmir_sources",
  "ragmir_audit",
  "ragmir_ingest",
]
const RAGMIR_MCP_RESOURCES = ["ragmir://context", "ragmir://sources"]

export async function getKnowledgeBaseContext(
  cwd = process.cwd(),
  options: OperationOptions = {},
): Promise<KnowledgeBaseContextReport> {
  const signal = operationSignal(options)
  throwIfAborted(signal)
  const config = await loadConfig(cwd)
  return getKnowledgeBaseContextWithConfig(config, options)
}

export async function getKnowledgeBaseContextWithConfig(
  config: Config,
  options: OperationOptions = {},
): Promise<KnowledgeBaseContextReport> {
  const signal = operationSignal(options)
  throwIfAborted(signal)
  const report = await doctorWithConfig(config, signal ? { signal } : {})
  throwIfAborted(signal)
  const identity = knowledgeBaseIdentity(config.projectRoot)
  const profile = knowledgeBaseProfile(config)

  return {
    knowledgeBaseId: identity?.id ?? null,
    knowledgeBase: { name: profile.name, description: profile.description },
    scopes: profile.scopes,
    pathContexts: profile.pathContexts,
    projectRoot: config.projectRoot,
    retrievalProfile: config.retrievalProfile,
    embeddingProvider: config.embeddingProvider,
    corpusFingerprint: report.corpusFingerprint,
    ready: report.ready,
    coverage: {
      verified: report.sourceFreshness?.verified === true || report.inventoryVerified,
      checkedAt: report.sourceFreshness?.checkedAt ?? null,
      supportedFiles: report.supportedFiles,
      indexedFiles: report.indexedFiles,
      chunksIndexed: report.chunksIndexed,
      missingFromIndex: report.missingFromIndex,
      staleInIndex: report.staleInIndex,
      emptyTextFiles: report.emptyTextFiles,
    },
    indexFreshness: report.indexFreshness,
    securityWarningCount: report.securityWarnings.length,
    nextSteps: report.nextSteps,
    routing: {
      selection: "nearest-configured-ancestor",
      discoverCommand: "rgr bases --json",
    },
    tools: [...RAGMIR_MCP_TOOLS],
    resources: [...RAGMIR_MCP_RESOURCES],
  }
}

export async function getKnowledgeBaseSourceCatalog(
  cwd = process.cwd(),
  options: KnowledgeBaseSourceCatalogOptions = {},
): Promise<KnowledgeBaseSourceCatalog> {
  const signal = operationSignal(options)
  throwIfAborted(signal)
  const config = await loadConfig(cwd)
  return getKnowledgeBaseSourceCatalogWithConfig(config, options)
}

export async function getKnowledgeBaseSourceCatalogWithConfig(
  config: Config,
  options: KnowledgeBaseSourceCatalogOptions = {},
): Promise<KnowledgeBaseSourceCatalog> {
  const signal = operationSignal(options)
  throwIfAborted(signal)
  const offset = sourceCatalogOffset(options.offset)
  const limit = sourceCatalogLimit(options.limit)
  const filters = [...new Set((options.paths ?? []).map(canonicalUserPath).filter(Boolean))]
  const [manifest, filePage, freshness] = await Promise.all([
    readIndexManifestHeader(config),
    filters.length > 0
      ? filteredFilePage(config, filters, offset, limit)
      : readIndexManifestFilePage(config, offset, limit),
    checkIndexFreshness(config, { ...(signal ? { signal } : {}), previewLimit: limit }),
  ])
  throwIfAborted(signal)
  const identity = knowledgeBaseIdentity(config.projectRoot)
  const health = manifest?.health
  const live = freshness.verified ? freshness : null
  const indexedFiles = await Promise.all(
    (filePage?.files ?? []).map(async (file) => ({
      source: file.relativePath,
      chunks: file.chunkCount,
      ...(await pageHeadline(config.projectRoot, file.relativePath)),
    })),
  )
  const listedTotal = filePage && "matched" in filePage ? filePage.matched : manifest?.fileCount
  const missingFromIndex = (
    live?.previews.missingFromIndex ??
    health?.previews.missingFromIndex ??
    []
  ).slice(0, limit)
  const staleInIndex = (live?.previews.staleInIndex ?? health?.previews.staleInIndex ?? []).slice(
    0,
    limit,
  )
  const emptyTextFiles = health?.previews.emptyTextFiles.slice(0, limit) ?? []

  return {
    knowledgeBaseId: identity?.id ?? null,
    coverageVerified: live !== null,
    totals: {
      indexedFiles: manifest?.fileCount ?? 0,
      chunks: manifest?.chunkCount ?? 0,
      missingFromIndex: live?.missingFromIndex ?? health?.missingFromIndex ?? 0,
      staleInIndex: live?.staleInIndex ?? health?.staleInIndex ?? 0,
      emptyTextFiles: health?.emptyTextFiles ?? 0,
      skippedFiles: health?.skippedFiles ?? 0,
    },
    indexedFiles,
    missingFromIndex,
    staleInIndex,
    emptyTextFiles,
    skippedByReason: health?.skippedByReason ?? {},
    omitted: {
      indexedFiles: Math.max(0, (listedTotal ?? 0) - indexedFiles.length),
      missingFromIndex: Math.max(
        0,
        (live?.missingFromIndex ?? health?.missingFromIndex ?? 0) - missingFromIndex.length,
      ),
      staleInIndex: Math.max(
        0,
        (live?.staleInIndex ?? health?.staleInIndex ?? 0) - staleInIndex.length,
      ),
      emptyTextFiles: Math.max(0, (health?.emptyTextFiles ?? 0) - emptyTextFiles.length),
    },
    page: {
      offset,
      limit,
      nextOffset: filePage?.nextOffset ?? null,
    },
    ...(filters.length > 0 ? { filter: { paths: filters, matchedFiles: listedTotal ?? 0 } } : {}),
    ...(options.outline && indexedFiles.length === 1 && indexedFiles[0]
      ? { outline: await documentOutlineWithConfig(config, indexedFiles[0].source, options) }
      : {}),
    ...(options.changedSince === undefined
      ? {}
      : { changes: await sourceChanges(config, options.changedSince, limit) }),
  }
}

async function sourceChanges(
  config: Config,
  changedSince: string,
  limit: number,
): Promise<SourceChanges> {
  const since = Date.parse(changedSince)
  if (!Number.isFinite(since)) {
    throw new RagmirError(
      "INVALID_ARGUMENT",
      "changedSince must be an ISO 8601 date or time, such as 2026-11-20 or 2026-11-20T09:30:00Z.",
    )
  }
  const [manifest, previous] = await Promise.all([
    readIndexManifest(config),
    readPreviousIndexFiles(config),
  ])
  const current = manifest?.indexedFiles ?? []
  const currentPaths = new Set(current.map((file) => file.relativePath))
  const modified = current
    .filter((file) => (file.mtimeMs ?? 0) > since)
    .map((file) => file.relativePath)
  // The last ingest dropped the files it no longer found; earlier removals are not kept.
  const removed =
    previous && manifest && Date.parse(manifest.createdAt) > since
      ? previous.files.map((file) => file.relativePath).filter((path) => !currentPaths.has(path))
      : []
  return {
    since: new Date(since).toISOString(),
    modified: { count: modified.length, items: modified.slice(0, limit) },
    removed: { count: removed.length, items: removed.slice(0, limit) },
    complete: previous !== null && Date.parse(previous.createdAt) >= since,
  }
}

/**
 * The title and description a Markdown page declares in its front matter, read from the head of the
 * file: the catalog an agent browses names each page, as the index page of a wiki does.
 */
async function pageHeadline(
  projectRoot: string,
  relativePath: string,
): Promise<{ title?: string; description?: string }> {
  if (!MARKDOWN_EXTENSIONS.has(path.posix.extname(relativePath).toLowerCase())) {
    return {}
  }
  let handle: FileHandle | undefined
  try {
    handle = await open(path.join(projectRoot, relativePath), "r")
    const head = Buffer.alloc(FRONTMATTER_HEAD_BYTES)
    const { bytesRead } = await handle.read(head, 0, head.length, 0)
    const frontmatter = markdownFrontmatter(head.subarray(0, bytesRead).toString("utf8"))
    return {
      ...(frontmatter?.title === undefined ? {} : { title: frontmatter.title }),
      ...(frontmatter?.description === undefined ? {} : { description: frontmatter.description }),
    }
  } catch {
    // A page that moved or became unreadable since indexing is listed without a headline.
    return {}
  } finally {
    await handle?.close()
  }
}

/** One page of the indexed files under the given folders or matching the given globs. */
async function filteredFilePage(
  config: Config,
  filters: readonly string[],
  offset: number,
  limit: number,
): Promise<{ files: IndexManifestFile[]; matched: number; nextOffset: number | null } | null> {
  const manifest = await readIndexManifest(config)
  if (!manifest) {
    return null
  }
  const matching = (manifest.indexedFiles ?? []).filter((file) =>
    filters.some((filter) => pathMatchesFilter(file.relativePath, filter)),
  )
  const files = matching.slice(offset, offset + limit)
  return {
    files,
    matched: matching.length,
    nextOffset: offset + files.length < matching.length ? offset + files.length : null,
  }
}

function sourceCatalogOffset(value: number | undefined): number {
  const offset = value ?? 0
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new Error("Source catalog offset must be a non-negative integer.")
  }
  return offset
}

function sourceCatalogLimit(value: number | undefined): number {
  const limit = value ?? SOURCE_CATALOG_LIMIT
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > MAX_SOURCE_CATALOG_LIMIT) {
    throw new Error(
      `Source catalog limit must be a positive integer no greater than ${MAX_SOURCE_CATALOG_LIMIT}.`,
    )
  }
  return limit
}
