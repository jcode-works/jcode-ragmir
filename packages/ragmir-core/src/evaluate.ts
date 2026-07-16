import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { recordAccess } from "./access-log.js"
import { loadConfig } from "./config.js"
import { RagmirError } from "./errors.js"
import { operationSignal, throwIfAborted } from "./operation.js"
import { search } from "./query.js"
import type {
  EvaluationCaseResult,
  EvaluationOptions,
  EvaluationResult,
  GoldenQuery,
} from "./types.js"

export const MAX_GOLDEN_FILE_BYTES = 1_048_576
export const MAX_GOLDEN_CASES = 100
export const MAX_GOLDEN_QUERY_CHARACTERS = 20_000
export const MAX_GOLDEN_EXPECTED_VALUES = 100
export const MAX_GOLDEN_EXPECTED_VALUE_CHARACTERS = 500

const expectedValueSchema = z.string().min(1).max(MAX_GOLDEN_EXPECTED_VALUE_CHARACTERS)

const goldenQuerySchema = z
  .object({
    id: z.string().min(1).optional(),
    query: z.string().min(1).max(MAX_GOLDEN_QUERY_CHARACTERS),
    expectedPaths: z.array(expectedValueSchema).min(1).max(MAX_GOLDEN_EXPECTED_VALUES),
    expectedCitations: z
      .array(expectedValueSchema)
      .min(1)
      .max(MAX_GOLDEN_EXPECTED_VALUES)
      .optional(),
    includePaths: z.array(z.string().min(1).max(500)).max(20).optional(),
    excludePaths: z.array(z.string().min(1).max(500)).max(20).optional(),
    contextPaths: z.array(z.string().min(1).max(500)).max(20).optional(),
    topK: z.number().int().positive().optional(),
  })
  .strict()

const goldenFileSchema = z.union([
  z.array(goldenQuerySchema).min(1).max(MAX_GOLDEN_CASES),
  z
    .object({
      topK: z.number().int().positive().optional(),
      queries: z.array(goldenQuerySchema).min(1).max(MAX_GOLDEN_CASES),
    })
    .strict(),
])

export async function evaluateGoldenQueries(options: EvaluationOptions): Promise<EvaluationResult> {
  const signal = operationSignal(options)
  throwIfAborted(signal)
  const cwd = path.resolve(String(options.cwd ?? process.cwd()))
  const config = await loadConfig(cwd)
  throwIfAborted(signal)
  const goldenPath = path.resolve(cwd, String(options.goldenPath))
  const goldenFile = await readGoldenFile(goldenPath, signal)
  throwIfAborted(signal)
  const defaultTopK = boundedTopK(options.topK ?? goldenFile.topK ?? 3, options.maxTopK)
  const cases: EvaluationCaseResult[] = []

  for (const goldenQuery of goldenFile.queries) {
    throwIfAborted(signal)
    const topK = boundedTopK(goldenQuery.topK ?? defaultTopK, options.maxTopK)
    const startedAt = performance.now()
    const results = await search(goldenQuery.query, {
      cwd,
      topK,
      ...(signal === undefined ? {} : { signal }),
      ...(goldenQuery.includePaths === undefined ? {} : { includePaths: goldenQuery.includePaths }),
      ...(goldenQuery.excludePaths === undefined ? {} : { excludePaths: goldenQuery.excludePaths }),
      ...(goldenQuery.contextPaths === undefined ? {} : { contextPaths: goldenQuery.contextPaths }),
    })
    throwIfAborted(signal)
    const latencyMs = performance.now() - startedAt
    const returnedPaths = results.map((result) => result.relativePath)
    const returnedCitations = results.map(citationForResult)
    const expectedCitations = goldenQuery.expectedCitations ?? []
    const requiresExactCitation = expectedCitations.length > 0
    const expectedValues = requiresExactCitation ? expectedCitations : goldenQuery.expectedPaths
    const matchedPaths = returnedPaths.filter((resultPath) =>
      goldenQuery.expectedPaths.includes(resultPath),
    )
    const matchedCitations = returnedCitations.filter((citation) =>
      expectedCitations.includes(citation),
    )
    const bestRank = requiresExactCitation
      ? returnedCitations.findIndex((citation) => expectedCitations.includes(citation)) + 1
      : returnedPaths.findIndex((resultPath) => goldenQuery.expectedPaths.includes(resultPath)) + 1
    const reciprocalRank = bestRank > 0 ? 1 / bestRank : 0
    const returnedValues = requiresExactCitation ? returnedCitations : returnedPaths
    const uniqueReturnedValues = [...new Set(returnedValues.slice(0, topK))]
    const expectedSet = new Set(expectedValues)
    const matchedRelevant = uniqueReturnedValues.filter((value) => expectedSet.has(value))
    const recall = expectedSet.size === 0 ? 0 : matchedRelevant.length / expectedSet.size
    const precision =
      uniqueReturnedValues.length === 0 ? 0 : matchedRelevant.length / uniqueReturnedValues.length
    const ndcg = ndcgAtK(returnedValues, expectedValues, topK)

    const result: EvaluationCaseResult = {
      query: goldenQuery.query,
      expectedPaths: goldenQuery.expectedPaths,
      topK,
      returnedPaths,
      returnedCitations,
      matchedPaths,
      matchedCitations,
      hit: requiresExactCitation ? matchedCitations.length > 0 : matchedPaths.length > 0,
      bestRank: bestRank > 0 ? bestRank : null,
      reciprocalRank,
      recall,
      precision,
      ndcg,
      latencyMs,
    }
    if (goldenQuery.id !== undefined) {
      result.id = goldenQuery.id
    }
    if (goldenQuery.expectedCitations !== undefined) {
      result.expectedCitations = goldenQuery.expectedCitations
    }
    if (goldenQuery.includePaths !== undefined) {
      result.includePaths = goldenQuery.includePaths
    }
    if (goldenQuery.excludePaths !== undefined) {
      result.excludePaths = goldenQuery.excludePaths
    }
    if (goldenQuery.contextPaths !== undefined) {
      result.contextPaths = goldenQuery.contextPaths
    }
    cases.push(result)
  }

  const hits = cases.filter((result) => result.hit).length
  const latencies = cases.map((result) => result.latencyMs).sort((a, b) => a - b)
  throwIfAborted(signal)
  await recordAccess(config, {
    action: "evaluate",
    topK: defaultTopK,
    resultCount: cases.length,
  })
  throwIfAborted(signal)
  return {
    goldenPath,
    embeddingProvider: config.embeddingProvider,
    embeddingModel: config.embeddingModel,
    topK: defaultTopK,
    total: cases.length,
    hits,
    misses: cases.length - hits,
    hitRate: hits / cases.length,
    recall: mean(cases.map((result) => result.recall)),
    precision: mean(cases.map((result) => result.precision)),
    meanReciprocalRank: mean(cases.map((result) => result.reciprocalRank)),
    ndcg: mean(cases.map((result) => result.ndcg)),
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    cases,
  }
}

