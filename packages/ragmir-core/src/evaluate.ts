import { createHash } from "node:crypto"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { recordAccess } from "./access-log.js"
import { loadConfig } from "./config.js"
import { RagmirError } from "./errors.js"
import { withIndexWriteLock } from "./index-write-lock.js"
import { operationSignal, throwIfAborted } from "./operation.js"
import { fingerprintIndexManifest, fingerprintQualityReport } from "./quality-report.js"
import { search } from "./query.js"
import { readIndexManifest, writeIndexManifest } from "./store.js"
import type {
  EvaluationCaseResult,
  EvaluationGroupResult,
  EvaluationOptions,
  EvaluationResult,
  GoldenQuery,
  IndexQualityReport,
  QualityGateResult,
  QualityMetricThresholds,
  RelevanceJudgment,
  SearchResult,
} from "./types.js"

export const MAX_GOLDEN_FILE_BYTES = 16_777_216
export const MAX_GOLDEN_CASES = 1_000
export const MAX_GOLDEN_QUERY_CHARACTERS = 20_000
export const MAX_GOLDEN_EXPECTED_VALUES = 100
export const MAX_GOLDEN_EXPECTED_VALUE_CHARACTERS = 500

const EVALUATION_DEPTH = 10
const DEFAULT_MINIMUM_VERIFICATION_CASES = 100
const expectedValueSchema = z.string().min(1).max(MAX_GOLDEN_EXPECTED_VALUE_CHARACTERS)
const unitMetricSchema = z.number().min(0).max(1)

const relevanceJudgmentSchema = z
  .object({
    kind: z.enum(["path", "citation"]),
    value: expectedValueSchema,
    relevance: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  })
  .strict()

const qualityThresholdSchema = z
  .object({
    recallAt1: unitMetricSchema.optional(),
    recallAt3: unitMetricSchema.optional(),
    recallAt5: unitMetricSchema.optional(),
    recallAt10: unitMetricSchema.optional(),
    precisionAt5: unitMetricSchema.optional(),
    meanReciprocalRankAt10: unitMetricSchema.optional(),
    ndcgAt10: unitMetricSchema.optional(),
    exactCitationRate: unitMetricSchema.optional(),
    maximumFalsePositiveRate: unitMetricSchema.optional(),
  })
  .strict()

const goldenQuerySchema = z
  .object({
    id: z.string().min(1).optional(),
    query: z.string().min(1).max(MAX_GOLDEN_QUERY_CHARACTERS),
    expectedPaths: z.array(expectedValueSchema).max(MAX_GOLDEN_EXPECTED_VALUES).default([]),
    expectedCitations: z
      .array(expectedValueSchema)
      .min(1)
      .max(MAX_GOLDEN_EXPECTED_VALUES)
      .optional(),
    answerable: z.boolean().optional(),
    category: z.string().min(1).max(100).optional(),
    locale: z.string().min(2).max(50).optional(),
    relevanceJudgments: z.array(relevanceJudgmentSchema).max(MAX_GOLDEN_EXPECTED_VALUES).optional(),
    maximumVectorDistance: z.number().nonnegative().optional(),
    includePaths: z.array(z.string().min(1).max(500)).max(20).optional(),
    excludePaths: z.array(z.string().min(1).max(500)).max(20).optional(),
    contextPaths: z.array(z.string().min(1).max(500)).max(20).optional(),
    topK: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const answerable = value.answerable ?? true
    const positiveJudgments = (value.relevanceJudgments ?? []).filter(
      (judgment) => judgment.relevance > 0,
    )
    if (
      answerable &&
      value.expectedPaths.length === 0 &&
      value.expectedCitations === undefined &&
      positiveJudgments.length === 0
    ) {
      context.addIssue({
        code: "custom",
        message: "Answerable golden queries require at least one relevant path or citation.",
        path: ["expectedPaths"],
      })
    }
    if (!answerable && (value.expectedPaths.length > 0 || positiveJudgments.length > 0)) {
      context.addIssue({
        code: "custom",
        message: "Unanswerable golden queries cannot declare relevant evidence.",
        path: ["answerable"],
      })
    }
  })

