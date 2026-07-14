import { throwIfAborted } from "./operation.js"

const writeQueues = new Map<string, Promise<void>>()

export async function withIndexWriteLock<T>(
  key: string,
  signal: AbortSignal | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = writeQueues.get(key) ?? Promise.resolve()
  let release: (() => void) | undefined
  const current = new Promise<void>((resolve) => {
    release = resolve
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

  try {
    await waitForTurn(previous, signal)
    throwIfAborted(signal)
    return await operation()
  } finally {
    release?.()
  }
}

async function waitForTurn(
  previous: Promise<void>,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (!signal) {
    await previous
    return
  }
  throwIfAborted(signal)

  let onAbort: (() => void) | undefined
  const aborted = new Promise<void>((resolve) => {
    onAbort = () => resolve()
    signal.addEventListener("abort", onAbort, { once: true })
  })
  try {
    await Promise.race([previous, aborted])
    throwIfAborted(signal)
  } finally {
    if (onAbort) {
      signal.removeEventListener("abort", onAbort)
    }
  }
}
