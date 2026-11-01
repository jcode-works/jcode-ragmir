/**
 * Nearest-rank percentile of ascending values: the smallest value with at least `quantile` of the
 * values at or below it. Empty input gives 0.
 */
export function percentile(sortedValues: readonly number[], quantile: number): number {
  return sortedValues[Math.max(0, Math.ceil(quantile * sortedValues.length) - 1)] ?? 0
}