const wrappedGoldenFileSchema = z
  .object({
    topK: z.number().int().positive().optional(),
    minimumCasesForVerification: z.number().int().positive().max(MAX_GOLDEN_CASES).optional(),
    thresholds: qualityThresholdSchema.optional(),
    queries: z.array(goldenQuerySchema).min(1).max(MAX_GOLDEN_CASES),
  })
  .strict()

const goldenFileSchema = z.union([
  z.array(goldenQuerySchema).min(1).max(MAX_GOLDEN_CASES),
  wrappedGoldenFileSchema,
])

interface GoldenFile {
  topK?: number
  minimumCasesForVerification: number
  thresholds: QualityMetricThresholds
  queries: GoldenQuery[]
  fingerprint: string
}

interface EvaluationMetrics {
  recallAt1: number
  recallAt3: number
  recallAt5: number
  recallAt10: number
  precisionAt5: number
  meanReciprocalRankAt10: number
  ndcgAt10: number
  exactCitationRate: number | null
  falsePositiveRate: number | null
}

export async function evaluateGoldenQueries(options: EvaluationOptions): Promise<EvaluationResult> {
  const signal = operationSignal(options)
  throwIfAborted(signal)
  const cwd = path.resolve(String(options.cwd ?? process.cwd()))
  const config = await loadConfig(cwd)
  throwIfAborted(signal)
  const goldenPath = path.resolve(cwd, String(options.goldenPath))
  const [goldenFile, initialManifest] = await Promise.all([
    readGoldenFile(goldenPath, signal),
    readIndexManifest(config),
  ])
  throwIfAborted(signal)
  const indexFingerprint = initialManifest
    ? fingerprintIndexManifest(initialManifest)
    : "missing-index"
  const defaultTopK = boundedTopK(options.topK ?? goldenFile.topK ?? 3, options.maxTopK)
  const cases: EvaluationCaseResult[] = []

  for (const goldenQuery of goldenFile.queries) {
    throwIfAborted(signal)
    const topK = boundedTopK(goldenQuery.topK ?? defaultTopK, options.maxTopK)
    const evaluationDepth = boundedTopK(Math.max(topK, EVALUATION_DEPTH), options.maxTopK)
    const startedAt = performance.now()
    const results = await search(goldenQuery.query, {
      cwd,
      topK: evaluationDepth,
      ...(signal === undefined ? {} : { signal }),
      ...(goldenQuery.includePaths === undefined ? {} : { includePaths: goldenQuery.includePaths }),
      ...(goldenQuery.excludePaths === undefined ? {} : { excludePaths: goldenQuery.excludePaths }),
      ...(goldenQuery.contextPaths === undefined ? {} : { contextPaths: goldenQuery.contextPaths }),
    })
    throwIfAborted(signal)
    cases.push(
      evaluateCase(
        goldenQuery,
        applyVectorDistancePolicy(results, goldenQuery.maximumVectorDistance),
        topK,
        performance.now() - startedAt,
      ),
    )
  }

  const answerableCases = cases.filter((result) => result.answerable)
  const unanswerableCases = cases.filter((result) => !result.answerable)
  const citationCases = answerableCases.filter((result) => result.exactCitationHit !== null)
  const gradedCases = answerableCases.filter((result) =>
    result.relevanceJudgments.some((judgment) => judgment.relevance > 1),
  )
  const metrics = evaluationMetrics(answerableCases, unanswerableCases, citationCases)
  const thresholds = { ...goldenFile.thresholds, ...options.thresholds }
  const gates = qualityGates(metrics, thresholds)
  const passed = gates.every((gate) => gate.passed)
  const requiredThresholdSet = completeThresholdSet(thresholds)
  const relativeGoldenPath = projectRelativePath(config.projectRoot, goldenPath)
  const verificationEligible =
    initialManifest !== null &&
    (initialManifest.staleFiles?.length ?? 0) === 0 &&
    relativeGoldenPath !== null &&
    cases.length >= goldenFile.minimumCasesForVerification &&
    answerableCases.length > 0 &&
    unanswerableCases.length > 0 &&
    citationCases.length > 0 &&
    gradedCases.length > 0 &&
    (options.maxTopK === undefined || options.maxTopK >= EVALUATION_DEPTH) &&
    requiredThresholdSet !== null

  const storedReport =
    verificationEligible &&
    passed &&
    options.persistCompatibleReport !== false &&
    initialManifest !== null &&
    relativeGoldenPath !== null &&
    requiredThresholdSet !== null
      ? await persistQualityReport({
          config,
          indexFingerprint,
          goldenPath: relativeGoldenPath,
          goldenFingerprint: goldenFile.fingerprint,
          metrics,
          thresholds: requiredThresholdSet,
          total: cases.length,
          signal,
        })
      : null

  const hits = cases.filter((result) => result.hit).length
  const latencies = cases.map((result) => result.latencyMs).sort((a, b) => a - b)
  const recall = mean(answerableCases.map((result) => result.recall))
  const precision = mean(answerableCases.map((result) => result.precision))
  const meanReciprocalRank = mean(answerableCases.map((result) => result.reciprocalRank))
  const ndcg = mean(answerableCases.map((result) => result.ndcg))
  const abstentionAccuracy =
    unanswerableCases.length === 0
      ? null
      : unanswerableCases.filter((result) => result.abstained).length / unanswerableCases.length

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
    embeddingModelRevision: config.embeddingModelRevision,
    retrievalProfile: config.retrievalProfile,
    indexFingerprint,
    goldenFingerprint: goldenFile.fingerprint,
    topK: defaultTopK,
    total: cases.length,
    hits,
    misses: cases.length - hits,
    hitRate: hits / cases.length,
    recall,
    precision,
    meanReciprocalRank,
    ndcg,
    recallAt: {
      1: metrics.recallAt1,
      3: metrics.recallAt3,
      5: metrics.recallAt5,
      10: metrics.recallAt10,
    },
    precisionAt5: metrics.precisionAt5,
    meanReciprocalRankAt10: metrics.meanReciprocalRankAt10,
    ndcgAt10: metrics.ndcgAt10,
    exactCitationRate: metrics.exactCitationRate,
    falsePositiveRate: metrics.falsePositiveRate,
    abstentionAccuracy,
    thresholds,
    gates,
    passed,
    verificationEligible,
    reportStored: storedReport !== null,
    qualityReportFingerprint: storedReport?.qualityReportFingerprint ?? null,
    groups: {
      categories: groupResults(cases, (result) => result.category),
      locales: groupResults(cases, (result) => result.locale),
    },
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    cases,
  }
}

