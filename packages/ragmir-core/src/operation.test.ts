import { describe, expect, it } from "vitest"
import { operationSignal, throwIfAborted } from "./operation.js"

describe("operationSignal", () => {
  it("should return no signal when no cancellation option is configured", () => {
    expect(operationSignal({})).toBeUndefined()
  })

  it("should reject a non-positive timeout when creating an operation signal", () => {
    expect(() => operationSignal({ timeoutMs: 0 })).toThrow("timeoutMs must be a positive integer")
  })

  it("should accept the largest safe Node timer delay", () => {
    expect(operationSignal({ timeoutMs: 2_147_483_647 })).toBeInstanceOf(AbortSignal)
  })

  it("should reject a timeout that Node would overflow", () => {
    expect(() => operationSignal({ timeoutMs: 2_147_483_648 })).toThrow(
      "no greater than 2147483647",
    )
  })

  it("should propagate the external abort reason when signals are combined", () => {
    const controller = new AbortController()
    const signal = operationSignal({ signal: controller.signal, timeoutMs: 60_000 })
    const reason = new Error("caller stopped the operation")

    controller.abort(reason)

    expect(signal).toMatchObject({ aborted: true, reason })
  })

  it("should map a timeout abort to a retryable TIMEOUT error", () => {
    const controller = new AbortController()
    controller.abort(new DOMException("The operation timed out", "TimeoutError"))

    expect(() => throwIfAborted(controller.signal)).toThrowError(
      expect.objectContaining({ code: "TIMEOUT", retryable: true }),
    )
  })

  it("should map a caller abort to a retryable ABORTED error", () => {
    const controller = new AbortController()
    controller.abort(new Error("cancelled"))

    expect(() => throwIfAborted(controller.signal)).toThrowError(
      expect.objectContaining({ code: "ABORTED", retryable: true }),
    )
  })
})
