export type RagmirErrorCode =
  | "ABORTED"
  | "CLIENT_CLOSED"
  | "INDEX_BUSY"
  | "INDEX_UNAVAILABLE"
  | "INTERNAL"
  | "INVALID_ARGUMENT"
  | "TIMEOUT"

interface RagmirErrorOptions {
  cause?: unknown
  retryable?: boolean
}

export class RagmirError extends Error {
  readonly code: RagmirErrorCode
  readonly retryable: boolean

  constructor(code: RagmirErrorCode, message: string, options: RagmirErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = "RagmirError"
    this.code = code
    this.retryable = options.retryable ?? false
  }
}

export function isRagmirError(error: unknown): error is RagmirError {
  return error instanceof RagmirError
}

export function normalizeRagmirError(error: unknown): RagmirError {
  if (isRagmirError(error)) {
    return error
  }
  return new RagmirError(
    "INTERNAL",
    error instanceof Error ? error.message : "Ragmir operation failed.",
    { cause: error },
  )
}