async function readGoldenFile(
  goldenPath: string,
  signal: AbortSignal | undefined,
): Promise<GoldenFile> {
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
  const fingerprint = createHash("sha256").update(raw).digest("hex")
  const parsed = goldenFileSchema.parse(JSON.parse(raw))

  if (Array.isArray(parsed)) {
    return {
      minimumCasesForVerification: DEFAULT_MINIMUM_VERIFICATION_CASES,
      thresholds: {},
      queries: parsed.map(normalizeGoldenQuery),
      fingerprint,
    }
  }

  return {
    ...(parsed.topK === undefined ? {} : { topK: parsed.topK }),
    minimumCasesForVerification:
      parsed.minimumCasesForVerification ?? DEFAULT_MINIMUM_VERIFICATION_CASES,
    thresholds: normalizeThresholds(parsed.thresholds),
    queries: parsed.queries.map(normalizeGoldenQuery),
    fingerprint,
  }
}

function normalizeGoldenQuery(value: z.infer<typeof goldenQuerySchema>): GoldenQuery {
  return {
    query: value.query,
    expectedPaths: value.expectedPaths,
    answerable: value.answerable ?? true,
    relevanceJudgments: value.relevanceJudgments ?? [],
    ...(value.expectedCitations === undefined
      ? {}
      : { expectedCitations: value.expectedCitations }),
    ...(value.id === undefined ? {} : { id: value.id }),
    ...(value.category === undefined ? {} : { category: value.category }),
    ...(value.locale === undefined ? {} : { locale: value.locale }),
    ...(value.maximumVectorDistance === undefined
      ? {}
      : { maximumVectorDistance: value.maximumVectorDistance }),
    ...(value.topK === undefined ? {} : { topK: value.topK }),
    ...(value.includePaths === undefined ? {} : { includePaths: value.includePaths }),
    ...(value.excludePaths === undefined ? {} : { excludePaths: value.excludePaths }),
    ...(value.contextPaths === undefined ? {} : { contextPaths: value.contextPaths }),
  }
}

