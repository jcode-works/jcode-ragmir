import { readFile, stat } from "node:fs/promises"
import { z } from "zod"
import { RagmirError } from "./errors.js"
import { throwIfAborted } from "./operation.js"
import type {
  EvaluationCaseResult,
  EvaluationComparison,
  EvaluationComparisonMetric,
  EvaluationGroupResult,
  EvaluationMetricDelta,
  EvaluationResult,
} from "./types.js"

const MAX_BASELINE_REPORT_BYTES = 67_108_864
const ANSWER_RATE_DEPTHS = [1, 3, 5, 10] as const

const optionalMetric = z.number().nullable().optional()

// A baseline is a report written by an earlier Ragmir version, so every field stays optional: a
// metric the older report lacks compares as null instead of failing the run.
const baselineReportSchema = z
  .object({
    goldenFingerprint: z.string().optional(),
    indexFingerprint: z.string().optional(),
    rankingPolicyFingerprint: z.string().optional(),
    embeddingProvider: z.string().optional(),
    embeddingModel: z.string().optional(),
    retrievalProfile: z.string().optional(),
    retriever: z.string().optional(),
    topK: z.number().optional(),
    recallAt: z.record(z.string(), z.number()).optional(),
    answerRateAt: z.record(z.string(), z.number()).optional(),
    precisionAt5: optionalMetric,
    meanReciprocalRankAt10: optionalMetric,
    ndcgAt10: optionalMetric,
    exactCitationRate: optionalMetric,
    falsePositiveRate: optionalMetric,
    abstentionAccuracy: optionalMetric,
    p50LatencyMs: optionalMetric,
    p95LatencyMs: optionalMetric,
    groups: z
      .object({
        categories: z.record(z.string(), z.record(z.string(), z.number())).optional(),
      })
      .loose()
      .optional(),
    cases: z
      .array(
        z
          .object({
            answerable: z.boolean().optional(),
            bestRank: z.number().nullable().optional(),
          })
          .loose(),
      )
      .optional(),
  })
  .loose()

type BaselineReport = z.infer<typeof baselineReportSchema>

const GROUP_METRICS: ReadonlyArray<keyof EvaluationGroupResult> = [
  "total",
  "answerable",
  "unanswerable",
  "recallAt10",
  "precisionAt5",
  "meanReciprocalRankAt10",
  "ndcgAt10",
  "falsePositiveRate",
]

/** Share of answerable cases whose first relevant passage ranks within each depth. */
export function answerRatesAt(
  cases: ReadonlyArray<Pick<EvaluationCaseResult, "answerable" | "bestRank">>,
): Record<1 | 3 | 5 | 10, number> {
  const answerable = cases.filter((result) => result.answerable !== false)
  const rateAt = (depth: number): number =>
    answerable.length === 0
      ? 0
      : answerable.filter((result) => result.bestRank !== null && result.bestRank <= depth).length /
        answerable.length
  return { 1: rateAt(1), 3: rateAt(3), 5: rateAt(5), 10: rateAt(10) }
}

/**
 * Compare an evaluation with an earlier `--json` report of the same golden file. Deltas are signed
 * (`current - baseline`), so a change to retrieval shows what it gained and what it cost, case
 * group by case group, instead of two reports read side by side.
 */
