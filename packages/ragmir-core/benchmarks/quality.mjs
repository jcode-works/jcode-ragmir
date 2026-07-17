import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createRagmirClient, evaluateGoldenQueries } from "../dist/index.js"
import { CORPUS_PRESETS, generateCorpus } from "./lib/corpus.mjs"
import { environmentMetadata, sha256, stableJson } from "./lib/metrics.mjs"

const options = parseArguments(process.argv.slice(2))
const invocationRoot = process.env.INIT_CWD ?? process.cwd()
const size = String(options.size ?? "S").toUpperCase()
if (!(size in CORPUS_PRESETS)) {
  throw new Error(`Unknown corpus size: ${size}`)
}
const provider = String(options.provider ?? "local-hash")
if (provider !== "local-hash" && provider !== "transformers") {
  throw new Error(`Unknown embedding provider: ${provider}`)
}
const seed = String(options.seed ?? "ragmir-benchmark-v1")
const model = String(options.model ?? "intfloat/multilingual-e5-small")
const modelRevision = String(options.modelRevision ?? "main")
const retrievalProfile = String(options.profile ?? "balanced")
if (!["fast", "balanced", "quality", "custom"].includes(retrievalProfile)) {
  throw new Error(`Unknown retrieval profile: ${retrievalProfile}`)
}
const modelPath = path.resolve(
  options.modelPath ?? path.join(invocationRoot, ".ragmir", "models"),
)
const resultPath = path.resolve(
  invocationRoot,
  options.result ??
    `packages/ragmir-core/benchmarks/.results/quality-${size}-${provider}.json`,
)
const roots = []

try {
  const first = await runCleanEvaluation("first")
  const second = await runCleanEvaluation("second")
  const reproducible =
    first.corpusHash === second.corpusHash &&
    first.qualityFingerprint === second.qualityFingerprint &&
    first.rankingVariantsFingerprint === second.rankingVariantsFingerprint
  const result = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    environment: environmentMetadata(),
    configuration: { size, provider, model, modelRevision, retrievalProfile, seed },
    reproducible,
    first,
    second,
    passed: reproducible && first.quality.passed && second.quality.passed,
  }
  await mkdir(path.dirname(resultPath), { recursive: true })
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8")
  process.stdout.write(`${JSON.stringify({ resultPath, ...result }, null, 2)}\n`)
  if (!result.passed) {
    process.exitCode = 1
  }
} finally {
  if (options.keep === true) {
    for (const root of roots) {
      process.stderr.write(`Quality project preserved at ${root}\n`)
    }
  } else {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
  }
}

async function runCleanEvaluation(label) {
  const root = await mkdtemp(path.join(os.tmpdir(), `ragmir-quality-${label}-`))
  roots.push(root)
  const corpus = await generateCorpus({
    root,
    targetChunks: CORPUS_PRESETS[size],
    seed,
    provider,
    model,
    modelRevision,
    modelPath,
    goldenCount: 100,
    retrievalProfile,
  })
  const client = await createRagmirClient({ cwd: root })
  let ingest
  let evaluation
  let rankingVariants
  try {
    ingest = await client.ingest({ rebuild: true })
    evaluation = await evaluateGoldenQueries({
      cwd: root,
      goldenPath: corpus.goldenPath,
      topK: 10,
    })
    rankingVariants = await evaluateRankingVariants(client, corpus.goldenQueries)
  } finally {
    await client.close()
  }
  if (!ingest || !evaluation || !rankingVariants) {
    throw new Error("Quality evaluation did not complete.")
  }
  const quality = reproducibleQuality(evaluation)
  return {
    corpusHash: corpus.corpusHash,
    goldenFingerprint: evaluation.goldenFingerprint,
    actualChunks: ingest.chunks,
    files: ingest.indexedFiles,
    latency: {
      p50Ms: evaluation.p50LatencyMs,
      p95Ms: evaluation.p95LatencyMs,
    },
    qualityFingerprint: sha256(stableJson(quality)),
    rankingVariantsFingerprint: sha256(stableJson(rankingVariants)),
    rankingVariants,
    quality,
  }
}