function evaluateCase(
  goldenQuery: GoldenQuery,
  results: SearchResult[],
  topK: number,
  latencyMs: number,
): EvaluationCaseResult {
  const answerable = goldenQuery.answerable ?? true
  const returnedPaths = results.map((result) => result.relativePath)
  const returnedCitations = results.map(citationForResult)
  const pathJudgments = judgmentsFor(
    "path",
    goldenQuery.relevanceJudgments ?? [],
    goldenQuery.expectedPaths,
  )
  const citationJudgments = judgmentsFor(
    "citation",
    goldenQuery.relevanceJudgments ?? [],
    goldenQuery.expectedCitations ?? [],
  )
  const requiresExactCitation = citationJudgments.some((judgment) => judgment.relevance > 0)
  const primaryJudgments = requiresExactCitation ? citationJudgments : pathJudgments
  const returnedValues = requiresExactCitation ? returnedCitations : returnedPaths
  const matchedPaths = uniqueAtK(returnedPaths, returnedPaths.length).filter((resultPath) =>
    pathJudgments.some((judgment) => judgment.value === resultPath && judgment.relevance > 0),
  )
  const matchedCitations = uniqueAtK(returnedCitations, returnedCitations.length).filter(
    (citation) =>
      citationJudgments.some((judgment) => judgment.value === citation && judgment.relevance > 0),
  )
  const bestRank = firstRelevantRank(returnedValues, primaryJudgments, topK)
  const reciprocalRank = bestRank === null ? 0 : 1 / bestRank
  const recallAt: Record<1 | 3 | 5 | 10, number> = {
    1: recallAtK(returnedValues, primaryJudgments, 1),
    3: recallAtK(returnedValues, primaryJudgments, 3),
    5: recallAtK(returnedValues, primaryJudgments, 5),
    10: recallAtK(returnedValues, primaryJudgments, 10),
  }
  const abstained = returnedValues.length === 0
  const falsePositive = !answerable && !abstained
  const pathHit = matchedPaths.length > 0
  const exactCitationHit = requiresExactCitation ? matchedCitations.length > 0 : null
  const hit = answerable ? (requiresExactCitation ? exactCitationHit === true : pathHit) : abstained
  const relevanceJudgments = [...pathJudgments, ...citationJudgments]

  const result: EvaluationCaseResult = {
    query: goldenQuery.query,
    expectedPaths: goldenQuery.expectedPaths,
    topK,
    returnedPaths,
    returnedCitations,
    matchedPaths,
    matchedCitations,
    answerable,
    relevanceJudgments,
    abstained,
    falsePositive,
    pathHit,
    exactCitationHit,
    hit,
    bestRank,
    reciprocalRank,
    recall: answerable ? recallAtK(returnedValues, primaryJudgments, topK) : Number(abstained),
    precision: answerable ? precisionAtK(returnedValues, primaryJudgments, topK, false) : 0,
    ndcg: answerable ? gradedNdcgAtK(returnedValues, primaryJudgments, topK) : Number(abstained),
    recallAt,
    precisionAt5: answerable ? precisionAtK(returnedValues, primaryJudgments, 5, true) : 0,
    reciprocalRankAt10: answerable ? reciprocalRankAtK(returnedValues, primaryJudgments, 10) : 0,
    ndcgAt10: answerable ? gradedNdcgAtK(returnedValues, primaryJudgments, 10) : 0,
    latencyMs,
  }
  if (goldenQuery.id !== undefined) {
    result.id = goldenQuery.id
  }
  if (goldenQuery.category !== undefined) {
    result.category = goldenQuery.category
  }
  if (goldenQuery.locale !== undefined) {
    result.locale = goldenQuery.locale
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
  return result
}

function judgmentsFor(
  kind: RelevanceJudgment["kind"],
  declared: RelevanceJudgment[],
  legacyExpectedValues: string[],
): RelevanceJudgment[] {
  const explicit = declared.filter((judgment) => judgment.kind === kind)
  if (explicit.length > 0) {
    return explicit
  }
  return legacyExpectedValues.map((value) => ({ kind, value, relevance: 1 }))
}

function applyVectorDistancePolicy(
  results: SearchResult[],
  maximumVectorDistance: number | undefined,
): SearchResult[] {
  if (maximumVectorDistance === undefined) {
    return results
  }
  return results.filter(
    (result) => result.distance !== null && result.distance <= maximumVectorDistance,
  )
}

function evaluationMetrics(
  answerableCases: EvaluationCaseResult[],
  unanswerableCases: EvaluationCaseResult[],
  citationCases: EvaluationCaseResult[],
): EvaluationMetrics {
  return {
    recallAt1: mean(answerableCases.map((result) => result.recallAt[1])),
    recallAt3: mean(answerableCases.map((result) => result.recallAt[3])),
    recallAt5: mean(answerableCases.map((result) => result.recallAt[5])),
    recallAt10: mean(answerableCases.map((result) => result.recallAt[10])),
    precisionAt5: mean(answerableCases.map((result) => result.precisionAt5)),
    meanReciprocalRankAt10: mean(answerableCases.map((result) => result.reciprocalRankAt10)),
    ndcgAt10: mean(answerableCases.map((result) => result.ndcgAt10)),
    exactCitationRate:
      citationCases.length === 0
        ? null
        : citationCases.filter((result) => result.exactCitationHit === true).length /
          citationCases.length,
    falsePositiveRate:
      unanswerableCases.length === 0
        ? null
        : unanswerableCases.filter((result) => result.falsePositive).length /
          unanswerableCases.length,
  }
}

function qualityGates(
  metrics: EvaluationMetrics,
  thresholds: QualityMetricThresholds,
): QualityGateResult[] {
  const gates: QualityGateResult[] = []
  addMinimumGate(gates, "recallAt1", thresholds.recallAt1, metrics.recallAt1)
  addMinimumGate(gates, "recallAt3", thresholds.recallAt3, metrics.recallAt3)
  addMinimumGate(gates, "recallAt5", thresholds.recallAt5, metrics.recallAt5)
  addMinimumGate(gates, "recallAt10", thresholds.recallAt10, metrics.recallAt10)
  addMinimumGate(gates, "precisionAt5", thresholds.precisionAt5, metrics.precisionAt5)
  addMinimumGate(
    gates,
    "meanReciprocalRankAt10",
    thresholds.meanReciprocalRankAt10,
    metrics.meanReciprocalRankAt10,
  )
  addMinimumGate(gates, "ndcgAt10", thresholds.ndcgAt10, metrics.ndcgAt10)
  addMinimumGate(
    gates,
    "exactCitationRate",
    thresholds.exactCitationRate,
    metrics.exactCitationRate,
  )
  addMaximumGate(
    gates,
    "maximumFalsePositiveRate",
    thresholds.maximumFalsePositiveRate,
    metrics.falsePositiveRate,
  )
  return gates
}

function addMinimumGate(
  gates: QualityGateResult[],
  metric: keyof QualityMetricThresholds,
  threshold: number | undefined,
  actual: number | null,
): void {
  if (threshold === undefined) {
    return
  }
  gates.push({
    metric,
    direction: "minimum",
    threshold,
    actual,
    applicable: actual !== null,
    passed: actual !== null && actual >= threshold,
  })
}

function addMaximumGate(
  gates: QualityGateResult[],
  metric: keyof QualityMetricThresholds,
  threshold: number | undefined,
  actual: number | null,
): void {
  if (threshold === undefined) {
    return
  }
  gates.push({
    metric,
    direction: "maximum",
    threshold,
    actual,
    applicable: actual !== null,
    passed: actual !== null && actual <= threshold,
  })
}

function completeThresholdSet(
  thresholds: QualityMetricThresholds,
): Required<QualityMetricThresholds> | null {
  if (
    thresholds.recallAt1 === undefined ||
    thresholds.recallAt3 === undefined ||
    thresholds.recallAt5 === undefined ||
    thresholds.recallAt10 === undefined ||
    thresholds.precisionAt5 === undefined ||
    thresholds.meanReciprocalRankAt10 === undefined ||
    thresholds.ndcgAt10 === undefined ||
    thresholds.exactCitationRate === undefined ||
    thresholds.maximumFalsePositiveRate === undefined
  ) {
    return null
  }
  return {
    recallAt1: thresholds.recallAt1,
    recallAt3: thresholds.recallAt3,
    recallAt5: thresholds.recallAt5,
    recallAt10: thresholds.recallAt10,
    precisionAt5: thresholds.precisionAt5,
    meanReciprocalRankAt10: thresholds.meanReciprocalRankAt10,
    ndcgAt10: thresholds.ndcgAt10,
    exactCitationRate: thresholds.exactCitationRate,
    maximumFalsePositiveRate: thresholds.maximumFalsePositiveRate,
  }
}

async function persistQualityReport(input: {
  config: Awaited<ReturnType<typeof loadConfig>>
  indexFingerprint: string
  goldenPath: string
  goldenFingerprint: string
  metrics: EvaluationMetrics
  thresholds: Required<QualityMetricThresholds>
  total: number
  signal: AbortSignal | undefined
}): Promise<IndexQualityReport | null> {
  return withIndexWriteLock(input.config.storageDir, input.signal, async () => {
    const activeManifest = await readIndexManifest(input.config)
    if (
      !activeManifest ||
      fingerprintIndexManifest(activeManifest) !== input.indexFingerprint ||
      input.metrics.exactCitationRate === null ||
      input.metrics.falsePositiveRate === null
    ) {
      return null
    }
    const unsignedReport: Omit<IndexQualityReport, "qualityReportFingerprint"> = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      goldenPath: input.goldenPath,
      goldenFingerprint: input.goldenFingerprint,
      indexFingerprint: input.indexFingerprint,
      indexPolicyFingerprint: activeManifest.indexPolicyFingerprint ?? "",
      embeddingProvider: input.config.embeddingProvider,
      embeddingModel: input.config.embeddingModel,
      embeddingModelRevision: input.config.embeddingModelRevision,
      retrievalProfile: input.config.retrievalProfile,
      total: input.total,
      metrics: {
        recallAt1: input.metrics.recallAt1,
        recallAt3: input.metrics.recallAt3,
        recallAt5: input.metrics.recallAt5,
        recallAt10: input.metrics.recallAt10,
        precisionAt5: input.metrics.precisionAt5,
        meanReciprocalRankAt10: input.metrics.meanReciprocalRankAt10,
        ndcgAt10: input.metrics.ndcgAt10,
        exactCitationRate: input.metrics.exactCitationRate,
        falsePositiveRate: input.metrics.falsePositiveRate,
      },
      thresholds: input.thresholds,
      passed: true,
      verificationEligible: true,
    }
    const qualityReport: IndexQualityReport = {
      ...unsignedReport,
      qualityReportFingerprint: fingerprintQualityReport(unsignedReport),
    }
    await writeIndexManifest({ ...activeManifest, qualityReport }, input.config)
    return qualityReport
  })
}

