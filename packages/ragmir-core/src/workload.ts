import { channel } from "node:diagnostics_channel"
import { performance } from "node:perf_hooks"
import { RagmirError } from "./errors.js"
import { throwIfAborted } from "./operation.js"
import type { Config, WorkloadKind, WorkloadLimit } from "./types.js"

export const WORKLOAD_DIAGNOSTICS_CHANNEL = "ragmir:workload"
const workloadDiagnostics = channel(WORKLOAD_DIAGNOSTICS_CHANNEL)

export interface WorkloadAdmission {
  queueTimeMs: number
  active: number
  queued: number
}

export interface WorkloadDiagnosticsEvent extends WorkloadAdmission {
  projectRoot: string
  workload: WorkloadKind
  event: "started" | "completed" | "failed" | "overloaded" | "cancelled" | "timed-out"
}

export interface WorkloadSnapshot {
  active: number
  queued: number
  concurrency: number
  maxQueue: number
}

interface QueueEntry {
  enqueuedAt: number
  queueTimeoutMs: number
  signal: AbortSignal | undefined
  execute: (admission: WorkloadAdmission) => Promise<void>
  reject: (error: unknown) => void
  abortListener: (() => void) | undefined
  timeout: ReturnType<typeof setTimeout> | undefined
}

class WorkloadQueue {
  private active = 0
  private readonly queued: QueueEntry[] = []
  private limit: WorkloadLimit

  constructor(
    private readonly projectRoot: string,
    private readonly workload: WorkloadKind,
    limit: WorkloadLimit,
    private readonly onIdle: (queue: WorkloadQueue) => void,
  ) {
    this.limit = { ...limit }
  }

  run<T>(
    limit: WorkloadLimit,
    signal: AbortSignal | undefined,
    operation: (admission: WorkloadAdmission) => Promise<T>,
  ): Promise<T> {
    this.limit = { ...limit }
    throwIfAborted(signal)

    return new Promise<T>((resolve, reject) => {
      const entry: QueueEntry = {
        enqueuedAt: performance.now(),
        queueTimeoutMs: this.limit.queueTimeoutMs,
        signal,
        execute: async (admission) => {
          try {
            const value = await operation(admission)
            this.finish("completed", admission.queueTimeMs)
            resolve(value)
          } catch (error) {
            this.finish("failed", admission.queueTimeMs)
            reject(error)
          }
        },
        reject,
        abortListener: undefined,
        timeout: undefined,
      }

      if (this.queued.length === 0 && this.active < this.limit.concurrency) {
        this.start(entry)
        return
      }
      if (this.queued.length >= this.limit.maxQueue) {
        const error = new RagmirError(
          "OVERLOADED",
          `Ragmir ${this.workload} workload is overloaded (${this.active} active, ${this.queued.length} queued).`,
          { retryable: true },
        )
        this.publish("overloaded", 0)
        reject(error)
        return
      }

      entry.abortListener = () => this.rejectQueued(entry, abortedError(signal), "cancelled")
      signal?.addEventListener("abort", entry.abortListener, { once: true })
      entry.timeout = setTimeout(() => {
        this.rejectQueued(
          entry,
          new RagmirError(
            "TIMEOUT",
            `Ragmir ${this.workload} queue deadline exceeded after ${entry.queueTimeoutMs} ms.`,
            { retryable: true },
          ),
          "timed-out",
        )
      }, entry.queueTimeoutMs)
      entry.timeout.unref?.()
      this.queued.push(entry)
      this.drain()
    })
  }

  snapshot(): WorkloadSnapshot {
    return {
      active: this.active,
      queued: this.queued.length,
      concurrency: this.limit.concurrency,
      maxQueue: this.limit.maxQueue,
    }
  }

  private start(entry: QueueEntry): void {
    this.cleanupEntry(entry)
    try {
      throwIfAborted(entry.signal)
    } catch (error) {
      entry.reject(error)
      this.publish("cancelled", performance.now() - entry.enqueuedAt)
      queueMicrotask(() => this.drain())
      return
    }

    this.active += 1
    const queueTimeMs = Math.max(0, performance.now() - entry.enqueuedAt)
    const admission = {
      queueTimeMs,
      active: this.active,
      queued: this.queued.length,
    }
    this.publish("started", queueTimeMs)
    void entry.execute(admission)
  }

  private finish(event: WorkloadDiagnosticsEvent["event"], queueTimeMs: number): void {
    this.active -= 1
    this.publish(event, queueTimeMs)
    this.drain()
  }

  private drain(): void {
    while (this.active < this.limit.concurrency) {
      const entry = this.queued.shift()
      if (!entry) {
        break
      }
      this.start(entry)
    }
    if (this.active === 0 && this.queued.length === 0) {
      this.onIdle(this)
    }
  }

  private rejectQueued(
    entry: QueueEntry,
    error: RagmirError,
    event: "cancelled" | "timed-out",
  ): void {
    const index = this.queued.indexOf(entry)
    if (index === -1) {
      return
    }
    this.queued.splice(index, 1)
    this.cleanupEntry(entry)
    entry.reject(error)
    this.publish(event, performance.now() - entry.enqueuedAt)
    this.drain()
  }

  private cleanupEntry(entry: QueueEntry): void {
    if (entry.timeout) {
      clearTimeout(entry.timeout)
      entry.timeout = undefined
    }
    if (entry.abortListener) {
      entry.signal?.removeEventListener("abort", entry.abortListener)
      entry.abortListener = undefined
    }
  }

  private publish(event: WorkloadDiagnosticsEvent["event"], queueTimeMs: number): void {
    if (!workloadDiagnostics.hasSubscribers) {
      return
    }
    workloadDiagnostics.publish({
      projectRoot: this.projectRoot,
      workload: this.workload,
      event,
      queueTimeMs,
      active: this.active,
      queued: this.queued.length,
    } satisfies WorkloadDiagnosticsEvent)
  }
}

const workloadQueues = new Map<string, WorkloadQueue>()

export function runWorkload<T>(
  config: Config,
  workload: WorkloadKind,
  signal: AbortSignal | undefined,
  operation: (admission: WorkloadAdmission) => Promise<T>,
): Promise<T> {
  const key = `${config.projectRoot}\n${workload}`
  let queue = workloadQueues.get(key)
  if (!queue) {
    queue = new WorkloadQueue(
      config.projectRoot,
      workload,
      config.workloadLimits[workload],
      (idleQueue) => {
        if (workloadQueues.get(key) === idleQueue) {
          workloadQueues.delete(key)
        }
      },
    )
    workloadQueues.set(key, queue)
  }
  return queue.run(config.workloadLimits[workload], signal, operation)
}

export function workloadSnapshot(config: Config, workload: WorkloadKind): WorkloadSnapshot {
  const queue = workloadQueues.get(`${config.projectRoot}\n${workload}`)
  return (
    queue?.snapshot() ?? {
      active: 0,
      queued: 0,
      concurrency: config.workloadLimits[workload].concurrency,
      maxQueue: config.workloadLimits[workload].maxQueue,
    }
  )
}

export function resetWorkloadQueuesForTests(): void {
  workloadQueues.clear()
}

function abortedError(signal: AbortSignal | undefined): RagmirError {
  try {
    throwIfAborted(signal)
  } catch (error) {
    if (error instanceof RagmirError) {
      return error
    }
  }
  return new RagmirError("ABORTED", "Ragmir operation was aborted.", { retryable: true })
}
