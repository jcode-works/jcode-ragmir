import type { Table } from "@lancedb/lancedb"
import type { AbstentionCalibration, Config, IndexManifest } from "./types.js"

/**
 * Off-topic questions in English, French, and nonsense, chosen to share no subject with a software
 * project. Their nearest passages mark where unrelated questions land in an index, whatever the
 * embedding model. Changing the list changes every calibration, so keep it stable.
 */
export const ABSTENTION_PROBES: readonly string[] = [
  "Who won the Super Bowl in 1998?",
  "How long should I boil an egg?",
  "What is the population of Canada?",
  "Best beaches in Portugal for surfing",
  "How to knit a scarf for beginners",
  "What time is sunset in Tokyo today?",
  "Who were the members of the Beatles?",
  "How do volcanoes form?",
  "Recommend a good fantasy novel",
  "What is the exchange rate of the euro to the yen?",
  "Quelle est la capitale de l'Argentine ?",
  "Comment préparer une pâte à crêpes ?",
  "Qui a gagné Roland-Garros en 2015 ?",
  "Quel temps fera-t-il à Nice demain ?",
  "Comment entretenir un aquarium d'eau douce ?",
  "Quelle est la distance entre la Terre et la Lune ?",
  "Quels sont les meilleurs vins de Bourgogne ?",
  "Comment apprendre à jouer de la guitare ?",
  "flimbo grastic wuvvle",
  "trepax zondor kliffum",
  "asdkj qwpoe zmxn",
  "lorem quantum frabble",
  "Combien de temps vit un chat domestique ?",
  "What is the tallest mountain in Africa?",
]

/** The embedding function, `embedTexts` in production, so callers pass it without a wrapper. */
export type ProbeEmbedder = (
  texts: string[],
  config: Config,
  inputType: "query",
  signal?: AbortSignal,
) => Promise<number[][]>

const MAX_MEASURED_FLOORS = 4
// Noise floors measured at search time for indexes built before ingestion stored one.
const measuredFloors = new Map<string, Promise<number | null>>()

/**
 * Measure the noise floor of an index: embed the probes as queries and take the smallest exact
 * distance to their nearest passage. Returns null for local-hash indexes and empty tables.
 */
export async function measureAbstentionCalibration(
  table: Table,
  config: Config,
  embed: ProbeEmbedder,
  signal?: AbortSignal,
): Promise<AbstentionCalibration | null> {
  if (config.embeddingProvider !== "transformers") {
    return null
  }
  const vectors = await embed([...ABSTENTION_PROBES], config, "query", signal)
  const distances: number[] = []
  for (const vector of vectors) {
    // Select the distance explicitly: LanceDB is phasing out projecting it implicitly.
    const [nearest] = await table
      .vectorSearch(vector)
      .bypassVectorIndex()
      .select(["id", "_distance"])
      .limit(1)
      .toArray()
    if (typeof nearest?._distance === "number" && Number.isFinite(nearest._distance)) {
      distances.push(nearest._distance)
    }
  }
  if (distances.length === 0) {
    return null
  }
  return {
    schemaVersion: 1,
    embeddingModel: config.embeddingModel,
    probeCount: distances.length,
    noiseFloorDistance: Math.min(...distances),
  }
}

/**
 * The noise floor search applies: stored by ingestion, or measured once per process and index
 * generation for an index built before ingestion stored it. A failed measurement keeps the
 * policy's own distances.
 */
export function indexNoiseFloor(
  table: Table,
  config: Config,
  manifest: IndexManifest | null,
  generationKey: string,
  embed: ProbeEmbedder,
): Promise<number | null> {
  if (config.embeddingProvider !== "transformers" || !manifest?.chunkCount) {
    return Promise.resolve(null)
  }
  const stored = manifestNoiseFloor(manifest, config)
  if (stored !== null) {
    return Promise.resolve(stored)
  }
  const cacheKey = `${generationKey}\0${config.embeddingModel}`
  let measured = measuredFloors.get(cacheKey)
  if (!measured) {
    measured = measureAbstentionCalibration(table, config, embed)
      .then((calibration) => calibration?.noiseFloorDistance ?? null)
      .catch(() => null)
    measuredFloors.set(cacheKey, measured)
    for (const key of measuredFloors.keys()) {
      if (measuredFloors.size <= MAX_MEASURED_FLOORS) break
      measuredFloors.delete(key)
    }
  }
  return measured
}

/**
 * Advice for a semantic index built before ingestion stored its noise floor: every process then
 * measures it on its first search, which cost 0.1 to 0.3 s on real bases.
 */
export function noiseFloorAdvice(
  manifest: IndexManifest | null,
  config: Config,
  run: (args: string[]) => string,
): string | null {
  if (
    config.embeddingProvider !== "transformers" ||
    !manifest?.chunkCount ||
    manifestNoiseFloor(manifest, config) !== null
  ) {
    return null
  }
  return `The index has no stored noise floor, so each process measures it on its first search. Run \`${run(["ingest"])}\` to store it.`
}

/** The calibration stored with the index, when it was measured with the configured model. */
export function manifestNoiseFloor(manifest: IndexManifest | null, config: Config): number | null {
  const calibration = manifest?.abstentionCalibration
  if (
    config.embeddingProvider !== "transformers" ||
    calibration?.schemaVersion !== 1 ||
    calibration.embeddingModel !== config.embeddingModel
  ) {
    return null
  }
  return calibration.noiseFloorDistance
}
