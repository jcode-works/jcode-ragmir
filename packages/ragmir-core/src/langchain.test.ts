import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createRagmirClient } from "./client.js"
import type { RagmirError } from "./errors.js"
import { initProject } from "./init.js"
import { RagmirRetriever, ragmirResultToDocument } from "./langchain.js"
import { integrationTimeout } from "./test-support/timeouts.js"
import type { SearchResult } from "./types.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

async function indexedProject(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix))
  tempDirs.push(root)
  await initProject(root)
  await mkdir(path.join(root, ".ragmir", "raw"), { recursive: true })
  await writeFile(
    path.join(root, ".ragmir", "raw", "decision.md"),
    "# Release policy\n\nThe rollout requires human approval before production deployment.\n",
    "utf8",
  )
  const client = await createRagmirClient({ cwd: root })
  await client.ingest()
  await client.close()
  return root
}

describe("RagmirRetriever", { timeout: integrationTimeout(10_000) }, () => {
  it("should return cited LangChain documents from a project root", async () => {
    const root = await indexedProject("ragmir-langchain-")
    const retriever = new RagmirRetriever({ projectRoot: root, topK: 2 })

    const documents = await retriever.invoke("production approval")

    expect(documents.length).toBeGreaterThan(0)
    const [first] = documents
    expect(first?.pageContent).toContain("human approval")
    expect(first?.metadata.source).toBe(".ragmir/raw/decision.md")
    expect(first?.metadata.citation).toContain("decision.md:L")
    expect(first?.metadata.lineStart).toBeTypeOf("number")
    expect(first?.metadata.weakEvidence).toBe(false)
    expect(first?.id).toBeTruthy()

    await retriever.close()
    await retriever.close()
    await expect(retriever.invoke("approval")).rejects.toMatchObject({
      code: "CLIENT_CLOSED",
    } satisfies Partial<RagmirError>)
  })

  it("should return no document when the sources hold no evidence", async () => {
    const root = await indexedProject("ragmir-langchain-empty-")
    const retriever = new RagmirRetriever({ projectRoot: root })

    await expect(retriever.invoke("chocolate cake baking temperature")).resolves.toEqual([])

    await retriever.close()
  })

  it("should leave a shared client open", async () => {
    const root = await indexedProject("ragmir-langchain-shared-")
    const client = await createRagmirClient({ cwd: root })
    const retriever = new RagmirRetriever({ client, includePaths: [".ragmir/raw"] })

    const documents = await retriever.invoke("production approval")
    await retriever.close()

    expect(documents[0]?.metadata.source).toBe(".ragmir/raw/decision.md")
    expect(client.isClosed).toBe(false)
    await client.close()
  })

  it("should not close a client it never opened", async () => {
    const retriever = new RagmirRetriever()

    await expect(retriever.close()).resolves.toBeUndefined()
  })
})

describe("ragmirResultToDocument", () => {
  it("should keep page citations, freshness, and the evidence identity", () => {
    const result: SearchResult = {
      source: "/project/specs/contract.pdf",
      relativePath: "specs/contract.pdf",
      chunkIndex: 4,
      contextPath: "Termination",
      citation: "specs/contract.pdf#page=3",
      text: "Either party may terminate with 30 days notice.",
      distance: 0.21,
      charStart: null,
      charEnd: null,
      lineStart: null,
      lineEnd: null,
      pageStart: 3,
      pageEnd: 3,
      context: [],
      evidence: {
        id: "evidence-1",
        sourceChecksum: "abc",
        indexGeneration: "g1",
        indexedAt: null,
        knowledgeBaseId: "kb-1",
      },
      sourceStatus: "modified",
      weakEvidence: true,
    }

    const document = ragmirResultToDocument(result)

    expect(document.id).toBe("evidence-1")
    expect(document.pageContent).toBe(result.text)
    expect(document.metadata).toEqual({
      source: "specs/contract.pdf",
      citation: "specs/contract.pdf#page=3",
      chunkIndex: 4,
      contextPath: "Termination",
      lineStart: null,
      lineEnd: null,
      pageStart: 3,
      pageEnd: 3,
      distance: 0.21,
      weakEvidence: true,
      sourceStatus: "modified",
      knowledgeBaseId: "kb-1",
    })
  })
})
