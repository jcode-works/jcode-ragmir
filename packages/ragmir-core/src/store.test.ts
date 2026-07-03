import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { readRows, writeRows } from "./store.js"
import { testConfig } from "./test-support/config.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("store", () => {
  it("round-trips vector rows from LanceDB as plain numeric arrays", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-store-"))
    tempDirs.push(root)
    const config = testConfig(root)

    await writeRows(
      [
        {
          id: ".ragmir/raw/evidence.md#0",
          source: "evidence.md",
          relativePath: ".ragmir/raw/evidence.md",
          chunkIndex: 0,
          text: "Local evidence.",
          checksum: "checksum",
          bytes: 15,
          mtimeMs: 1,
          vector: [0.1, 0.2, 0.3],
          embeddingProvider: config.embeddingProvider,
          embeddingModel: config.embeddingModel,
        },
      ],
      config,
    )

    const rows = await readRows(config)

    expect(rows).toHaveLength(1)
    expect(rows[0]?.vector).toHaveLength(3)
    expect(rows[0]?.vector[0]).toBeCloseTo(0.1)
    expect(rows[0]?.vector[1]).toBeCloseTo(0.2)
    expect(rows[0]?.vector[2]).toBeCloseTo(0.3)
    expect(rows[0]?.embeddingProvider).toBe("local-hash")
  })
})