function groupResults(
  cases: EvaluationCaseResult[],
  groupFor: (result: EvaluationCaseResult) => string | undefined,
): Record<string, EvaluationGroupResult> {
  const grouped = new Map<string, EvaluationCaseResult[]>()
  for (const result of cases) {
    const group = groupFor(result)
    if (group === undefined) {
      continue
    }
    const members = grouped.get(group) ?? []
    members.push(result)
    grouped.set(group, members)
  }
  return Object.fromEntries(
    [...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([group, members]) => [group, summarizeGroup(members)]),
  )
}

function summarizeGroup(cases: EvaluationCaseResult[]): EvaluationGroupResult {
  const answerable = cases.filter((result) => result.answerable)
  const unanswerable = cases.filter((result) => !result.answerable)
  return {
    total: cases.length,
    answerable: answerable.length,
    unanswerable: unanswerable.length,
    recallAt10: mean(answerable.map((result) => result.recallAt[10])),
    precisionAt5: mean(answerable.map((result) => result.precisionAt5)),
    meanReciprocalRankAt10: mean(answerable.map((result) => result.reciprocalRankAt10)),
    ndcgAt10: mean(answerable.map((result) => result.ndcgAt10)),
    falsePositiveRate:
      unanswerable.length === 0
        ? 0
        : unanswerable.filter((result) => result.falsePositive).length / unanswerable.length,
  }
}

