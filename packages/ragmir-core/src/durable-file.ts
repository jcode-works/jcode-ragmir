import { AsyncLocalStorage } from "node:async_hooks"
import { randomUUID } from "node:crypto"
import type { FileHandle } from "node:fs/promises"
import { open, rename, rm } from "node:fs/promises"
import { ensurePrivateDirectory, hardenPrivateFile } from "./permissions.js"

export type DurableWritePhase = "before-write" | "before-sync" | "before-rename" | "after-rename"

export interface DurableWritePhaseEvent {
  targetPath: string
  temporaryPath: string
  phase: DurableWritePhase
}

type DurableWriteFaultInjector = (event: DurableWritePhaseEvent) => void | Promise<void>

const durableWriteFault = new AsyncLocalStorage<DurableWriteFaultInjector>()

export function withDurableWriteFaultForTests<T>(
  injector: DurableWriteFaultInjector,
  operation: () => Promise<T>,
): Promise<T> {
  return durableWriteFault.run(injector, operation)
}

export async function writePrivateFileAtomic(
  targetPath: string,
  directory: string,
  writer: (handle: FileHandle) => Promise<void>,
): Promise<void> {
  await ensurePrivateDirectory(directory)
  const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`
  let handle: FileHandle | undefined
  try {
    await notifyPhase(targetPath, temporaryPath, "before-write")
    handle = await open(temporaryPath, "wx", 0o600)
    await writer(handle)
    await hardenPrivateFile(temporaryPath)
    await notifyPhase(targetPath, temporaryPath, "before-sync")
    await handle.sync()
    await handle.close()
    handle = undefined
    await notifyPhase(targetPath, temporaryPath, "before-rename")
    await rename(temporaryPath, targetPath)
    await syncDirectory(directory)
    await notifyPhase(targetPath, temporaryPath, "after-rename")
  } finally {
    await handle?.close().catch(() => undefined)
    await rm(temporaryPath, { force: true })
  }
}

export async function syncDirectory(directory: string): Promise<void> {
  let handle: FileHandle | undefined
  try {
    handle = await open(directory, "r")
    await handle.sync()
  } catch (error) {
    if (process.platform !== "win32" || !isUnsupportedDirectorySync(error)) {
      throw error
    }
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

async function notifyPhase(
  targetPath: string,
  temporaryPath: string,
  phase: DurableWritePhase,
): Promise<void> {
  await durableWriteFault.getStore()?.({ targetPath, temporaryPath, phase })
}

function isUnsupportedDirectorySync(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) {
    return false
  }
  return ["EACCES", "EBADF", "EINVAL", "EISDIR", "ENOTSUP", "EPERM"].includes(String(error.code))
}
