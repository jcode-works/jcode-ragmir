import { readFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { recordAccess } from "./access-log.js"
import { loadConfig } from "./config.js"
import { search } from "./query.js"
import type {
  EvaluationCaseResult,
  EvaluationOptions,
  EvaluationResult,
  GoldenQuery,
} from "./types.js"

const goldenQuerySchema = z
  .object({
    id: z.string().min(1).optional(),
    query: z.string().min(1),
    expectedPaths: z.array(z.string().min(1)).min(1),
    expectedCitations: z.array(z.string().min(1)).min(1).optional(),
    topK: z.number().int().positive().optional(),
  })
  .strict()

const goldenFileSchema = z.union([
  z.array(goldenQuerySchema).min(1),
  z
    .object({
      topK: z.number().int().positive().optional(),
      queries: z.array(goldenQuerySchema).min(1),
    })
    .strict(),
])

export async function evaluateGoldenQueries(options: EvaluationOptions): Promise<EvaluationResult> {
  const cwd = path.resolve(String(options.cwd ?? process.cwd()))
  const config = await loadConfig(cwd)
  const goldenPath = path.resolve(cwd, String(options.goldenPath))
  const goldenFile = await readGoldenFile(goldenPath)
  const defaultTopK = boundedTopK(options.topK ?? goldenFile.topK ?? 3, options.maxTopK)
  const cases: EvaluationCaseResult[] = []

  for (const goldenQuery of goldenFile.queries) {
    const topK = boundedTopK(goldenQuery.topK ?? defaultTopK, options.maxTopK)
    const results = await search(goldenQuery.query, { cwd, topK })
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
    const ndcg = ndcgAtK(
      requiresExactCitation ? returnedCitations : returnedPaths,
      expectedValues,
      topK,
    )

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
      ndcg,
    }
    if (goldenQuery.id !== undefined) {
      result.id = goldenQuery.id
    }
    if (goldenQuery.expectedCitations !== undefined) {
      result.expectedCitations = goldenQuery.expectedCitations
    }
    cases.push(result)
  }

  const hits = cases.filter((result) => result.hit).length
  await recordAccess(config, {
    action: "evaluate",
    topK: defaultTopK,
    resultCount: cases.length,
  })
  return {
    goldenPath,
    embeddingProvider: config.embeddingProvider,
    embeddingModel: config.embeddingModel,
    topK: defaultTopK,
    total: cases.length,
    hits,
    misses: cases.length - hits,
    recall: hits / cases.length,
    meanReciprocalRank: mean(cases.map((result) => result.reciprocalRank)),
    ndcg: mean(cases.map((result) => result.ndcg)),
    cases,
  }
}

async function readGoldenFile(
  goldenPath: string,
): Promise<{ topK?: number; queries: GoldenQuery[] }> {
  const raw = await readFile(goldenPath, "utf8")
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
  const dcg = returnedAtK.reduce((score, value, index) => {
    if (!expectedSet.has(value)) {
      return score
    }
    return score + 1 / Math.log2(index + 2)
  }, 0)
  const idealMatches = Math.min(expectedSet.size, topK)
  const idealDcg = Array.from(
    { length: idealMatches },
    (_value, index) => 1 / Math.log2(index + 2),
  ).reduce((score, gain) => score + gain, 0)
  return idealDcg === 0 ? 0 : dcg / idealDcg
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
}