function projectRelativePath(projectRoot: string, targetPath: string): string | null {
  const relativePath = path.relative(projectRoot, targetPath)
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    return null
  }
  return relativePath.split(path.sep).join("/")
}

function recallAtK(returned: string[], judgments: RelevanceJudgment[], topK: number): number {
  const relevant = new Set(
    judgments.filter((judgment) => judgment.relevance > 0).map((judgment) => judgment.value),
  )
  if (relevant.size === 0) {
    return 0
  }
  return uniqueAtK(returned, topK).filter((value) => relevant.has(value)).length / relevant.size
}

function precisionAtK(
  returned: string[],
  judgments: RelevanceJudgment[],
  topK: number,
  fixedDenominator: boolean,
): number {
  const values = uniqueAtK(returned, topK)
  const relevant = new Set(
    judgments.filter((judgment) => judgment.relevance > 0).map((judgment) => judgment.value),
  )
  const denominator = fixedDenominator ? topK : values.length
  if (denominator === 0) {
    return 0
  }
  return values.filter((value) => relevant.has(value)).length / denominator
}

function reciprocalRankAtK(
  returned: string[],
  judgments: RelevanceJudgment[],
  topK: number,
): number {
  const rank = firstRelevantRank(returned, judgments, topK)
  return rank === null ? 0 : 1 / rank
}

