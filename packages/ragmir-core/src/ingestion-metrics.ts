import { AsyncLocalStorage } from "node:async_hooks"
import { channel } from "node:diagnostics_channel"
import { performance } from "node:perf_hooks"
import type {
  EmbeddingProvider,
  IngestionEmbeddingModelState,
  IngestionMetrics,
  IngestionRunStatus,
} from "./types.js"

export const INGESTION_DIAGNOSTICS_CHANNEL = "ragmir:ingestion"

type TimedPhase =
  | "inventory"
  | "hashing"
  | "parsing"
  | "redaction"
  | "chunking"
  | "embedding"
  | "storageWrite"
  | "maintenance"
  | "writeLockWait"

interface PhaseRuntime {
  active: number
  startedAt: number
  durationMs: number
}

interface IngestionMetricSummary {
  runId: string | null
  status: IngestionRunStatus
  candidateFiles: number
  processedFiles: number
  fallbackFiles: number
  errorCount: number
  ocrSubprocesses: number
}

export interface IngestionDiagnosticsEvent {
  event: "completed" | "failed"
  runId: string | null
  status: IngestionRunStatus
  metrics: IngestionMetrics
}

const ingestionDiagnostics = channel(INGESTION_DIAGNOSTICS_CHANNEL)
const ingestionMetricsContext = new AsyncLocalStorage<IngestionMetricsCollector>()
const MEBIBYTE_BYTES = 1_024 * 1_024
let activeMetricContexts = 0

export class IngestionMetricsCollector {
  private readonly phases = new Map<TimedPhase, PhaseRuntime>()
  private readonly startedAt = performance.now()
  private completedMetrics: IngestionMetrics | undefined
  private sourceBytesRead = 0
  private storagePayloadBytes = 0
  private peakRssBytes = process.memoryUsage.rss()
  private embeddedChunks = 0
  private embeddingCacheHits = 0
  private embeddingCacheMisses = 0
  private embeddingQueueMs = 0
  private timeoutCount = 0
  private truncationCount = 0
  private maintenanceOperations = 0

  constructor(
    private readonly queueMs: number,
    private readonly embeddingProvider: EmbeddingProvider,
  ) {}

  async measureAsync<T>(phase: TimedPhase, operation: () => Promise<T>): Promise<T> {
    this.beginPhase(phase)
    try {
      return await operation()
    } finally {
      this.endPhase(phase)
    }
  }

  measure<T>(phase: TimedPhase, operation: () => T): T {
    this.beginPhase(phase)
    try {
      return operation()
    } finally {
      this.endPhase(phase)
    }
  }

  beginPhase(phase: TimedPhase): void {
    const runtime = this.phase(phase)
    if (runtime.active === 0) {
      runtime.startedAt = performance.now()
    }
    runtime.active += 1
    this.sampleRss()
  }

  endPhase(phase: TimedPhase): void {
    const runtime = this.phase(phase)
    if (runtime.active === 0) {
      return
    }
    runtime.active -= 1
    if (runtime.active === 0) {
      runtime.durationMs += Math.max(0, performance.now() - runtime.startedAt)
    }
    this.sampleRss()
  }

  recordSourceBytes(bytes: number): void {
    this.sourceBytesRead += Math.max(0, bytes)
  }

  recordStoragePayload(bytes: number): void {
    this.storagePayloadBytes += Math.max(0, bytes)
  }

  recordEmbeddings(count: number): void {
    this.embeddedChunks += Math.max(0, count)
  }

  recordEmbeddingQueue(queueMs: number): void {
    this.embeddingQueueMs += Math.max(0, queueMs)
  }

  recordEmbeddingModelState(
    state: Exclude<IngestionEmbeddingModelState, "mixed" | "unused">,
  ): void {
    if (state === "warm") {
      this.embeddingCacheHits += 1
    } else if (state === "cold") {
      this.embeddingCacheMisses += 1
    }
  }

  recordFailure(error: unknown): void {
    if (isTimeoutError(error)) {
      this.timeoutCount += 1
    }
  }

  recordTruncation(): void {
    this.truncationCount += 1
  }

  recordMaintenanceOperation(): void {
    this.maintenanceOperations += 1
  }

