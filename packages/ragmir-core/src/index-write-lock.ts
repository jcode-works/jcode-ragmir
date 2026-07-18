import { randomUUID } from "node:crypto"
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises"
import { hostname } from "node:os"
import path from "node:path"
import { RagmirError } from "./errors.js"
import { isRecord } from "./guards.js"
import { throwIfAborted } from "./operation.js"
import { ensurePrivateDirectory, hardenPrivateFile } from "./permissions.js"

export const INDEX_WRITE_LOCK_DIRECTORY = ".writer-lock"
const RECOVERY_LOCK_DIRECTORY = ".writer-lock-recovery"
const OWNER_FILENAME = "owner.json"
const DEFAULT_WAIT_TIMEOUT_MS = 30_000
const DEFAULT_POLL_INTERVAL_MS = 50
const DEFAULT_HEARTBEAT_INTERVAL_MS = 1_000
const INCOMPLETE_LOCK_STALE_MS = 30_000

const writeQueues = new Map<string, Promise<void>>()
const activeLeaseReleases = new Set<() => Promise<void>>()
const signalHandlers = new Map<NodeJS.Signals, () => void>()

export interface IndexWriteLockOwner {
  pid: number
  hostname: string
  runId: string
  ownerToken: string
  startedAt: string
  heartbeatAt: string
}

export interface IndexWriteLockOptions {
  waitTimeoutMs?: number
  pollIntervalMs?: number
  heartbeatIntervalMs?: number
}

interface IndexWriteLockLease {
  owner: IndexWriteLockOwner
  release: () => Promise<void>
}

export async function withIndexWriteLock<T>(
  storageDir: string,
  signal: AbortSignal | undefined,
  operation: (owner: IndexWriteLockOwner) => Promise<T>,
  options: IndexWriteLockOptions = {},
): Promise<T> {
  const lockOptions = normalizedLockOptions(options)
  const deadline = Date.now() + lockOptions.waitTimeoutMs
  const key = path.resolve(storageDir)
  const previous = writeQueues.get(key) ?? Promise.resolve()
  let releaseQueue: (() => void) | undefined
  const current = new Promise<void>((resolve) => {
    releaseQueue = resolve
  })
  const tail = previous.then(
    () => current,
    () => current,
  )
  writeQueues.set(key, tail)
  void tail.then(() => {
    if (writeQueues.get(key) === tail) {
      writeQueues.delete(key)
    }
  })

  let lease: IndexWriteLockLease | undefined
  try {
    await waitForTurn(previous, signal, deadline, key)
    throwIfAborted(signal)
    lease = await acquireInterprocessLock(key, signal, deadline, lockOptions)
    return await operation(lease.owner)
  } finally {
    try {
      await lease?.release()
    } finally {
      releaseQueue?.()
    }
  }
}

export async function readIndexWriteLockOwner(
  storageDir: string,
): Promise<IndexWriteLockOwner | null> {
  return readOwner(lockDirectory(storageDir))
}

async function acquireInterprocessLock(
  storageDir: string,
  signal: AbortSignal | undefined,
  deadline: number,
  options: Required<IndexWriteLockOptions>,
): Promise<IndexWriteLockLease> {
  await ensurePrivateDirectory(storageDir)
  const lockPath = lockDirectory(storageDir)

  while (true) {
    throwIfAborted(signal)
    if (!(await pathExists(recoveryLockDirectory(storageDir)))) {
      const lease = await tryCreateLease(lockPath, options.heartbeatIntervalMs)
      if (lease) {
        return lease
      }
    } else {
      await recoverAbandonedRecoveryLock(storageDir)
    }

    const owner = await readOwner(lockPath)
    if (await recoverAbandonedWriterLock(storageDir, owner)) {
      continue
    }
    if (Date.now() >= deadline) {
      throw indexBusyError(storageDir, owner)
    }
    await waitForDelay(Math.min(options.pollIntervalMs, Math.max(1, deadline - Date.now())), signal)
  }
}

async function tryCreateLease(
  lockPath: string,
  heartbeatIntervalMs: number,
): Promise<IndexWriteLockLease | null> {
  try {
    await mkdir(lockPath, { mode: 0o700 })
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      return null
    }
    throw error
  }

  const now = new Date().toISOString()
  const owner: IndexWriteLockOwner = {
    pid: process.pid,
    hostname: hostname(),
    runId: randomUUID(),
    ownerToken: randomUUID(),
    startedAt: now,
    heartbeatAt: now,
  }
  try {
    await writeOwner(lockPath, owner)
    return createLease(lockPath, owner, heartbeatIntervalMs)
  } catch (error) {
    await rm(lockPath, { recursive: true, force: true })
    throw error
  }
}

