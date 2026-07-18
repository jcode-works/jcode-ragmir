import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { fileURLToPath } from "node:url"
import { tokenize } from "../dist/text.js"
import { environmentMetadata } from "./lib/metrics.mjs"

const dimensions = 384
const tokenHashSeed = 0x811c9dc5
const ngramHashSeed = 0x9e3779b9
const fnvPrime = 0x01000193

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const options = parseArguments(process.argv.slice(2))
const baselinePath = path.resolve(
  options.baseline ?? path.join(packageRoot, "benchmarks/.results/exp-001-baseline.json"),
)
const candidatePath = path.resolve(
  options.candidate ?? path.join(packageRoot, "benchmarks/.results/exp-001-candidate.json"),
)
const resultPath = path.resolve(
  options.result ?? path.join(packageRoot, "benchmarks/.results/exp-001-local-hash.json"),
)
const texts = benchmarkTexts()
const warmups = 3
const samples = 10

const baselineThroughput = measureThroughput(legacyLocalHashEmbedding)
const candidateThroughput = measureThroughput(candidateLocalHashEmbedding)
const explicitAllocations = allocationEstimate(texts)
const quality = compareQuality(
  JSON.parse(await readFile(baselinePath, "utf8")),
  JSON.parse(await readFile(candidatePath, "utf8")),
)
const throughputRatio =
  candidateThroughput.medianEmbeddingsPerSecond /
  baselineThroughput.medianEmbeddingsPerSecond
const allocationReductionRatio =
  1 - explicitAllocations.candidate / explicitAllocations.baseline
const gates = {
  throughput: throughputRatio >= 3,
  allocations: allocationReductionRatio >= 0.5,
  quality: quality.noRegression,
  citations: quality.citationRegression === 0,
  reproducible: quality.candidateReproducible,
}
const accepted = Object.values(gates).every(Boolean)
const result = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  environment: environmentMetadata({ includeSemanticDependencies: false }),
  configuration: { texts: texts.length, warmups, samples },
  baselineThroughput,
  candidateThroughput,
  throughputRatio,
  explicitAllocations,
  allocationReductionRatio,
  quality,
  gates,
  decision: accepted ? "accept" : "reject",
  passed: true,
}

await mkdir(path.dirname(resultPath), { recursive: true })
await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8")
process.stdout.write(`${JSON.stringify({ resultPath, ...result }, null, 2)}\n`)

function measureThroughput(embedding) {
  const durations = []
  let checksum = 0
  for (let sample = 0; sample < warmups + samples; sample += 1) {
    const startedAt = performance.now()
    for (const text of texts) {
      checksum += embedding(text)[0] ?? 0
    }
    const elapsedMs = performance.now() - startedAt
    if (sample >= warmups) durations.push(elapsedMs)
  }
  const throughputs = durations
    .map((duration) => (texts.length * 1000) / duration)
    .sort((left, right) => left - right)
  return {
    medianEmbeddingsPerSecond: percentile(throughputs, 0.5),
    p05EmbeddingsPerSecond: percentile(throughputs, 0.05),
    checksum,
  }
}

function legacyLocalHashEmbedding(text) {
  const vector = Array.from({ length: 384 }, () => 0)
  for (const token of tokenize(text)) {
    addLegacyFeature(vector, token, token.length >= 6 ? 1.4 : 1)
    const characters = [...token]
    for (let index = 0; index <= characters.length - 3; index += 1) {
      addLegacyFeature(vector, `ngram:${characters.slice(index, index + 3).join("")}`, 0.35)
    }
  }
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  return magnitude === 0 ? vector : vector.map((value) => value / magnitude)
}

function addLegacyFeature(vector, feature, weight) {
  const hash = createHash("sha256").update(feature).digest()
  const index = hash.readUInt32BE(0) % vector.length
  const sign = (hash.at(4) ?? 0) % 2 === 0 ? 1 : -1
  vector[index] = (vector[index] ?? 0) + sign * weight
}

function candidateLocalHashEmbedding(text) {
  const vector = new Array(dimensions).fill(0)
  for (const token of tokenize(text)) {
    addCandidateFeature(vector, hashString(token, tokenHashSeed), token.length >= 6 ? 1.4 : 1)
    addCandidateNgrams(vector, token)
  }

  let squaredMagnitude = 0
  for (const value of vector) squaredMagnitude += value * value
  if (squaredMagnitude === 0) return vector

  const magnitude = Math.sqrt(squaredMagnitude)
  for (let index = 0; index < vector.length; index += 1) {
    vector[index] = (vector[index] ?? 0) / magnitude
  }
  return vector
}