  complete(summary: IngestionMetricSummary): IngestionMetrics {
    if (this.completedMetrics) {
      return this.completedMetrics
    }
    for (const [phase, runtime] of this.phases) {
      while (runtime.active > 0) {
        this.endPhase(phase)
      }
    }
    this.sampleRss()

    const totalMs = Math.max(0, performance.now() - this.startedAt)
    const inventoryMs = this.duration("inventory")
    const hashingMs = this.duration("hashing")
    const elapsedSeconds = totalMs / 1_000
    const metrics = {
      phaseDurations: {
        queueMs: round(this.queueMs),
        writeLockWaitMs: round(this.duration("writeLockWait")),
        discoveryMs: round(Math.max(0, inventoryMs - hashingMs)),
        hashingMs: round(hashingMs),
        parsingMs: round(this.duration("parsing")),
        redactionMs: round(this.duration("redaction")),
        chunkingMs: round(this.duration("chunking")),
        embeddingMs: round(this.duration("embedding")),
        storageWriteMs: round(this.duration("storageWrite")),
        maintenanceMs: round(this.duration("maintenance")),
        totalMs: round(totalMs),
      },
      throughput: {
        filesPerSecond: rate(summary.processedFiles, elapsedSeconds),
        mebibytesPerSecond: rate(this.sourceBytesRead / MEBIBYTE_BYTES, elapsedSeconds),
        chunksPerSecond: rate(this.embeddedChunks, elapsedSeconds),
        embeddingsPerSecond: rate(this.embeddedChunks, elapsedSeconds),
      },
      sourceBytesRead: this.sourceBytesRead,
      storagePayloadBytes: this.storagePayloadBytes,
      peakRssBytes: this.peakRssBytes,
      candidateFiles: summary.candidateFiles,
      processedFiles: summary.processedFiles,
      embeddedChunks: this.embeddedChunks,
      embeddingProvider: this.embeddingProvider,
      embeddingModelState: this.embeddingModelState(),
      embeddingCacheHits: this.embeddingCacheHits,
      embeddingCacheMisses: this.embeddingCacheMisses,
      embeddingQueueMs: round(this.embeddingQueueMs),
      fallbackFiles: summary.fallbackFiles,
      errorCount: summary.errorCount,
      timeoutCount: this.timeoutCount,
      truncationCount: this.truncationCount,
      maintenanceOperations: this.maintenanceOperations,
      ocrSubprocesses: summary.ocrSubprocesses,
    } satisfies IngestionMetrics

    this.completedMetrics = metrics
    ingestionDiagnostics.publish({
      event:
        summary.status === "failed" || summary.status === "interrupted" ? "failed" : "completed",
      runId: summary.runId,
      status: summary.status,
      metrics,
    } satisfies IngestionDiagnosticsEvent)
    return metrics
  }

  private duration(phase: TimedPhase): number {
    return this.phases.get(phase)?.durationMs ?? 0
  }

  private embeddingModelState(): IngestionEmbeddingModelState {
    if (this.embeddingProvider === "local-hash") {
      return "stateless"
    }
    if (this.embeddingCacheHits > 0 && this.embeddingCacheMisses > 0) {
      return "mixed"
    }
    if (this.embeddingCacheHits === 0 && this.embeddingCacheMisses === 0) {
      return "unused"
    }
    return this.embeddingCacheMisses > 0 ? "cold" : "warm"
  }

  private phase(name: TimedPhase): PhaseRuntime {
    const existing = this.phases.get(name)
    if (existing) {
      return existing
    }
    const created = { active: 0, startedAt: 0, durationMs: 0 }
    this.phases.set(name, created)
    return created
  }

  private sampleRss(): void {
    this.peakRssBytes = Math.max(this.peakRssBytes, process.memoryUsage.rss())
  }
}

export function createIngestionMetricsCollector(
  requested: boolean,
  queueMs: number,
  embeddingProvider: EmbeddingProvider,
): IngestionMetricsCollector | undefined {
  return requested || ingestionDiagnostics.hasSubscribers
    ? new IngestionMetricsCollector(queueMs, embeddingProvider)
    : undefined
}

export async function runWithIngestionMetrics<T>(
  collector: IngestionMetricsCollector,
  operation: () => Promise<T>,
): Promise<T> {
  activeMetricContexts += 1
  try {
    return await ingestionMetricsContext.run(collector, operation)
  } finally {
    activeMetricContexts -= 1
  }
}

export function activeIngestionMetrics(): IngestionMetricsCollector | undefined {
  return activeMetricContexts === 0 ? undefined : ingestionMetricsContext.getStore()
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || (isRecord(error) && error.code === "TIMEOUT"))
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function rate(value: number, elapsedSeconds: number): number {
  return elapsedSeconds > 0 ? round(value / elapsedSeconds) : 0
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000
}
