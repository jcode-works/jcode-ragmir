import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { isRecord } from "./guards.js"
import { rankingPolicyFingerprint, rankingPolicyFor } from "./ranking.js"
import type { Config, IndexManifest, IndexQualityReport, QualityMetricThresholds } from "./types.js"

export function fingerprintIndexManifest(manifest: IndexManifest): string {
  return sha256(
    stableJson({
      schemaVersion: manifest.schemaVersion,
      ragmirVersion: manifest.ragmirVersion,
      embeddingProvider: manifest.embeddingProvider,
      embeddingModel: manifest.embeddingModel,
      indexPolicyFingerprint: manifest.indexPolicyFingerprint ?? null,
      vectorDimension: manifest.vectorDimension ?? null,
      vectorDistanceMetric: manifest.vectorDistanceMetric ?? null,
      chunkSize: manifest.chunkSize,
      chunkOverlap: manifest.chunkOverlap,
      fileCount: manifest.fileCount,
      chunkCount: manifest.chunkCount,
      tableName: manifest.tableName ?? null,
      indexedFiles: manifest.indexedFiles ?? [],
      staleFiles: manifest.staleFiles ?? [],
    }),
  )
}

export async function fingerprintFile(filePath: string, signal?: AbortSignal): Promise<string> {
  return sha256(await readFile(filePath, signal ? { signal } : undefined))
}

export function fingerprintQualityReport(
  report: Omit<IndexQualityReport, "qualityReportFingerprint">,
): string {
  const { createdAt: _createdAt, ...stableReport } = report
  return sha256(stableJson(stableReport))
}

export async function isCompatibleQualityReport(
  report: IndexQualityReport | undefined,
  manifest: IndexManifest | null,
  config: Config,
): Promise<boolean> {
  if (!report || !manifest) {
    return false
  }
  if (
    report.indexFingerprint !== fingerprintIndexManifest(manifest) ||
    report.indexPolicyFingerprint !== manifest.indexPolicyFingerprint ||
    report.embeddingProvider !== config.embeddingProvider ||
    report.embeddingModel !== config.embeddingModel ||
    report.embeddingModelRevision !== config.embeddingModelRevision ||
    report.retrievalProfile !== config.retrievalProfile ||
    report.rankingPolicyFingerprint !==
      rankingPolicyFingerprint(rankingPolicyFor(config.embeddingProvider, config.retrievalProfile))
  ) {
    return false
  }

  const goldenPath = path.resolve(config.projectRoot, report.goldenPath)
  const relativeGoldenPath = path.relative(config.projectRoot, goldenPath)
  if (
    path.isAbsolute(report.goldenPath) ||
    relativeGoldenPath === ".." ||
    relativeGoldenPath.startsWith(`..${path.sep}`)
  ) {
    return false
  }

  try {
    const currentFingerprint = await fingerprintFile(goldenPath)
    const { qualityReportFingerprint: _fingerprint, ...unsignedReport } = report
    return (
      currentFingerprint === report.goldenFingerprint &&
      fingerprintQualityReport(unsignedReport) === report.qualityReportFingerprint
    )
  } catch {
    return false
  }
}

export function isIndexQualityReport(value: unknown): value is IndexQualityReport {
  return (
    isRecord(value) &&
    value.schemaVersion === 2 &&
    typeof value.createdAt === "string" &&
    typeof value.goldenPath === "string" &&
    typeof value.goldenFingerprint === "string" &&
    typeof value.indexFingerprint === "string" &&
    typeof value.indexPolicyFingerprint === "string" &&
    (value.embeddingProvider === "local-hash" || value.embeddingProvider === "transformers") &&
    typeof value.embeddingModel === "string" &&
    typeof value.embeddingModelRevision === "string" &&
    (value.retrievalProfile === "fast" ||
      value.retrievalProfile === "balanced" ||
      value.retrievalProfile === "quality" ||
      value.retrievalProfile === "custom") &&
    typeof value.rankingPolicyFingerprint === "string" &&
    typeof value.total === "number" &&
    isQualityMetrics(value.metrics) &&
    isRequiredThresholds(value.thresholds) &&
    value.passed === true &&
    value.verificationEligible === true &&
    typeof value.qualityReportFingerprint === "string"
  )
}

function isQualityMetrics(value: unknown): boolean {
  return (
    isRecord(value) &&
    isUnitMetric(value.recallAt1) &&
    isUnitMetric(value.recallAt3) &&
    isUnitMetric(value.recallAt5) &&
    isUnitMetric(value.recallAt10) &&
    isUnitMetric(value.precisionAt5) &&
    isUnitMetric(value.meanReciprocalRankAt10) &&
    isUnitMetric(value.ndcgAt10) &&
    isUnitMetric(value.exactCitationRate) &&
    isUnitMetric(value.falsePositiveRate)
  )
}

function isRequiredThresholds(value: unknown): value is Required<QualityMetricThresholds> {
  return (
    isRecord(value) &&
    isUnitMetric(value.recallAt1) &&
    isUnitMetric(value.recallAt3) &&
    isUnitMetric(value.recallAt5) &&
    isUnitMetric(value.recallAt10) &&
    isUnitMetric(value.precisionAt5) &&
    isUnitMetric(value.meanReciprocalRankAt10) &&
    isUnitMetric(value.ndcgAt10) &&
    isUnitMetric(value.exactCitationRate) &&
    isUnitMetric(value.maximumFalsePositiveRate)
  )
}

function isUnitMetric(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex")
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}
