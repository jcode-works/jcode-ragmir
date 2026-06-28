import { describe, expect, it } from "vitest"
import { embedText, embedTexts } from "./embeddings.js"
import { testConfig } from "./test-support/config.js"

describe("local hash embeddings", () => {
  it("creates deterministic normalized embeddings without a model runtime", async () => {
    const config = testConfig()

    const first = await embedText("offline model approval", config)
    const second = await embedText("offline model approval", config)
    const batch = await embedTexts(["offline model approval", "dataset residency"], config)

    expect(first).toHaveLength(384)
    expect(second).toEqual(first)
    expect(batch).toHaveLength(2)
    expect(Math.round(vectorMagnitude(first) * 1000) / 1000).toBe(1)
  })
})

function vectorMagnitude(vector: number[]): number {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
}
