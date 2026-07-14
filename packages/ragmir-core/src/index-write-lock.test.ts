import { describe, expect, it } from "vitest"
import type { RagmirError } from "./errors.js"
import { withIndexWriteLock } from "./index-write-lock.js"

describe("withIndexWriteLock", () => {
  it("should let a queued caller abort without interrupting the active writer", async () => {
    let markWriterStarted: (() => void) | undefined
    const writerStarted = new Promise<void>((resolve) => {
      markWriterStarted = resolve
    })
    let releaseWriter: (() => void) | undefined
    const writerFinished = new Promise<void>((resolve) => {
      releaseWriter = resolve
    })
    const active = withIndexWriteLock("project", undefined, async () => {
      markWriterStarted?.()
      await writerFinished
      return "written"
    })
    await writerStarted

    const controller = new AbortController()
    const queued = withIndexWriteLock("project", controller.signal, async () => "unexpected")

    controller.abort()
    await expect(queued).rejects.toMatchObject({
      code: "ABORTED",
    } satisfies Partial<RagmirError>)

    let nextWriterStarted = false
    const next = withIndexWriteLock("project", undefined, async () => {
      nextWriterStarted = true
      return "next"
    })
    await Promise.resolve()
    expect(nextWriterStarted).toBe(false)

    releaseWriter?.()
    await expect(active).resolves.toBe("written")
    await expect(next).resolves.toBe("next")
  })

  it("should expose a timeout while waiting for the active writer", async () => {
    let releaseWriter: (() => void) | undefined
    const writerFinished = new Promise<void>((resolve) => {
      releaseWriter = resolve
    })
    const active = withIndexWriteLock("project-timeout", undefined, async () => {
      await writerFinished
      return "written"
    })
    const queued = withIndexWriteLock(
      "project-timeout",
      AbortSignal.timeout(5),
      async () => "unexpected",
    )

    await expect(queued).rejects.toMatchObject({
      code: "TIMEOUT",
      retryable: true,
    } satisfies Partial<RagmirError>)
    releaseWriter?.()
    await expect(active).resolves.toBe("written")
  })
})
