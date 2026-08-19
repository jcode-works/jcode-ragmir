import { spawn } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"

const tempDirs: string[] = []
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const compareScript = path.join(packageRoot, "benchmarks", "compare.mjs")

afterEach(async () => {
  for (const directory of tempDirs.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

describe("benchmark comparison", () => {
  it("should reject reports when required identities and metrics are missing", async () => {
    const report = qualityReport()
    delete report.environment.machineFingerprint
    delete report.first.quality.ndcgAt10

    const comparison = await compareReports(report, report)

    expect(comparison.exitCode).toBe(2)
    expect(comparison.result.status).toBe("invalid")
    expect(comparison.result.invalidReasons).toEqual(
      expect.arrayContaining([
        "baseline-identity-missing:machineFingerprint",
        "metric-missing:first.ndcgAt10",
      ]),
    )
  })

  it("should be inconclusive when complete reports come from different machines", async () => {
    const baseline = qualityReport()
    const current = qualityReport()
    current.environment.machineFingerprint = "other-machine"

    const comparison = await compareReports(baseline, current)

    expect(comparison.exitCode).toBe(2)
    expect(comparison.result.status).toBe("inconclusive")
    expect(comparison.result.reasons.sameMachine).toBe(false)
  })

  it("should be inconclusive when the benchmark workload version changes", async () => {
    const baseline = qualityReport()
    const current = qualityReport()
    current.configuration.workloadVersion = 3

    const comparison = await compareReports(baseline, current)

    expect(comparison.exitCode).toBe(2)
    expect(comparison.result.status).toBe("inconclusive")
    expect(comparison.result.reasons.sameWorkload).toBe(false)
  })

  it("should compare measured ranking changes instead of treating them as workload identity", async () => {
    const baseline = qualityReport()
    const current = qualityReport()
    current.first.rankingVariantsFingerprint = "changed-ranking-output"
    current.second.rankingVariantsFingerprint = "changed-ranking-output"

    const comparison = await compareReports(baseline, current)

    expect(comparison.exitCode).toBe(0)
    expect(comparison.result.status).toBe("pass")
    expect(comparison.result.reasons.sameWorkload).toBe(true)
  })

  it("should fail when a complete metric regresses beyond tolerance", async () => {
    const baseline = qualityReport()
    const current = qualityReport()
    current.first.quality.recallAt[10] = 0.8

    const comparison = await compareReports(baseline, current)

    expect(comparison.exitCode).toBe(1)
    expect(comparison.result.status).toBe("fail")
    expect(comparison.result.comparisons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "first.recallAt10", status: "fail" }),
      ]),
    )
  })

  it("should fail when only the second quality run regresses", async () => {
    const baseline = qualityReport()
    const current = qualityReport()
    current.second.quality.recallAt[10] = 0.8

    const comparison = await compareReports(baseline, current)

    expect(comparison.exitCode).toBe(1)
    expect(comparison.result.status).toBe("fail")
    expect(comparison.result.comparisons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "second.recallAt10", status: "fail" }),
      ]),
    )
  })

  it("should reject a non-reproducible or failed quality report", async () => {
    const baseline = qualityReport()
    const current = qualityReport()
    current.reproducible = false
    current.passed = false

    const comparison = await compareReports(baseline, current)

    expect(comparison.exitCode).toBe(2)
    expect(comparison.result.status).toBe("invalid")
    expect(comparison.result.invalidReasons).toEqual(
      expect.arrayContaining(["current-not-reproducible", "current-quality-gates-failed"]),
    )
  })

  it("should reject a quality report when either run is verification-ineligible", async () => {
    const baseline = qualityReport()
    const current = qualityReport()
    current.first.quality.verificationEligible = false

    const comparison = await compareReports(baseline, current)

    expect(comparison.exitCode).toBe(2)
    expect(comparison.result.status).toBe("invalid")
    expect(comparison.result.invalidReasons).toContain("current-verification-ineligible:first")
  })

  it("should reject a scale report when its absolute quality gates fail", async () => {
    const baseline = scaleReport()
    const current = scaleReport()
    current.quality.passed = false

    const comparison = await compareReports(baseline, current)

    expect(comparison.exitCode).toBe(2)
    expect(comparison.result.status).toBe("invalid")
    expect(comparison.result.invalidReasons).toContain("current-quality-gates-failed")
  })

  it("should reject metrics outside their valid domain", async () => {
    const baseline = qualityReport()
    const current = qualityReport()
    current.second.quality.falsePositiveRate = -1

    const comparison = await compareReports(baseline, current)

    expect(comparison.exitCode).toBe(2)
    expect(comparison.result.status).toBe("invalid")
    expect(comparison.result.invalidReasons).toContain(
      "metric-out-of-range:current:second.falsePositiveRate",
    )
  })

  it("should pass identical complete quality reports", async () => {
    const report = qualityReport()

    const comparison = await compareReports(report, report)

    expect(comparison.exitCode).toBe(0)
    expect(comparison.result).toMatchObject({ suite: "quality", status: "pass", comparable: true })
    expect(comparison.result.comparisons.every((entry) => entry.status === "pass")).toBe(true)
  })

  it("should pass identical complete scale reports", async () => {
    const report = scaleReport()

    const comparison = await compareReports(report, report)

    expect(comparison.exitCode).toBe(0)
    expect(comparison.result).toMatchObject({ suite: "scale", status: "pass", comparable: true })
  })
})