export async function compareWithBaseline(
  current: Omit<EvaluationResult, "comparison">,
  baselinePath: string,
  signal: AbortSignal | undefined,
): Promise<EvaluationComparison> {
  const baseline = await readBaselineReport(baselinePath, signal)
  const baselineAnswerRates = baselineAnswerRateAt(baseline)
  const metric = (
    baselineValue: number | null | undefined,
    currentValue: number | null,
  ): EvaluationMetricDelta => metricDelta(baselineValue ?? null, currentValue)
  const metrics: Record<EvaluationComparisonMetric, EvaluationMetricDelta> = {
    answerRateAt1: metric(baselineAnswerRates?.[1], current.answerRateAt[1]),
    answerRateAt3: metric(baselineAnswerRates?.[3], current.answerRateAt[3]),
    answerRateAt10: metric(baselineAnswerRates?.[10], current.answerRateAt[10]),
    recallAt1: metric(baseline.recallAt?.["1"], current.recallAt[1]),
    recallAt3: metric(baseline.recallAt?.["3"], current.recallAt[3]),
    recallAt5: metric(baseline.recallAt?.["5"], current.recallAt[5]),
    recallAt10: metric(baseline.recallAt?.["10"], current.recallAt[10]),
    precisionAt5: metric(baseline.precisionAt5, current.precisionAt5),
    meanReciprocalRankAt10: metric(baseline.meanReciprocalRankAt10, current.meanReciprocalRankAt10),
    ndcgAt10: metric(baseline.ndcgAt10, current.ndcgAt10),
    exactCitationRate: metric(baseline.exactCitationRate, current.exactCitationRate),
    falsePositiveRate: metric(baseline.falsePositiveRate, current.falsePositiveRate),
    abstentionAccuracy: metric(baseline.abstentionAccuracy, current.abstentionAccuracy),
    p50LatencyMs: metric(baseline.p50LatencyMs, current.p50LatencyMs),
    p95LatencyMs: metric(baseline.p95LatencyMs, current.p95LatencyMs),
  }
  const categories: EvaluationComparison["categories"] = {}
  const baselineCategories = baseline.groups?.categories ?? {}
  for (const [category, group] of Object.entries(current.groups.categories)) {
    const before = baselineCategories[category]
    if (!before) continue
    categories[category] = Object.fromEntries(
      GROUP_METRICS.map((name) => [name, metricDelta(before[name] ?? null, group[name])]),
    ) as Record<keyof EvaluationGroupResult, EvaluationMetricDelta>
  }
  const comparable =
    baseline.goldenFingerprint === undefined ||
    baseline.goldenFingerprint === current.goldenFingerprint
  return {
    baselinePath,
    comparable,
    differences: runDifferences(baseline, current),
    metrics,
    categories,
  }
}

async function readBaselineReport(
  baselinePath: string,
  signal: AbortSignal | undefined,
): Promise<BaselineReport> {
  const size = (await stat(baselinePath)).size
  throwIfAborted(signal)
  if (size > MAX_BASELINE_REPORT_BYTES) {
    throw new RagmirError(
      "INVALID_ARGUMENT",
      `Baseline report must not exceed ${MAX_BASELINE_REPORT_BYTES} bytes.`,
    )
  }
  const raw = await readFile(baselinePath, { encoding: "utf8", signal })
  throwIfAborted(signal)
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new RagmirError(
      "INVALID_ARGUMENT",
      "The baseline must be a JSON report written by `rgr evaluate --json`.",
    )
  }
  const parsed = baselineReportSchema.safeParse(value)
  if (!parsed.success) {
    throw new RagmirError(
      "INVALID_ARGUMENT",
      "The baseline must be a JSON report written by `rgr evaluate --json`.",
    )
  }
  return parsed.data
}

/** Answer rates from the report, or from its cases when an older report predates the metric. */
function baselineAnswerRateAt(
  baseline: BaselineReport,
): Partial<Record<1 | 3 | 5 | 10, number>> | null {
  if (baseline.answerRateAt) {
    return Object.fromEntries(
      ANSWER_RATE_DEPTHS.flatMap((depth) => {
        const value = baseline.answerRateAt?.[String(depth)]
        return value === undefined ? [] : [[depth, value]]
      }),
    )
  }
  if (!baseline.cases) {
    return null
  }
  return answerRatesAt(
    baseline.cases.map((result) => ({
      answerable: result.answerable ?? true,
      bestRank: result.bestRank ?? null,
    })),
  )
}

function metricDelta(baseline: number | null, current: number | null): EvaluationMetricDelta {
  return {
    baseline,
    current,
    delta: baseline === null || current === null ? null : current - baseline,
  }
}

function runDifferences(
  baseline: BaselineReport,
  current: Omit<EvaluationResult, "comparison">,
): string[] {
  const pairs: Array<[string, unknown, unknown]> = [
    ["goldenFingerprint", baseline.goldenFingerprint, current.goldenFingerprint],
    ["indexFingerprint", baseline.indexFingerprint, current.indexFingerprint],
    [
      "rankingPolicyFingerprint",
      baseline.rankingPolicyFingerprint,
      current.rankingPolicyFingerprint,
    ],
    ["embeddingProvider", baseline.embeddingProvider, current.embeddingProvider],
    ["embeddingModel", baseline.embeddingModel, current.embeddingModel],
    ["retrievalProfile", baseline.retrievalProfile, current.retrievalProfile],
    ["retriever", baseline.retriever ?? "hybrid", current.retriever],
    ["topK", baseline.topK, current.topK],
  ]
  return pairs
    .filter(([, before, after]) => before !== undefined && before !== after)
    .map(([name]) => name)
}