async function readGoldenFile(
  goldenPath: string,
  signal: AbortSignal | undefined,
): Promise<{ topK?: number; queries: GoldenQuery[] }> {
  let size: number
  try {
    size = (await stat(goldenPath)).size
  } catch (error) {
    throwIfAborted(signal)
    throw error
  }
  throwIfAborted(signal)
  if (size > MAX_GOLDEN_FILE_BYTES) {
    throw new RagmirError(
      "INVALID_ARGUMENT",
      `Golden file must not exceed ${MAX_GOLDEN_FILE_BYTES} bytes.`,
    )
  }

  let raw: string
  try {
    raw = await readFile(goldenPath, { encoding: "utf8", signal })
  } catch (error) {
    throwIfAborted(signal)
    throw error
  }
  throwIfAborted(signal)
  const parsed = goldenFileSchema.parse(JSON.parse(raw))

  if (Array.isArray(parsed)) {
    return { queries: parsed.map(normalizeGoldenQuery) }
  }

  const result = { queries: parsed.queries.map(normalizeGoldenQuery) }
  if (parsed.topK !== undefined) {
    return { ...result, topK: parsed.topK }
  }
  return result
}

function normalizeGoldenQuery(value: z.infer<typeof goldenQuerySchema>): GoldenQuery {
  const result: GoldenQuery = {
    query: value.query,
    expectedPaths: value.expectedPaths,
  }
  if (value.expectedCitations !== undefined) {
    result.expectedCitations = value.expectedCitations
  }
  if (value.id !== undefined) {
    result.id = value.id
  }
  if (value.topK !== undefined) {
    result.topK = value.topK
  }
  if (value.includePaths !== undefined) {
    result.includePaths = value.includePaths
  }
  if (value.excludePaths !== undefined) {
    result.excludePaths = value.excludePaths
  }
  if (value.contextPaths !== undefined) {
    result.contextPaths = value.contextPaths
  }
  return result
}

function boundedTopK(topK: number, maxTopK: number | undefined): number {
  return maxTopK === undefined ? topK : Math.min(topK, maxTopK)
}

function citationForResult(result: { citation: string }): string {
  return result.citation
}

function ndcgAtK(returned: string[], expected: string[], topK: number): number {
  const expectedSet = new Set(expected)
  const returnedAtK = returned.slice(0, topK)
  const seen = new Set<string>()
  const dcg = returnedAtK.reduce((score, value, index) => {
    if (!expectedSet.has(value) || seen.has(value)) {
      return score
    }
    seen.add(value)
    return score + 1 / Math.log2(index + 2)
  }, 0)
  const idealMatches = Math.min(expectedSet.size, topK)
  const idealDcg = Array.from(
    { length: idealMatches },
    (_value, index) => 1 / Math.log2(index + 2),
  ).reduce((score, gain) => score + gain, 0)
  return idealDcg === 0 ? 0 : dcg / idealDcg
}

function percentile(sortedValues: number[], quantile: number): number {
  if (sortedValues.length === 0) {
    return 0
  }
  const index = Math.ceil(quantile * sortedValues.length) - 1
  return sortedValues[Math.max(0, index)] ?? 0
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
}