async function compareReports(
  baseline: Record<string, unknown>,
  current: Record<string, unknown>,
): Promise<{ exitCode: number; result: ComparisonResult }> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ragmir-benchmark-comparison-"))
  tempDirs.push(directory)
  const baselinePath = path.join(directory, "baseline.json")
  const currentPath = path.join(directory, "current.json")
  await Promise.all([
    writeFile(baselinePath, JSON.stringify(baseline), "utf8"),
    writeFile(currentPath, JSON.stringify(current), "utf8"),
  ])
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      compareScript,
      "--baseline",
      baselinePath,
      "--current",
      currentPath,
    ])
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8")
    })
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8")
    })
    child.on("error", reject)
    child.on("close", (code) => {
      if (!stdout) {
        reject(new Error(stderr || "Benchmark comparison produced no output."))
        return
      }
      resolve({ exitCode: code ?? 1, result: JSON.parse(stdout) as ComparisonResult })
    })
  })
}

function qualityReport(): QualityReportFixture {
  const quality = qualityMetrics()
  return {
    schemaVersion: 1,
    environment: { machineFingerprint: "machine" },
    configuration: {
      workloadVersion: 2,
      size: "XS",
      provider: "local-hash",
      model: "model",
      modelRevision: "revision",
      retrievalProfile: "quality",
      seed: "seed",
    },
    reproducible: true,
    passed: true,
    first: {
      corpusHash: "corpus",
      goldenFingerprint: "golden",
      qualityFingerprint: "quality",
      rankingVariantsFingerprint: "ranking-variants",
      latency: { p50Ms: 10, p95Ms: 20 },
      quality,
    },
    second: {
      corpusHash: "corpus",
      goldenFingerprint: "golden",
      qualityFingerprint: "quality",
      rankingVariantsFingerprint: "ranking-variants",
      latency: { p50Ms: 10, p95Ms: 20 },
      quality: structuredClone(quality),
    },
  }
}

function scaleReport(): ScaleReportFixture {
  return {
    schemaVersion: 1,
    profile: "scale",
    size: "S",
    claimEligible: true,
    environment: { machineFingerprint: "machine" },
    configuration: {
      workloadVersion: 1,
      embeddingProvider: "local-hash",
      embeddingModel: "model",
      embeddingModelRevision: "revision",
      chunkSize: 1_200,
      chunkOverlap: 200,
    },
    corpus: { corpusHash: "corpus", seed: "seed", targetChunks: 10_000 },
    search: {
      persistent: { latency: { p95Ms: 20 }, throughputPerSecond: 100 },
    },
    resources: { maxRssKiB: 1_000 },
    storage: { physicalBytes: 2_000 },
    quality: { ...qualityMetrics(), rankingPolicyFingerprint: "ranking-policy" },
  }
}

function qualityMetrics(): QualityMetricsFixture {
  return {
    recallAt: { 1: 1, 3: 1, 5: 1, 10: 1 },
    precisionAt5: 1,
    meanReciprocalRankAt10: 1,
    ndcgAt10: 1,
    exactCitationRate: 1,
    falsePositiveRate: 0,
    passed: true,
    verificationEligible: true,
  }
}

interface QualityMetricsFixture {
  recallAt: Record<1 | 3 | 5 | 10, number>
  precisionAt5: number
  meanReciprocalRankAt10: number
  ndcgAt10?: number
  exactCitationRate: number
  falsePositiveRate: number
  passed: boolean
  verificationEligible: boolean
}

interface QualityReportFixture extends Record<string, unknown> {
  schemaVersion: number
  environment: { machineFingerprint?: string }
  configuration: Record<string, unknown>
  reproducible: boolean
  passed: boolean
  first: {
    corpusHash: string
    goldenFingerprint: string
    qualityFingerprint: string
    rankingVariantsFingerprint: string
    latency: { p50Ms: number; p95Ms: number }
    quality: QualityMetricsFixture
  }
  second: {
    corpusHash: string
    goldenFingerprint: string
    qualityFingerprint: string
    rankingVariantsFingerprint: string
    latency: { p50Ms: number; p95Ms: number }
    quality: QualityMetricsFixture
  }
}

interface ScaleReportFixture extends Record<string, unknown> {
  quality: QualityMetricsFixture & { rankingPolicyFingerprint: string }
}

interface ComparisonResult {
  status: string
  suite: string | null
  comparable: boolean
  invalidReasons: string[]
  reasons: { sameMachine: boolean; sameWorkload: boolean }
  comparisons: Array<{ name: string; status: string }>
}
