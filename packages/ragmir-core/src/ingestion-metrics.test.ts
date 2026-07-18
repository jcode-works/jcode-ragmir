import { subscribe, unsubscribe } from "node:diagnostics_channel"
import { describe, expect, it } from "vitest"
import { RagmirError } from "./errors.js"
import {
  activeIngestionMetrics,
  createIngestionMetricsCollector,
  INGESTION_DIAGNOSTICS_CHANNEL,
  runWithIngestionMetrics,
} from "./ingestion-metrics.js"

describe("ingestion metrics", () => {
  it("should keep the disabled path inactive without a request or subscriber", () => {
    expect(createIngestionMetricsCollector(false, 0, "local-hash")).toBeUndefined()
    expect(activeIngestionMetrics()).toBeUndefined()
  })

  it("should publish bounded failure counters when a local subscriber requests diagnostics", async () => {
    const events: unknown[] = []
    const onDiagnostic = (event: unknown): void => {
      events.push(event)
    }
    subscribe(INGESTION_DIAGNOSTICS_CHANNEL, onDiagnostic)
    try {
      const collector = createIngestionMetricsCollector(false, 4.25, "transformers")
      if (!collector) {
        throw new Error("Expected a subscriber-backed ingestion metrics collector.")
      }

      await runWithIngestionMetrics(collector, async () => {
        expect(activeIngestionMetrics()).toBe(collector)
        collector.beginPhase("hashing")
        collector.beginPhase("hashing")
        collector.endPhase("hashing")
        collector.endPhase("hashing")
        collector.measure("redaction", () => undefined)
        await collector.measureAsync("embedding", async () => undefined)
        collector.recordSourceBytes(2_048)
        collector.recordStoragePayload(1_024)
        collector.recordEmbeddings(3)
        collector.recordEmbeddingQueue(2.5)
        collector.recordEmbeddingModelState("cold")
        collector.recordEmbeddingModelState("warm")
        collector.recordFailure(new RagmirError("TIMEOUT", "bounded timeout"))
        collector.recordTruncation()
        collector.recordMaintenanceOperation()
      })

      expect(activeIngestionMetrics()).toBeUndefined()
      const metrics = collector.complete({
        runId: null,
        status: "failed",
        candidateFiles: 5,
        processedFiles: 2,
        fallbackFiles: 1,
        errorCount: 2,
        ocrSubprocesses: 4,
      })
      expect(metrics).toMatchObject({
        sourceBytesRead: 2_048,
        storagePayloadBytes: 1_024,
        embeddedChunks: 3,
        embeddingProvider: "transformers",
        embeddingModelState: "mixed",
        embeddingCacheHits: 1,
        embeddingCacheMisses: 1,
        embeddingQueueMs: 2.5,
        fallbackFiles: 1,
        errorCount: 2,
        timeoutCount: 1,
        truncationCount: 1,
        maintenanceOperations: 1,
        ocrSubprocesses: 4,
      })
      expect(events).toEqual([
        expect.objectContaining({
          event: "failed",
          runId: null,
          status: "failed",
          metrics,
        }),
      ])
      expect(
        collector.complete({
          runId: "ignored-repeat",
          status: "completed",
          candidateFiles: 0,
          processedFiles: 0,
          fallbackFiles: 0,
          errorCount: 0,
          ocrSubprocesses: 0,
        }),
      ).toBe(metrics)
      expect(events).toHaveLength(1)
      expect(JSON.stringify(events)).not.toContain("bounded timeout")
    } finally {
      unsubscribe(INGESTION_DIAGNOSTICS_CHANNEL, onDiagnostic)
    }
  })
})
