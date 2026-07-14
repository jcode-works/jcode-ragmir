import { RagmirError } from "./errors.js"
import type { OperationOptions } from "./types.js"

export function operationSignal(options: OperationOptions): AbortSignal | undefined {
  const timeoutSignal = timeoutSignalFor(options.timeoutMs)
  if (options.signal && timeoutSignal) {
    return combineSignals(options.signal, timeoutSignal)
  }
  return options.signal ?? timeoutSignal
}

function combineSignals(first: AbortSignal, second: AbortSignal): AbortSignal {
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([first, second])
  }

  const controller = new AbortController()
  const abort = (signal: AbortSignal): void => {
    if (!controller.signal.aborted) {
      controller.abort(signal.reason)
    }
    first.removeEventListener("abort", abortFirst)
    second.removeEventListener("abort", abortSecond)
  }
  const abortFirst = (): void => abort(first)
  const abortSecond = (): void => abort(second)

  if (first.aborted) {
    abort(first)
  } else if (second.aborted) {
    abort(second)
  } else {
    first.addEventListener("abort", abortFirst, { once: true })
    second.addEventListener("abort", abortSecond, { once: true })
  }
  return controller.signal
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) {
    return
  }
  const reason = signal.reason
  const timeout = reason instanceof Error && reason.name === "TimeoutError"
  throw new RagmirError(
    timeout ? "TIMEOUT" : "ABORTED",
    timeout ? "Ragmir operation timed out." : "Ragmir operation was aborted.",
    { cause: reason, retryable: true },
  )
}

function timeoutSignalFor(timeoutMs: number | undefined): AbortSignal | undefined {
  if (timeoutMs === undefined) {
    return undefined
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RagmirError("INVALID_ARGUMENT", "timeoutMs must be a positive integer.")
  }
  return AbortSignal.timeout(timeoutMs)
}
