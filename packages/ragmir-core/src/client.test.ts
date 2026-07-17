import { subscribe, unsubscribe } from "node:diagnostics_channel"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createRagmirClient } from "./client.js"
import type { RagmirError } from "./errors.js"
import { initProject } from "./init.js"
import { search } from "./query.js"
import { INDEX_READ_DIAGNOSTICS_CHANNEL, type IndexReadDiagnosticsEvent } from "./store.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

async function projectWithEvidence(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix))
  tempDirs.push(root)
  await initProject(root)
  await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
  await writeFile(
    path.join(root, ".ragmir", "raw", "decision.md"),
    "The rollout requires human approval before production deployment.\n",
    "utf8",
  )
  return root
}

describe("RagmirClient", () => {
  it("should reuse one client for ingestion and cited retrieval", async () => {
    const root = await projectWithEvidence("ragmir-client-")
    const client = await createRagmirClient({ cwd: root })

    const ingestion = await client.ingest()
    const results = await client.search("production approval")

    expect(ingestion.indexedFiles).toBe(1)
    expect(results[0]?.relativePath).toBe(".ragmir/raw/decision.md")
    expect(results[0]?.citation).toContain("decision.md:L1-")
    expect(client.isClosed).toBe(false)

    await client.close()
    await client.close()
    expect(client.isClosed).toBe(true)
    await expect(client.search("approval")).rejects.toMatchObject({
      code: "CLIENT_CLOSED",
    } satisfies Partial<RagmirError>)
  })

  it("should reuse one immutable read snapshot until an atomic generation change", async () => {
    const root = await projectWithEvidence("ragmir-client-snapshot-")
    const client = await createRagmirClient({ cwd: root })
    await client.ingest()
    const events: IndexReadDiagnosticsEvent[] = []
    const onDiagnostic = (event: unknown): void => {
      if (isIndexReadDiagnosticsEvent(event, root)) {
        events.push(event)
      }
    }
    subscribe(INDEX_READ_DIAGNOSTICS_CHANNEL, onDiagnostic)

    try {
      const cold = await client.search("production approval")
      const warm = await client.search("production approval")

      expect(JSON.stringify(warm)).toBe(JSON.stringify(cold))
      expect(events.filter((event) => event.kind === "manifest-read")).toHaveLength(1)
      expect(events.filter((event) => event.kind === "table-open")).toHaveLength(1)

      await writeFile(
        path.join(root, ".ragmir", "raw", "decision.md"),
        "The refreshed rollout requires signed phoenix approval before production deployment.\n",
        "utf8",
      )
      const writer = await createRagmirClient({ cwd: root })
      await writer.ingest({ rebuild: true })
      await writer.close()
      events.length = 0

      const refreshed = await client.search("phoenix approval")

      expect(refreshed[0]?.text).toContain("phoenix")
      expect(events.filter((event) => event.kind === "manifest-read")).toHaveLength(1)
      expect(events.filter((event) => event.kind === "table-open")).toHaveLength(1)
    } finally {
      unsubscribe(INDEX_READ_DIAGNOSTICS_CHANNEL, onDiagnostic)
      await client.close()
    }
  })

  it("should read one manifest and open one table for a one-shot search", async () => {
    const root = await projectWithEvidence("ragmir-one-shot-snapshot-")
    const client = await createRagmirClient({ cwd: root })
    await client.ingest()
    await client.close()
    const events: IndexReadDiagnosticsEvent[] = []
    const onDiagnostic = (event: unknown): void => {
      if (isIndexReadDiagnosticsEvent(event, root)) {
        events.push(event)
      }
    }
    subscribe(INDEX_READ_DIAGNOSTICS_CHANNEL, onDiagnostic)

    try {
      await search("production approval", { cwd: root })

      expect(events.filter((event) => event.kind === "manifest-read")).toHaveLength(1)
      expect(events.filter((event) => event.kind === "table-open")).toHaveLength(1)
    } finally {
      unsubscribe(INDEX_READ_DIAGNOSTICS_CHANNEL, onDiagnostic)
    }
  })

  it("should serialize concurrent ingestion in one Node.js process", async () => {
    const root = await projectWithEvidence("ragmir-client-concurrent-")
    const firstClient = await createRagmirClient({ cwd: root })
    const secondClient = await createRagmirClient({ cwd: root })

    const [first, second] = await Promise.all([firstClient.ingest(), secondClient.ingest()])
    const results = await secondClient.search("human approval")

    expect(first.rebuiltFiles).toBe(1)
    expect(second.reusedFiles).toBe(1)
    expect(results).toHaveLength(1)

    await Promise.all([firstClient.close(), secondClient.close()])
  })

  it("should finish active work before closing its shared connection", async () => {
    const root = await projectWithEvidence("ragmir-client-close-")
    const client = await createRagmirClient({ cwd: root })

    const ingestion = client.ingest()
    const closing = client.close()

    await expect(ingestion).resolves.toMatchObject({ indexedFiles: 1 })
    await expect(closing).resolves.toBeUndefined()
    expect(client.isClosed).toBe(true)
  })

  it("should expose stable abort and validation errors", async () => {
    const root = await projectWithEvidence("ragmir-client-abort-")
    const client = await createRagmirClient({ cwd: root })
    const controller = new AbortController()
    controller.abort("cancelled by caller")

    await expect(client.search("approval", { signal: controller.signal })).rejects.toMatchObject({
      code: "ABORTED",
      retryable: true,
    } satisfies Partial<RagmirError>)
    await expect(client.search("approval", { timeoutMs: 0 })).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    } satisfies Partial<RagmirError>)
    await expect(client.search("approval", { topK: 0 })).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
      retryable: false,
    } satisfies Partial<RagmirError>)

    await client.close()
  })

  it("should cancel status and source diagnostics through the client", async () => {
    const root = await projectWithEvidence("ragmir-client-diagnostics-abort-")
    const client = await createRagmirClient({ cwd: root })
    const controller = new AbortController()
    controller.abort("cancelled by caller")

    await expect(client.status({ signal: controller.signal })).rejects.toMatchObject({
      code: "ABORTED",
      retryable: true,
    } satisfies Partial<RagmirError>)
    await expect(client.sources({ signal: controller.signal })).rejects.toMatchObject({
      code: "ABORTED",
      retryable: true,
    } satisfies Partial<RagmirError>)

    await client.close()
  })
})

function isIndexReadDiagnosticsEvent(
  event: unknown,
  projectRoot: string,
): event is IndexReadDiagnosticsEvent {
  return (
    typeof event === "object" &&
    event !== null &&
    "kind" in event &&
    (event.kind === "manifest-read" || event.kind === "table-open") &&
    "projectRoot" in event &&
    event.projectRoot === projectRoot
  )
}