function firstRelevantRank(
  returned: string[],
  judgments: RelevanceJudgment[],
  topK: number,
): number | null {
  const relevant = new Set(
    judgments.filter((judgment) => judgment.relevance > 0).map((judgment) => judgment.value),
  )
  const index = returned.slice(0, topK).findIndex((value) => relevant.has(value))
  return index < 0 ? null : index + 1
}

function gradedNdcgAtK(returned: string[], judgments: RelevanceJudgment[], topK: number): number {
  const relevance = new Map(judgments.map((judgment) => [judgment.value, judgment.relevance]))
  const seen = new Set<string>()
  const dcg = returned.slice(0, topK).reduce((score, value, index) => {
    if (seen.has(value)) {
      return score
    }
    seen.add(value)
    const grade = relevance.get(value) ?? 0
    return score + (2 ** grade - 1) / Math.log2(index + 2)
  }, 0)
  const idealGrades = [
    ...new Map(judgments.map((judgment) => [judgment.value, judgment.relevance])).values(),
  ]
    .filter((grade) => grade > 0)
    .sort((left, right) => right - left)
    .slice(0, topK)
  const idealDcg = idealGrades.reduce<number>(
    (score, grade, index) => score + (2 ** grade - 1) / Math.log2(index + 2),
    0,
  )
  return idealDcg === 0 ? 0 : dcg / idealDcg
}

function normalizeThresholds(
  value: z.infer<typeof qualityThresholdSchema> | undefined,
): QualityMetricThresholds {
  if (value === undefined) {
    return {}
  }
  return {
    ...(value.recallAt1 === undefined ? {} : { recallAt1: value.recallAt1 }),
    ...(value.recallAt3 === undefined ? {} : { recallAt3: value.recallAt3 }),
    ...(value.recallAt5 === undefined ? {} : { recallAt5: value.recallAt5 }),
    ...(value.recallAt10 === undefined ? {} : { recallAt10: value.recallAt10 }),
    ...(value.precisionAt5 === undefined ? {} : { precisionAt5: value.precisionAt5 }),
    ...(value.meanReciprocalRankAt10 === undefined
      ? {}
      : { meanReciprocalRankAt10: value.meanReciprocalRankAt10 }),
    ...(value.ndcgAt10 === undefined ? {} : { ndcgAt10: value.ndcgAt10 }),
    ...(value.exactCitationRate === undefined
      ? {}
      : { exactCitationRate: value.exactCitationRate }),
    ...(value.maximumFalsePositiveRate === undefined
      ? {}
      : { maximumFalsePositiveRate: value.maximumFalsePositiveRate }),
  }
}

function uniqueAtK(values: string[], topK: number): string[] {
  return [...new Set(values.slice(0, topK))]
}

function boundedTopK(topK: number, maxTopK: number | undefined): number {
  return maxTopK === undefined ? topK : Math.min(topK, maxTopK)
}

function citationForResult(result: { citation: string }): string {
  return result.citation
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
