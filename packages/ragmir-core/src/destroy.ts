import { existsSync } from "node:fs"
import { realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { recordAccess } from "./access-log.js"
import { loadConfig } from "./config.js"
import { INDEX_MANIFEST_FILENAME } from "./defaults.js"
import { disposeTransformersCache } from "./embeddings.js"
import { readIngestionState } from "./ingestion-state.js"
import type { DestroyIndexResult } from "./types.js"

export async function destroyIndex(cwd = process.cwd()): Promise<DestroyIndexResult> {
  const config = await loadConfig(cwd)
  const existed = existsSync(config.storageDir)
  const hasIngestionState = existed && (await readIngestionState(config)) !== null

  await assertSafeIndexStorage(config.projectRoot, config.storageDir, existed, hasIngestionState)

  await recordAccess(config, { action: "destroy-index" })
  await rm(config.storageDir, { recursive: true, force: true })
  // Release any cached Transformers.js pipelines so a subsequent re-ingest with
  // a different embedding config does not pin stale ONNX weights in memory.
  await disposeTransformersCache()

  return {
    storageDir: config.storageDir,
    removed: existed,
    note: "Generated index removed. For forensic deletion guarantees, keep .ragmir/ on an encrypted volume and rotate/destroy the volume key.",
  }
}

async function assertSafeIndexStorage(
  projectRoot: string,
  storageDir: string,
  existed: boolean,
  hasIngestionState: boolean,
): Promise<void> {
  const resolvedProjectRoot = await realpath(projectRoot)
  const resolvedStorageDir = existed ? await realpath(storageDir) : path.resolve(storageDir)
  const filesystemRoot = path.parse(resolvedStorageDir).root
  const homeDir = await realpath(os.homedir())

  if (
    resolvedStorageDir === filesystemRoot ||
    isSameOrAncestor(resolvedStorageDir, resolvedProjectRoot) ||
    isSameOrAncestor(resolvedStorageDir, homeDir)
  ) {
    throw new Error(
      `Refusing to remove unsafe storageDir ${JSON.stringify(storageDir)}. Configure a dedicated Ragmir index directory.`,
    )
  }

  if (
    existed &&
    !hasIngestionState &&
    !existsSync(path.join(resolvedStorageDir, INDEX_MANIFEST_FILENAME))
  ) {
    throw new Error(
      `Refusing to remove ${JSON.stringify(storageDir)} because it contains neither ${INDEX_MANIFEST_FILENAME} nor a valid ingestion state.`,
    )
  }
}

function isSameOrAncestor(candidate: string, target: string): boolean {
  const relative = path.relative(candidate, target)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}
