import { rename, rm } from "node:fs/promises"

// Antivirus scanners, search indexers, and sync clients briefly open new files on Windows without
// sharing them for deletion. A rename or removal then fails although nothing is wrong, so these
// sharing violations are retried with a short backoff, as npm's graceful-fs does.
const WINDOWS_SHARING_VIOLATION_CODES = new Set(["EACCES", "EBUSY", "EPERM"])
const RENAME_RETRY_DELAYS_MS = [20, 40, 80, 160, 320, 640, 1_000]
const REMOVE_RETRIES = 5
const REMOVE_RETRY_DELAY_MS = 100

export interface RenameRetryOptions {
  platform?: NodeJS.Platform
  delaysMs?: readonly number[]
  renameFile?: (source: string, target: string) => Promise<void>
}

/**
 * Atomic rename that survives the transient sharing violations Windows reports while another
 * process holds the source or the target. Other platforms and other errors fail on the first try.
 */
export async function renameWithRetry(
  source: string,
  target: string,
  options: RenameRetryOptions = {},
): Promise<void> {
  const platform = options.platform ?? process.platform
  const delays = options.delaysMs ?? RENAME_RETRY_DELAYS_MS
  const renameFile = options.renameFile ?? rename
  for (let attempt = 0; ; attempt += 1) {
    try {
      await renameFile(source, target)
      return
    } catch (error) {
      const delay = delays[attempt]
      if (delay === undefined || !isWindowsSharingViolation(error, platform)) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
}

/**
 * Remove a file or directory tree, retrying busy or not-yet-empty directories with Node's linear
 * backoff: a scanner or a writer that is still finishing can hold entries for a moment.
 */
export async function removeTree(target: string): Promise<void> {
  await rm(target, {
    recursive: true,
    force: true,
    maxRetries: REMOVE_RETRIES,
    retryDelay: REMOVE_RETRY_DELAY_MS,
  })
}

function isWindowsSharingViolation(error: unknown, platform: NodeJS.Platform): boolean {
  return (
    platform === "win32" &&
    error instanceof Error &&
    "code" in error &&
    WINDOWS_SHARING_VIOLATION_CODES.has(String(error.code))
  )
}