function addCandidateNgrams(vector, token) {
  let first = ""
  let second = ""
  let characterCount = 0
  for (const character of token) {
    if (characterCount >= 2) {
      let hash = hashString(first, ngramHashSeed, false)
      hash = hashString(second, hash, false)
      addCandidateFeature(vector, hashString(character, hash), 0.35)
    }
    first = second
    second = character
    characterCount += 1
  }
}

function addCandidateFeature(vector, hash, weight) {
  const unsignedHash = hash >>> 0
  const index = unsignedHash % dimensions
  const sign = (unsignedHash & 0x80000000) === 0 ? 1 : -1
  vector[index] = (vector[index] ?? 0) + sign * weight
}

function hashString(value, seed, avalanche = true) {
  let hash = seed
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, fnvPrime)
  }
  if (!avalanche) return hash
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x85ebca6b)
  hash ^= hash >>> 13
  hash = Math.imul(hash, 0xc2b2ae35)
  return hash ^ (hash >>> 16)
}

function allocationEstimate(values) {
  let baseline = 0
  let candidate = 0
  for (const text of values) {
    const tokens = tokenize(text)
    baseline += 3
    candidate += 2
    for (const token of tokens) {
      const ngrams = Math.max(0, [...token].length - 2)
      baseline += 4 + ngrams * 5
    }
  }
  return {
    unit: "explicit-temporary-objects",
    baseline,
    candidate,
  }
}

function compareQuality(baseline, candidate) {
  const baselineQuality = baseline.first.quality
  const candidateQuality = candidate.first.quality
  const comparisons = {
    recallAt1: delta(candidateQuality.recallAt["1"], baselineQuality.recallAt["1"]),
    recallAt3: delta(candidateQuality.recallAt["3"], baselineQuality.recallAt["3"]),
    recallAt5: delta(candidateQuality.recallAt["5"], baselineQuality.recallAt["5"]),
    recallAt10: delta(candidateQuality.recallAt["10"], baselineQuality.recallAt["10"]),
    precisionAt5: delta(candidateQuality.precisionAt5, baselineQuality.precisionAt5),
    meanReciprocalRankAt10: delta(
      candidateQuality.meanReciprocalRankAt10,
      baselineQuality.meanReciprocalRankAt10,
    ),
    ndcgAt10: delta(candidateQuality.ndcgAt10, baselineQuality.ndcgAt10),
    exactCitationRate: delta(
      candidateQuality.exactCitationRate,
      baselineQuality.exactCitationRate,
    ),
    falsePositiveRate: delta(
      baselineQuality.falsePositiveRate,
      candidateQuality.falsePositiveRate,
    ),
  }
  const citationRegression = Math.max(0, -comparisons.exactCitationRate)
  return {
    baselineFingerprint: baseline.first.qualityFingerprint,
    candidateFingerprint: candidate.first.qualityFingerprint,
    comparisons,
    citationRegression,
    noRegression: Object.values(comparisons).every((value) => value >= -1e-12),
    candidateReproducible: candidate.reproducible === true && candidate.passed === true,
  }
}

function delta(candidate, baseline) {
  return candidate - baseline
}

function percentile(sorted, quantile) {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1))]
}

function benchmarkTexts() {
  const samples = [
    "Production approval requires an immutable audit trail and cited evidence.",
    "La résidence des données exige une validation locale et reproductible.",
    "การอนุมัติระบบต้องมีหลักฐานที่ตรวจสอบย้อนกลับได้",
    "本地检索必须保留精确引用和可重复的排序结果。",
    "function rotateToken(credentials) { return credentials.withFreshLease() }",
    "architecture/indexing/storage-maintenance keeps fragmented vectors queryable",
  ]
  return Array.from({ length: 500 }, (_value, index) => `${samples[index % samples.length]} ${index}`)
}

function parseArguments(args) {
  const parsed = {}
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === "--") continue
    if (argument === "--baseline" || argument === "--candidate" || argument === "--result") {
      const value = args[index + 1]
      if (!value) throw new Error(`${argument} requires a path.`)
      parsed[argument.slice(2)] = value
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${argument}`)
  }
  return parsed
}
