import { afterEach, describe, expect, it } from "vitest"
import { embedTexts } from "./embeddings.js"
import { rankingPolicyFor } from "./ranking.js"
import { testConfig } from "./test-support/config.js"
import { type EmbeddingServer, startEmbeddingServer } from "./test-support/embedding-server.js"

const servers: EmbeddingServer[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
  delete process.env.RAGMIR_TEST_EMBEDDING_KEY
})

async function embeddingServer(
  reply: Parameters<typeof startEmbeddingServer>[0],
): Promise<EmbeddingServer> {
  const server = await startEmbeddingServer(reply)
  servers.push(server)
  return server
}

describe("openai-compatible embeddings", () => {
  it("sends the model and inputs, then returns normalized vectors in input order", async () => {
    const { endpoint, requests } = await embeddingServer((body) => ({
      payload: {
        // Out of order on purpose: vectors are matched to inputs by index.
        data: body.input.map((_, index) => ({ index, embedding: [3 + index, 4] })).reverse(),
      },
    }))
    process.env.RAGMIR_TEST_EMBEDDING_KEY = "test-key"
    const config = testConfig({
      embeddingProvider: "openai-compatible",
      embeddingEndpoint: endpoint,
      embeddingModel: "nomic-embed-text",
      embeddingApiKeyEnv: "RAGMIR_TEST_EMBEDDING_KEY",
    })

    const vectors = await embedTexts(["first passage", "second passage"], config, "document")

    expect(requests).toHaveLength(1)
    expect(requests[0]?.path).toBe("/v1/embeddings")
    expect(requests[0]?.authorization).toBe("Bearer test-key")
    expect(requests[0]?.body).toEqual({
      model: "nomic-embed-text",
      input: ["search_document: first passage", "search_document: second passage"],
    })
    expect(vectors[0]?.[0]).toBeCloseTo(0.6)
    expect(vectors[0]?.[1]).toBeCloseTo(0.8)
    expect(Math.hypot(...(vectors[1] ?? []))).toBeCloseTo(1)
  })

  it("reports a missing endpoint, a missing key, and a failing endpoint clearly", async () => {
    await expect(
      embedTexts(["text"], testConfig({ embeddingProvider: "openai-compatible" })),
    ).rejects.toThrow(/needs embeddingEndpoint/u)

    const { endpoint } = await embeddingServer(() => ({ status: 503, payload: { error: "busy" } }))
    await expect(
      embedTexts(
        ["text"],
        testConfig({
          embeddingProvider: "openai-compatible",
          embeddingEndpoint: endpoint,
          embeddingApiKeyEnv: "RAGMIR_TEST_EMBEDDING_KEY",
        }),
      ),
    ).rejects.toThrow(/RAGMIR_TEST_EMBEDDING_KEY/u)
    await expect(
      embedTexts(
        ["text"],
        testConfig({ embeddingProvider: "openai-compatible", embeddingEndpoint: endpoint }),
      ),
    ).rejects.toThrow(/HTTP 503/u)
  })

  it("ranks openai-compatible vectors with the semantic evidence profile", () => {
    expect(
      rankingPolicyFor("openai-compatible", "balanced", 1, "nomic-embed-text").embeddingModel,
    ).toBe("nomic-embed-text")
    expect(
      rankingPolicyFor("local-hash", "balanced", 1, "nomic-embed-text").embeddingModel,
    ).toBeNull()
  })
})