async function evaluateRankingVariants(client, goldenQueries) {
  const variants = {
    "vector-only": [],
    "lexical-only": [],
    hybrid: [],
    "hybrid-lexical-1.25": [],
    "hybrid-lexical-1.5": [],
    "hybrid-lexical-2": [],
    "diversity-fixed-cap-2": [],
    "diversity-soft-mmr-0.85": [],
  }
  for (const testCase of goldenQueries) {
    const rows = await client.search(testCase.query, {
      topK: 100,
      explain: true,
      ...(testCase.includePaths === undefined ? {} : { includePaths: testCase.includePaths }),
      ...(testCase.excludePaths === undefined ? {} : { excludePaths: testCase.excludePaths }),
      ...(testCase.contextPaths === undefined ? {} : { contextPaths: testCase.contextPaths }),
    })
    const stableRows = (compare, eligible = () => true) =>
      [...rows]
        .filter((row) => row.score !== undefined && eligible(row))
        .sort(
          (left, right) =>
            compare(left, right) ||
            left.relativePath.localeCompare(right.relativePath) ||
            left.chunkIndex - right.chunkIndex,
        )
        .slice(0, 10)
    variants["vector-only"].push(
      scoreVariantCase(
        testCase,
        stableRows(
          (left, right) =>
            (left.score?.vectorRank ?? Number.POSITIVE_INFINITY) -
            (right.score?.vectorRank ?? Number.POSITIVE_INFINITY),
          (row) => row.score?.vectorRank !== null,
        ),
      ),
    )
    variants["lexical-only"].push(
      scoreVariantCase(
        testCase,
        stableRows(
          (left, right) =>
            (left.score?.lexicalRank ?? Number.POSITIVE_INFINITY) -
            (right.score?.lexicalRank ?? Number.POSITIVE_INFINITY),
          (row) => row.score?.lexicalRank !== null,
        ),
      ),
    )
    variants.hybrid.push(scoreVariantCase(testCase, rows.slice(0, 10)))
    variants["diversity-fixed-cap-2"].push(
      scoreVariantCase(testCase, fixedSourceCapRows(rows, 10, 2)),
    )
    variants["diversity-soft-mmr-0.85"].push(
      scoreVariantCase(testCase, softMmrRows(rows, 10, 0.85)),
    )
    for (const [name, lexicalWeight] of [
      ["hybrid-lexical-1.25", 1.25],
      ["hybrid-lexical-1.5", 1.5],
      ["hybrid-lexical-2", 2],
    ]) {
      variants[name].push(
        scoreVariantCase(
          testCase,
          stableRows(
            (left, right) =>
              (right.score?.vectorContribution ?? 0) +
              (right.score?.lexicalContribution ?? 0) * lexicalWeight -
              ((left.score?.vectorContribution ?? 0) +
                (left.score?.lexicalContribution ?? 0) * lexicalWeight),
          ),
        ),
      )
    }
  }
  return Object.fromEntries(
    Object.entries(variants).map(([name, cases]) => {
      const answerable = cases.filter((testCase) => testCase.answerable)
      const unanswerable = cases.filter((testCase) => !testCase.answerable)
      return [
        name,
        {
          recallAt5: mean(answerable.map((testCase) => testCase.recallAt5)),
          recallAt10: mean(answerable.map((testCase) => testCase.recall)),
          meanReturned: mean(cases.map((testCase) => testCase.returned)),
          falsePositiveRate: mean(unanswerable.map((testCase) => Number(testCase.returned > 0))),
        },
      ]
    }),
  )
}

function scoreVariantCase(testCase, rows) {
  const expectedPaths = testCase.expectedPaths ?? []
  const returnedPaths = new Set(rows.map((row) => row.relativePath))
  const returnedPathsAt5 = new Set(rows.slice(0, 5).map((row) => row.relativePath))
  const answerable = testCase.answerable !== false && expectedPaths.length > 0
  return {
    answerable,
    recallAt5:
      expectedPaths.length === 0
        ? Number(rows.length === 0)
        : expectedPaths.filter((expectedPath) => returnedPathsAt5.has(expectedPath)).length /
          expectedPaths.length,
    recall:
      expectedPaths.length === 0
        ? Number(rows.length === 0)
        : expectedPaths.filter((expectedPath) => returnedPaths.has(expectedPath)).length /
          expectedPaths.length,
    returned: rows.length,
  }
}

