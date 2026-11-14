import type { Table } from "@lancedb/lancedb"
import { describe, expect, it } from "vitest"
import {
  ABSTENTION_PROBES,
  indexNoiseFloor,
  manifestNoiseFloor,
  measureAbstentionCalibration,
  noiseFloorAdvice,
} from "./abstention-calibration.js"
import type { Config, IndexManifest } from "./types.js"

const semanticConfig = {
  embeddingProvider: "transformers",
  embeddingModel: "intfloat/multilingual-e5-base",
} as Config

/**
 * A table whose exact nearest distance for probe vector [i] is distances[i]. Like LanceDB without
 * implicit projection, it returns `_distance` only when the query selects it.
 */
function tableWithNearest(distances: Array<number | undefined>): Table {
  return {
    vectorSearch: (vector: number[]) => {
      let columns: string[] = []
      const query = {
        bypassVectorIndex: () => query,
        select: (selected: string[]) => {
          columns = selected
          return query
        },
        limit: () => query,
        toArray: async () => {
          const distance = distances[vector[0] ?? 0]
          if (distance === undefined) {
            return []
          }
          return [
            columns.includes("_distance") ? { id: "row", _distance: distance } : { id: "row" },
          ]
        },
      }
      return query
    },
  } as unknown as Table
}

const embedByIndex = async (texts: string[]) => texts.map((_, index) => [index])

describe("abstention calibration", () => {
  it("should keep the nearest off-topic distance as the index noise floor", async () => {
    const distances: Array<number | undefined> = ABSTENTION_PROBES.map(
      (_, index) => 0.5 - index * 0.001,
    )
    distances[3] = 0.31
    distances[7] = undefined

    const calibration = await measureAbstentionCalibration(
      tableWithNearest(distances),
      semanticConfig,
      embedByIndex,
    )

    expect(calibration).toEqual({
      schemaVersion: 1,
      embeddingModel: "intfloat/multilingual-e5-base",
      probeCount: ABSTENTION_PROBES.length - 1,
      noiseFloorDistance: 0.31,
    })
  })

  it("should skip local-hash indexes and empty tables", async () => {
    const localHash = { ...semanticConfig, embeddingProvider: "local-hash" } as Config
    expect(
      await measureAbstentionCalibration(tableWithNearest([0.2]), localHash, embedByIndex),
    ).toBeNull()
    expect(
      await measureAbstentionCalibration(tableWithNearest([]), semanticConfig, embedByIndex),
    ).toBeNull()
  })

  it("should read a stored floor only for the configured model", () => {
    const manifest = {
      abstentionCalibration: {
        schemaVersion: 1,
        embeddingModel: "intfloat/multilingual-e5-base",
        probeCount: 24,
        noiseFloorDistance: 0.31,
      },
    } as IndexManifest

    expect(manifestNoiseFloor(manifest, semanticConfig)).toBe(0.31)
    expect(
      manifestNoiseFloor(manifest, { ...semanticConfig, embeddingModel: "other/model" } as Config),
    ).toBeNull()
    expect(manifestNoiseFloor(null, semanticConfig)).toBeNull()
  })

  it("should advise an ingest only for a semantic index without a stored floor", () => {
    const run = (args: string[]) => `rgr ${args.join(" ")}`
    const legacy = { chunkCount: 120 } as IndexManifest
    const stored = {
      chunkCount: 120,
      abstentionCalibration: {
        schemaVersion: 1,
        embeddingModel: "intfloat/multilingual-e5-base",
        probeCount: 24,
        noiseFloorDistance: 0.31,
      },
    } as IndexManifest
    const localHash = { ...semanticConfig, embeddingProvider: "local-hash" } as Config

    expect(noiseFloorAdvice(legacy, semanticConfig, run)).toContain("Run `rgr ingest` to store it.")
    expect(noiseFloorAdvice(stored, semanticConfig, run)).toBeNull()
    expect(noiseFloorAdvice(legacy, localHash, run)).toBeNull()
    expect(noiseFloorAdvice({ chunkCount: 0 } as IndexManifest, semanticConfig, run)).toBeNull()
  })

  it("should measure a legacy index once per generation and reuse a stored floor", async () => {
    const distances = ABSTENTION_PROBES.map(() => 0.42)
    let embedCalls = 0
    const countingEmbed = async (texts: string[]) => {
      embedCalls += 1
      return embedByIndex(texts)
    }
    const legacy = { chunkCount: 12 } as IndexManifest
    const table = tableWithNearest(distances)

    expect(
      await indexNoiseFloor(table, semanticConfig, legacy, "generation-a", countingEmbed),
    ).toBe(0.42)
    expect(
      await indexNoiseFloor(table, semanticConfig, legacy, "generation-a", countingEmbed),
    ).toBe(0.42)
    expect(embedCalls).toBe(1)

    const stored = {
      chunkCount: 12,
      abstentionCalibration: {
        schemaVersion: 1,
        embeddingModel: "intfloat/multilingual-e5-base",
        probeCount: 24,
        noiseFloorDistance: 0.3,
      },
    } as IndexManifest
    expect(
      await indexNoiseFloor(table, semanticConfig, stored, "generation-b", countingEmbed),
    ).toBe(0.3)
    expect(embedCalls).toBe(1)
  })

  it("should keep the policy distances when the measurement fails or does not apply", async () => {
    const failing = async () => {
      throw new Error("model unavailable")
    }
    const legacy = { chunkCount: 12 } as IndexManifest
    const localHash = { ...semanticConfig, embeddingProvider: "local-hash" } as Config

    expect(
      await indexNoiseFloor(
        tableWithNearest([0.2]),
        semanticConfig,
        legacy,
        "generation-c",
        failing,
      ),
    ).toBeNull()
    expect(
      await indexNoiseFloor(
        tableWithNearest([0.2]),
        localHash,
        legacy,
        "generation-d",
        embedByIndex,
      ),
    ).toBeNull()
  })
})
