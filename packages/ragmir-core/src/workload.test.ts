import { afterEach, describe, expect, it } from "vitest"
import type { RagmirError } from "./errors.js"
import { testConfig } from "./test-support/config.js"
import type { WorkloadLimits } from "./types.js"
import { resetWorkloadQueuesForTests, runWorkload, workloadSnapshot } from "./workload.js"

afterEach(() => {
  resetWorkloadQueuesForTests()
})

describe("workload admission", () => {
  it("should enforce the active ceiling and expose queue time", async () => {
    const config = configWithLimits("/tmp/ragmir-workload-ceiling", {
      search: { concurrency: 1, maxQueue: 2, queueTimeoutMs: 1_000 },
    })
    const firstGate = deferred<void>()
    const executionOrder: string[] = []
    const first = runWorkload(config, "search", undefined, async () => {
      executionOrder.push("first-start")
      await firstGate.promise
      executionOrder.push("first-end")
    })
    const second = runWorkload(config, "search", undefined, async ({ queueTimeMs }) => {
      executionOrder.push("second-start")
      return queueTimeMs
    })

    expect(workloadSnapshot(config, "search")).toMatchObject({ active: 1, queued: 1 })
    firstGate.resolve()

    await expect(first).resolves.toBeUndefined()
    await expect(second).resolves.toBeGreaterThan(0)
    expect(executionOrder).toEqual(["first-start", "first-end", "second-start"])
    expect(workloadSnapshot(config, "search")).toMatchObject({ active: 0, queued: 0 })
  })

  it("should reject overload without growing the queue", async () => {
    const config = configWithLimits("/tmp/ragmir-workload-overload", {
      embedding: { concurrency: 1, maxQueue: 1, queueTimeoutMs: 1_000 },
    })
    const gate = deferred<void>()
    const first = runWorkload(config, "embedding", undefined, () => gate.promise)
    const second = runWorkload(config, "embedding", undefined, async () => undefined)

    await expect(
      runWorkload(config, "embedding", undefined, async () => undefined),
    ).rejects.toMatchObject({ code: "OVERLOADED", retryable: true } satisfies Partial<RagmirError>)
    expect(workloadSnapshot(config, "embedding")).toMatchObject({ active: 1, queued: 1 })

    gate.resolve()
    await Promise.all([first, second])
  })

  it("should expire and cancel queued work without starting it", async () => {
    const config = configWithLimits("/tmp/ragmir-workload-deadline", {
      search: { concurrency: 1, maxQueue: 4, queueTimeoutMs: 20 },
    })
    const gate = deferred<void>()
    const first = runWorkload(config, "search", undefined, () => gate.promise)
    let timedOutStarted = false
    const timedOut = runWorkload(config, "search", undefined, async () => {
      timedOutStarted = true
    })
    const controller = new AbortController()
    let cancelledStarted = false
    const cancelled = runWorkload(config, "search", controller.signal, async () => {
      cancelledStarted = true
    })
    controller.abort("caller cancelled")

    await expect(cancelled).rejects.toMatchObject({
      code: "ABORTED",
    } satisfies Partial<RagmirError>)
    await expect(timedOut).rejects.toMatchObject({ code: "TIMEOUT" } satisfies Partial<RagmirError>)
    expect(timedOutStarted).toBe(false)
    expect(cancelledStarted).toBe(false)

    gate.resolve()
    await first
    expect(workloadSnapshot(config, "search")).toMatchObject({ active: 0, queued: 0 })
  })

  it("should isolate workload ceilings", async () => {
    const config = configWithLimits("/tmp/ragmir-workload-isolation", {
      search: { concurrency: 1, maxQueue: 1, queueTimeoutMs: 1_000 },
      embedding: { concurrency: 2, maxQueue: 2, queueTimeoutMs: 1_000 },
    })
    const searchGate = deferred<void>()
    const embeddingGate = deferred<void>()
    const search = runWorkload(config, "search", undefined, () => searchGate.promise)
    const embeddings = [
      runWorkload(config, "embedding", undefined, () => embeddingGate.promise),
      runWorkload(config, "embedding", undefined, () => embeddingGate.promise),
    ]

    expect(workloadSnapshot(config, "search").active).toBe(1)
    expect(workloadSnapshot(config, "embedding").active).toBe(2)

    searchGate.resolve()
    embeddingGate.resolve()
    await Promise.all([search, ...embeddings])
  })
})

function configWithLimits(
  projectRoot: string,
  overrides: Partial<WorkloadLimits>,
): ReturnType<typeof testConfig> {
  const defaults = testConfig(projectRoot).workloadLimits
  return testConfig(projectRoot, {
    workloadLimits: {
      search: overrides.search ?? defaults.search,
      embedding: overrides.embedding ?? defaults.embedding,
      ingestion: overrides.ingestion ?? defaults.ingestion,
    },
  })
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
} {
  let resolvePromise: (value: T | PromiseLike<T>) => void = () => undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}