function createLease(
  lockPath: string,
  owner: IndexWriteLockOwner,
  heartbeatIntervalMs: number,
): IndexWriteLockLease {
  let released = false
  let heartbeat = Promise.resolve()
  const interval = setInterval(() => {
    heartbeat = heartbeat
      .catch(() => undefined)
      .then(async () => {
        const current = await readOwner(lockPath)
        if (current?.ownerToken !== owner.ownerToken) {
          return
        }
        await writeOwner(lockPath, {
          ...owner,
          heartbeatAt: new Date().toISOString(),
        })
      })
    heartbeat.catch(() => undefined)
  }, heartbeatIntervalMs)
  interval.unref()

  let unregisterSignalCleanup = (): void => undefined
  const release = async (): Promise<void> => {
    if (released) {
      return
    }
    released = true
    clearInterval(interval)
    try {
      await heartbeat.catch(() => undefined)
      const current = await readOwner(lockPath)
      if (current?.ownerToken === owner.ownerToken) {
        await rm(lockPath, { recursive: true, force: true })
      }
    } finally {
      unregisterSignalCleanup()
    }
  }
  unregisterSignalCleanup = registerSignalCleanup(release)
  return { owner, release }
}

async function recoverAbandonedWriterLock(
  storageDir: string,
  observedOwner: IndexWriteLockOwner | null,
): Promise<boolean> {
  const lockPath = lockDirectory(storageDir)
  if (!(await lockIsRecoverable(lockPath, observedOwner))) {
    return false
  }

  const recoveryPath = recoveryLockDirectory(storageDir)
  const recoveryOwner = await tryCreateRecoveryLock(recoveryPath)
  if (!recoveryOwner) {
    return false
  }
  try {
    const currentOwner = await readOwner(lockPath)
    if (!(await lockIsRecoverable(lockPath, currentOwner))) {
      return false
    }
    if (
      observedOwner !== null &&
      currentOwner !== null &&
      observedOwner.ownerToken !== currentOwner.ownerToken
    ) {
      return false
    }
    await rm(lockPath, { recursive: true, force: true })
    return true
  } finally {
    await removeOwnedDirectory(recoveryPath, recoveryOwner.ownerToken)
  }
}

async function recoverAbandonedRecoveryLock(storageDir: string): Promise<void> {
  const recoveryPath = recoveryLockDirectory(storageDir)
  const owner = await readOwner(recoveryPath)
  if (await lockIsRecoverable(recoveryPath, owner)) {
    await removeOwnedDirectory(recoveryPath, owner?.ownerToken)
  }
}

async function tryCreateRecoveryLock(recoveryPath: string): Promise<IndexWriteLockOwner | null> {
  try {
    await mkdir(recoveryPath, { mode: 0o700 })
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      return null
    }
    throw error
  }
  const now = new Date().toISOString()
  const owner: IndexWriteLockOwner = {
    pid: process.pid,
    hostname: hostname(),
    runId: randomUUID(),
    ownerToken: randomUUID(),
    startedAt: now,
    heartbeatAt: now,
  }
  try {
    await writeOwner(recoveryPath, owner)
    return owner
  } catch (error) {
    await rm(recoveryPath, { recursive: true, force: true })
    throw error
  }
}

async function lockIsRecoverable(
  directory: string,
  owner: IndexWriteLockOwner | null,
): Promise<boolean> {
  if (owner) {
    return !ownerProcessIsAlive(owner)
  }
  try {
    const metadata = await stat(directory)
    return Date.now() - metadata.mtimeMs >= INCOMPLETE_LOCK_STALE_MS
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false
    }
    throw error
  }
}

function ownerProcessIsAlive(owner: IndexWriteLockOwner): boolean {
  if (owner.hostname !== hostname()) {
    return true
  }
  try {
    process.kill(owner.pid, 0)
    return true
  } catch (error) {
    if (isNodeError(error) && error.code === "ESRCH") {
      return false
    }
    return true
  }
}

async function removeOwnedDirectory(directory: string, ownerToken?: string): Promise<void> {
  const current = await readOwner(directory)
  if (ownerToken === undefined || current?.ownerToken === ownerToken) {
    await rm(directory, { recursive: true, force: true })
  }
}

async function writeOwner(directory: string, owner: IndexWriteLockOwner): Promise<void> {
  const ownerPath = path.join(directory, OWNER_FILENAME)
  const temporaryPath = path.join(directory, `${OWNER_FILENAME}.${owner.ownerToken}.tmp`)
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(temporaryPath, "wx", 0o600)
    await handle.writeFile(`${JSON.stringify(owner, null, 2)}\n`, "utf8")
    await handle.sync()
    await handle.close()
    handle = undefined
    await hardenPrivateFile(temporaryPath)
    await rename(temporaryPath, ownerPath)
  } finally {
    await handle?.close()
    await rm(temporaryPath, { force: true })
  }
}

async function readOwner(directory: string): Promise<IndexWriteLockOwner | null> {
  try {
    const value = JSON.parse(
      await readFile(path.join(directory, OWNER_FILENAME), "utf8"),
    ) as unknown
    return isIndexWriteLockOwner(value) ? value : null
  } catch (error) {
    if (
      error instanceof SyntaxError ||
      (isNodeError(error) && (error.code === "ENOENT" || error.code === "ENOTDIR"))
    ) {
      return null
    }
    throw error
  }
}

