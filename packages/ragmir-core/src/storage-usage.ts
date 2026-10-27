import { lstat, readdir, rm } from "node:fs/promises"
import path from "node:path"
import { RAGMIR_DIR } from "./defaults.js"
import type { Config } from "./types.js"

export type StorageOrphanKind = "model" | "storage-copy" | "retired-output"

export interface StorageOrphan {
  path: string
  kind: StorageOrphanKind
  diskBytes: number
  reason: string
}

const MODEL_ARCHIVE_EXTENSIONS = new Set([".gguf", ".ggml", ".bin", ".safetensors"])
// Outputs of commands removed with the focused-retrieval release (chat, audio, reports).
const RETIRED_OUTPUT_DIRECTORIES = ["audio", "chat", "reports"]

/**
 * Bytes a directory occupies on disk, counting allocated blocks rather than logical sizes: LanceDB
 * keeps every old version and index file, so a table can occupy many times its logical size.
 */
export async function diskUsage(target: string): Promise<number> {
  let info: Awaited<ReturnType<typeof lstat>>
  try {
    info = await lstat(target)
  } catch {
    return 0
  }
  const own = allocatedBytes(info)
  if (!info.isDirectory()) {
    return own
  }
  const entries = await readdir(target).catch(() => [])
  const children = await Promise.all(entries.map((entry) => diskUsage(path.join(target, entry))))
  return own + children.reduce((sum, bytes) => sum + bytes, 0)
}

function allocatedBytes(info: { blocks: number; size: number }): number {
  // Windows reports no block count; the logical size is the best available measure there.
  return Number.isFinite(info.blocks) && info.blocks > 0 ? info.blocks * 512 : info.size
}

/**
 * Files under `.ragmir/` that no current feature reads: models other than the configured embedding
 * model (including chat models from retired packages), copies of the storage directory, and
 * outputs of retired commands. Listed for review; removed only on explicit request.
 */
export async function findStorageOrphans(config: Config): Promise<StorageOrphan[]> {
  const ragmirDir = path.join(config.projectRoot, RAGMIR_DIR)
  const orphans: StorageOrphan[] = []
  const configuredModel = path.join(config.embeddingModelPath, ...config.embeddingModel.split("/"))
  if (isInside(config.embeddingModelPath, ragmirDir)) {
    for (const candidate of await modelDirectories(config.embeddingModelPath)) {
      if (path.resolve(candidate) === path.resolve(configuredModel)) {
        continue
      }
      orphans.push({
        path: candidate,
        kind: "model",
        diskBytes: await diskUsage(candidate),
        reason:
          path.basename(path.dirname(candidate)) === "chat" ||
          MODEL_ARCHIVE_EXTENSIONS.has(path.extname(candidate).toLowerCase())
            ? "Chat model from a retired Ragmir package; no installed package loads it."
            : `Embedding model other than the configured ${config.embeddingModel}.`,
      })
    }
  }
  const storageName = path.basename(config.storageDir)
  for (const entry of await readdir(ragmirDir).catch(() => [])) {
    const candidate = path.join(ragmirDir, entry)
    if (
      entry !== storageName &&
      /^storage[-._]/u.test(entry) &&
      path.resolve(candidate) !== path.resolve(config.storageDir)
    ) {
      orphans.push({
        path: candidate,
        kind: "storage-copy",
        diskBytes: await diskUsage(candidate),
        reason: "Storage copy that the active configuration does not use.",
      })
    } else if (RETIRED_OUTPUT_DIRECTORIES.includes(entry)) {
      orphans.push({
        path: candidate,
        kind: "retired-output",
        diskBytes: await diskUsage(candidate),
        reason: "Output folder of a command removed from Ragmir (chat, audio, or reports).",
      })
    }
  }
  return orphans.sort((left, right) => right.diskBytes - left.diskBytes)
}

export async function removeStorageOrphans(orphans: readonly StorageOrphan[]): Promise<string[]> {
  const removed: string[] = []
  for (const orphan of orphans) {
    await rm(orphan.path, { recursive: true, force: true })
    removed.push(orphan.path)
  }
  return removed
}

/**
 * Model folders two levels deep (`<organization>/<model>`), plus single model files such as GGUF
 * chat models at either level.
 */
async function modelDirectories(modelRoot: string): Promise<string[]> {
  const found: string[] = []
  for (const organization of await readdir(modelRoot, { withFileTypes: true }).catch(() => [])) {
    if (organization.name.startsWith(".")) {
      continue
    }
    const organizationPath = path.join(modelRoot, organization.name)
    if (!organization.isDirectory()) {
      if (MODEL_ARCHIVE_EXTENSIONS.has(path.extname(organization.name).toLowerCase())) {
        found.push(organizationPath)
      }
      continue
    }
    for (const model of await readdir(organizationPath, { withFileTypes: true }).catch(() => [])) {
      if (
        model.isDirectory() ||
        MODEL_ARCHIVE_EXTENSIONS.has(path.extname(model.name).toLowerCase())
      ) {
        found.push(path.join(organizationPath, model.name))
      }
    }
  }
  return found
}

function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child)
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}