function fixedSourceCapRows(rows, limit, perSourceLimit) {
  const selected = []
  const sourceCounts = new Map()
  for (const row of rows) {
    const sourceCount = sourceCounts.get(row.relativePath) ?? 0
    if (sourceCount >= perSourceLimit) {
      continue
    }
    selected.push(row)
    sourceCounts.set(row.relativePath, sourceCount + 1)
    if (selected.length >= limit) {
      break
    }
  }
  return selected
}

function softMmrRows(rows, limit, relevanceWeight) {
  const candidates = rows.map((row, rank) => ({ row, rank, tokens: lexicalTokens(row.text) }))
  const selected = []
  while (selected.length < limit && candidates.length > 0) {
    candidates.sort((left, right) => {
      const relevanceDifference =
        softMmrScore(right, selected, rows.length, relevanceWeight) -
        softMmrScore(left, selected, rows.length, relevanceWeight)
      return (
        relevanceDifference ||
        left.rank - right.rank ||
        left.row.relativePath.localeCompare(right.row.relativePath) ||
        left.row.chunkIndex - right.row.chunkIndex
      )
    })
    const next = candidates.shift()
    if (next) {
      selected.push(next)
    }
  }
  return selected.map((candidate) => candidate.row)
}

function softMmrScore(candidate, selected, candidateCount, relevanceWeight) {
  const relevance = 1 - candidate.rank / Math.max(1, candidateCount)
  const maximumRedundancy = selected.reduce(
    (maximum, selectedCandidate) =>
      Math.max(maximum, candidateRedundancy(candidate, selectedCandidate)),
    0,
  )
  return relevanceWeight * relevance - (1 - relevanceWeight) * maximumRedundancy
}

function candidateRedundancy(left, right) {
  if (left.row.relativePath === right.row.relativePath) {
    return 1
  }
  if (left.tokens.size === 0 || right.tokens.size === 0) {
    return 0
  }
  let intersection = 0
  for (const token of left.tokens) {
    if (right.tokens.has(token)) {
      intersection += 1
    }
  }
  return intersection / (left.tokens.size + right.tokens.size - intersection)
}

function lexicalTokens(value) {
  return new Set(value.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [])
}

function mean(values) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
}

function reproducibleQuality(result) {
  return {
    total: result.total,
    hits: result.hits,
    misses: result.misses,
    recallAt: result.recallAt,
    precisionAt5: result.precisionAt5,
    meanReciprocalRankAt10: result.meanReciprocalRankAt10,
    ndcgAt10: result.ndcgAt10,
    exactCitationRate: result.exactCitationRate,
    falsePositiveRate: result.falsePositiveRate,
    abstentionAccuracy: result.abstentionAccuracy,
    thresholds: result.thresholds,
    gates: result.gates,
    groups: result.groups,
    passed: result.passed,
    verificationEligible: result.verificationEligible,
    rankingPolicyFingerprint: result.rankingPolicyFingerprint,
    cases: result.cases.map((testCase) => ({
      id: testCase.id,
      category: testCase.category,
      locale: testCase.locale,
      answerable: testCase.answerable,
      returnedPaths: testCase.returnedPaths,
      returnedCitations: testCase.returnedCitations,
      recallAt: testCase.recallAt,
      precisionAt5: testCase.precisionAt5,
      reciprocalRankAt10: testCase.reciprocalRankAt10,
      ndcgAt10: testCase.ndcgAt10,
      abstained: testCase.abstained,
    })),
  }
}

function parseArguments(values) {
  const parsed = {}
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (!value?.startsWith("--")) {
      continue
    }
    const key = value.slice(2).replace(/-([a-z])/gu, (_match, letter) => letter.toUpperCase())
    const next = values[index + 1]
    if (next === undefined || next.startsWith("--")) {
      parsed[key] = true
    } else {
      parsed[key] = next
      index += 1
    }
  }
  return parsed
}