function isIndexWriteLockOwner(value: unknown): value is IndexWriteLockOwner {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.pid) &&
    typeof value.pid === "number" &&
    value.pid > 0 &&
    typeof value.hostname === "string" &&
    value.hostname.length > 0 &&
    typeof value.runId === "string" &&
    value.runId.length > 0 &&
    typeof value.ownerToken === "string" &&
    value.ownerToken.length > 0 &&
    isIsoTimestamp(value.startedAt) &&
    isIsoTimestamp(value.heartbeatAt)
  )
}

async function waitForTurn(
  previous: Promise<void>,
  signal: AbortSignal | undefined,
  deadline: number,
  storageDir: string,
): Promise<void> {
  throwIfAborted(signal)
  const remaining = deadline - Date.now()
  if (remaining <= 0) {
    throw indexBusyError(storageDir, await readIndexWriteLockOwner(storageDir))
  }

  let timeout: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const timedOut = new Promise<"timeout">((resolve) => {
    timeout = setTimeout(() => resolve("timeout"), remaining)
  })
  const aborted = new Promise<"aborted">((resolve) => {
    if (!signal) {
      return
    }
    onAbort = () => resolve("aborted")
    signal.addEventListener("abort", onAbort, { once: true })
  })
  try {
    const result = await Promise.race([previous.then(() => "ready" as const), timedOut, aborted])
    throwIfAborted(signal)
    if (result === "timeout") {
      throw indexBusyError(storageDir, await readIndexWriteLockOwner(storageDir))
    }
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
    if (signal && onAbort) {
      signal.removeEventListener("abort", onAbort)
    }
  }
}

async function waitForDelay(delayMs: number, signal: AbortSignal | undefined): Promise<void> {
  throwIfAborted(signal)
  let timeout: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  await new Promise<void>((resolve) => {
    timeout = setTimeout(resolve, delayMs)
    if (signal) {
      onAbort = resolve
      signal.addEventListener("abort", onAbort, { once: true })
    }
  })
  if (timeout) {
    clearTimeout(timeout)
  }
  if (signal && onAbort) {
    signal.removeEventListener("abort", onAbort)
  }
  throwIfAborted(signal)
}

function indexBusyError(storageDir: string, owner: IndexWriteLockOwner | null): RagmirError {
  const detail = owner
    ? ` Owner pid=${owner.pid}, runId=${owner.runId}, startedAt=${owner.startedAt}, heartbeatAt=${owner.heartbeatAt}.`
    : " Owner metadata is not available."
  return new RagmirError(
    "INDEX_BUSY",
    `The Ragmir index at ${JSON.stringify(storageDir)} is busy.${detail}`,
    { retryable: true },
  )
}

function normalizedLockOptions(options: IndexWriteLockOptions): Required<IndexWriteLockOptions> {
  return {
    waitTimeoutMs: positiveIntegerOption(
      options.waitTimeoutMs,
      DEFAULT_WAIT_TIMEOUT_MS,
      "waitTimeoutMs",
    ),
    pollIntervalMs: positiveIntegerOption(
      options.pollIntervalMs,
      DEFAULT_POLL_INTERVAL_MS,
      "pollIntervalMs",
    ),
    heartbeatIntervalMs: positiveIntegerOption(
      options.heartbeatIntervalMs,
      DEFAULT_HEARTBEAT_INTERVAL_MS,
      "heartbeatIntervalMs",
    ),
  }
}

function positiveIntegerOption(value: number | undefined, fallback: number, name: string): number {
  const selected = value ?? fallback
  if (!Number.isSafeInteger(selected) || selected <= 0) {
    throw new RagmirError("INVALID_ARGUMENT", `${name} must be a positive integer.`)
  }
  return selected
}

function registerSignalCleanup(release: () => Promise<void>): () => void {
  activeLeaseReleases.add(release)
  installSignalHandlers()
  return () => {
    activeLeaseReleases.delete(release)
    if (activeLeaseReleases.size === 0) {
      removeSignalHandlers()
    }
  }
}

function installSignalHandlers(): void {
  if (signalHandlers.size > 0) {
    return
  }
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    const handler = (): void => {
      if (process.listenerCount(signal) !== 1) {
        return
      }
      const releases = [...activeLeaseReleases]
      void Promise.allSettled(releases.map((release) => release())).then(() => {
        removeSignalHandlers()
        process.kill(process.pid, signal)
      })
    }
    signalHandlers.set(signal, handler)
    process.on(signal, handler)
  }
}

function removeSignalHandlers(): void {
  for (const [signal, handler] of signalHandlers) {
    process.off(signal, handler)
  }
  signalHandlers.clear()
}

function lockDirectory(storageDir: string): string {
  return path.join(storageDir, INDEX_WRITE_LOCK_DIRECTORY)
}

function recoveryLockDirectory(storageDir: string): string {
  return path.join(storageDir, RECOVERY_LOCK_DIRECTORY)
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath)
    return true
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false
    }
    throw error
  }
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") {
    return false
  }
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}
