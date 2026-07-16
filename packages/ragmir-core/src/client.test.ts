import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createRagmirClient } from "./client.js"
import type { RagmirError } from "./errors.js"
import { initProject } from "./init.js"

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
