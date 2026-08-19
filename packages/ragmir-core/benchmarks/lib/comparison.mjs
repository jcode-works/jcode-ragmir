const SCALE_METRICS = [
  metric("persistentSearchP95", ["search", "persistent", "latency", "p95Ms"], 0.15, "lower"),
  metric(
    "persistentSearchThroughput",
    ["search", "persistent", "throughputPerSecond"],
    0.1,
    "higher",
  ),
  metric("peakRss", ["resources", "maxRssKiB"], 0.1, "lower"),
  metric("storageBytes", ["storage", "physicalBytes"], 0.1, "lower"),
  ...qualityMetrics(["quality"]),
]

const QUALITY_METRICS = [
  metric("first.queryP50", ["first", "latency", "p50Ms"], 0.15, "lower"),
  metric("first.queryP95", ["first", "latency", "p95Ms"], 0.15, "lower"),
  ...qualityMetrics(["first", "quality"], "first"),
  metric("second.queryP50", ["second", "latency", "p50Ms"], 0.15, "lower"),
  metric("second.queryP95", ["second", "latency", "p95Ms"], 0.15, "lower"),
  ...qualityMetrics(["second", "quality"], "second"),
]

export function compareBenchmarkReports(baseline, current, options = {}) {
  const baselineSuite = benchmarkSuite(baseline)
  const currentSuite = benchmarkSuite(current)
  const invalidReasons = []
  if (baselineSuite === null) invalidReasons.push("baseline-suite-unrecognized")
  if (currentSuite === null) invalidReasons.push("current-suite-unrecognized")
  if (baseline?.schemaVersion !== 1) invalidReasons.push("baseline-schema-version-unsupported")
  if (current?.schemaVersion !== 1) invalidReasons.push("current-schema-version-unsupported")
  if (baselineSuite !== null && currentSuite !== null && baselineSuite !== currentSuite) {
    invalidReasons.push("suite-mismatch")
  }

  const suite = baselineSuite === currentSuite ? baselineSuite : null
  const metricSpecs = suite === "scale" ? SCALE_METRICS : suite === "quality" ? QUALITY_METRICS : []
  const identity = suite === null ? null : comparisonIdentity(suite, baseline, current)
  if (identity) invalidReasons.push(...identity.invalidReasons)
  if (suite !== null) {
    invalidReasons.push(
      ...validateBenchmarkReport(suite, baseline, "baseline"),
      ...validateBenchmarkReport(suite, current, "current"),
    )
  }

  const comparisons = metricSpecs.map((spec) => compareMetric(spec, baseline, current))
  for (const comparison of comparisons) {
    if (comparison.status === "missing") {
      invalidReasons.push(`metric-missing:${comparison.name}`)
    } else if (comparison.status === "invalid") {
      for (const report of comparison.invalidReports) {
        invalidReasons.push(`metric-out-of-range:${report}:${comparison.name}`)
      }
    }
  }

  const comparable =
    invalidReasons.length === 0 &&
    identity !== null &&
    identity.sameCorpus &&
    identity.sameProvider &&
    identity.sameWorkload &&
    (identity.sameMachine || options.allowCrossMachine === true)
  const failed = comparisons.filter((comparison) => comparison.status === "fail")
  const status =
    invalidReasons.length > 0
      ? "invalid"
      : !comparable
        ? "inconclusive"
        : failed.length > 0
          ? "fail"
          : "pass"

  return {
    schemaVersion: 2,
    suite,
    status,
    comparable,
    invalidReasons,
    reasons: {
      sameMachine: identity?.sameMachine ?? false,
      sameCorpus: identity?.sameCorpus ?? false,
      sameProvider: identity?.sameProvider ?? false,
      sameWorkload: identity?.sameWorkload ?? false,
      crossMachineAllowed: options.allowCrossMachine === true,
    },
    comparisons,
  }
}

function comparisonIdentity(suite, baseline, current) {
  const baselineIdentity = reportIdentity(suite, baseline)
  const currentIdentity = reportIdentity(suite, current)
  return {
    invalidReasons: [
      ...baselineIdentity.missing.map((field) => `baseline-identity-missing:${field}`),
      ...currentIdentity.missing.map((field) => `current-identity-missing:${field}`),
    ],
    sameMachine:
      baselineIdentity.machineFingerprint === currentIdentity.machineFingerprint &&
      baselineIdentity.machineFingerprint !== null,
    sameCorpus:
      baselineIdentity.corpusFingerprint === currentIdentity.corpusFingerprint &&
      baselineIdentity.corpusFingerprint !== null,
    sameProvider:
      baselineIdentity.provider === currentIdentity.provider && baselineIdentity.provider !== null,
    sameWorkload:
      baselineIdentity.workloadFingerprint === currentIdentity.workloadFingerprint &&
      baselineIdentity.workloadFingerprint !== null,
  }
}

function reportIdentity(suite, report) {
  const machineFingerprint = stringAt(report, ["environment", "machineFingerprint"])
  const corpusFingerprint = stringAt(
    report,
    suite === "scale" ? ["corpus", "corpusHash"] : ["first", "corpusHash"],
  )
  const provider = stringAt(
    report,
    suite === "scale"
      ? ["configuration", "embeddingProvider"]
      : ["configuration", "provider"],
  )
  const workload =
    suite === "scale"
      ? {
          profile: stringAt(report, ["profile"]),
          size: stringAt(report, ["size"]),
          seed: stringAt(report, ["corpus", "seed"]),
          targetChunks: numberAt(report, ["corpus", "targetChunks"]),
          embeddingModel: stringAt(report, ["configuration", "embeddingModel"]),
          embeddingModelRevision: stringAt(report, ["configuration", "embeddingModelRevision"]),
          chunkSize: numberAt(report, ["configuration", "chunkSize"]),
          chunkOverlap: numberAt(report, ["configuration", "chunkOverlap"]),
          workloadVersion: numberAt(report, ["configuration", "workloadVersion"]),
        }
      : {
          workloadVersion: numberAt(report, ["configuration", "workloadVersion"]),
          size: stringAt(report, ["configuration", "size"]),
          seed: stringAt(report, ["configuration", "seed"]),
          model: stringAt(report, ["configuration", "model"]),
          modelRevision: stringAt(report, ["configuration", "modelRevision"]),
          retrievalProfile: stringAt(report, ["configuration", "retrievalProfile"]),
          goldenFingerprint: stringAt(report, ["first", "goldenFingerprint"]),
        }
  const missing = []
  if (machineFingerprint === null) missing.push("machineFingerprint")
  if (corpusFingerprint === null) missing.push("corpusFingerprint")
  if (provider === null) missing.push("provider")
  for (const [key, value] of Object.entries(workload)) {
    if (value === null) missing.push(`workload.${key}`)
  }
  return {
    machineFingerprint,
    corpusFingerprint,
    provider,
    workloadFingerprint: missing.some((field) => field.startsWith("workload."))
      ? null
      : stableJson(workload),
    missing,
  }
}

function compareMetric(spec, baseline, current) {
  const baselineValue = numberAt(baseline, spec.path)
  const currentValue = numberAt(current, spec.path)
  if (baselineValue === null || currentValue === null) {
    return { name: spec.name, status: "missing", baseline: baselineValue, current: currentValue }
  }
  const invalidReports = []
  if (!metricValueInRange(baselineValue, spec)) invalidReports.push("baseline")
  if (!metricValueInRange(currentValue, spec)) invalidReports.push("current")
  if (invalidReports.length > 0) {
    return {
      name: spec.name,
      status: "invalid",
      baseline: baselineValue,
      current: currentValue,
      invalidReports,
    }
  }
  const deltaRatio =
    baselineValue === 0
      ? currentValue === 0
        ? 0
        : null
      : (currentValue - baselineValue) / baselineValue
  const failed =
    baselineValue === 0
      ? spec.direction === "lower" && currentValue > 0
      : spec.direction === "lower"
        ? (deltaRatio ?? 0) > spec.tolerance
        : (deltaRatio ?? 0) < -spec.tolerance
  return {
    name: spec.name,
    status: failed ? "fail" : "pass",
    direction: spec.direction,
    tolerance: spec.tolerance,
    baseline: baselineValue,
    current: currentValue,
    deltaRatio,
  }
}

function benchmarkSuite(report) {
  if (!isRecord(report)) return null
  if (isRecord(report.first) && isRecord(report.second)) return "quality"
  if (isRecord(report.search) && isRecord(report.corpus)) return "scale"
  return null
}

function qualityMetrics(prefix, run = null) {
  const name = (metricName) => (run === null ? metricName : `${run}.${metricName}`)
  return [
    rateMetric(name("recallAt1"), [...prefix, "recallAt", "1"], 0, "higher"),
    rateMetric(name("recallAt3"), [...prefix, "recallAt", "3"], 0, "higher"),
    rateMetric(name("recallAt5"), [...prefix, "recallAt", "5"], 0, "higher"),
    rateMetric(name("recallAt10"), [...prefix, "recallAt", "10"], 0, "higher"),
    rateMetric(name("precisionAt5"), [...prefix, "precisionAt5"], 0, "higher"),
    rateMetric(
      name("meanReciprocalRankAt10"),
      [...prefix, "meanReciprocalRankAt10"],
      0,
      "higher",
    ),
    rateMetric(name("ndcgAt10"), [...prefix, "ndcgAt10"], 0, "higher"),
    rateMetric(name("exactCitationRate"), [...prefix, "exactCitationRate"], 0, "higher"),
    rateMetric(name("falsePositiveRate"), [...prefix, "falsePositiveRate"], 0, "lower"),
  ]
}

function validateBenchmarkReport(suite, report, label) {
  const invalidReasons = []
  if (suite === "scale") {
    validateRequiredTrue(report, ["claimEligible"], label, "claim-eligible", invalidReasons)
    validateRequiredTrue(report, ["quality", "passed"], label, "quality-gates", invalidReasons)
    validateRequiredTrue(
      report,
      ["quality", "verificationEligible"],
      label,
      "verification-eligible",
      invalidReasons,
    )
    return invalidReasons
  }
  const reproducible = booleanAt(report, ["reproducible"])
  const passed = booleanAt(report, ["passed"])
  if (reproducible === null) {
    invalidReasons.push(`${label}-field-missing:reproducible`)
  } else if (!reproducible) {
    invalidReasons.push(`${label}-not-reproducible`)
  }
  if (passed === null) {
    invalidReasons.push(`${label}-field-missing:passed`)
  } else if (!passed) {
    invalidReasons.push(`${label}-quality-gates-failed`)
  }

  const runFields = [
    "corpusHash",
    "goldenFingerprint",
    "qualityFingerprint",
    "rankingVariantsFingerprint",
  ]
  for (const run of ["first", "second"]) {
    for (const field of runFields) {
      if (stringAt(report, [run, field]) === null) {
        invalidReasons.push(`${label}-field-missing:${run}.${field}`)
      }
    }
    const runPassed = booleanAt(report, [run, "quality", "passed"])
    if (runPassed === null) {
      invalidReasons.push(`${label}-field-missing:${run}.quality.passed`)
    } else if (!runPassed) {
      invalidReasons.push(`${label}-quality-gates-failed:${run}`)
    }
    const verificationEligible = booleanAt(report, [run, "quality", "verificationEligible"])
    if (verificationEligible === null) {
      invalidReasons.push(`${label}-field-missing:${run}.quality.verificationEligible`)
    } else if (!verificationEligible) {
      invalidReasons.push(`${label}-verification-ineligible:${run}`)
    }
  }
  for (const field of runFields) {
    const first = stringAt(report, ["first", field])
    const second = stringAt(report, ["second", field])
    if (first !== null && second !== null && first !== second) {
      invalidReasons.push(`${label}-run-mismatch:${field}`)
    }
  }
  return invalidReasons
}

function metric(name, fieldPath, tolerance, direction) {
  return { name, path: fieldPath, tolerance, direction, minimum: 0, maximum: null }
}

function rateMetric(name, fieldPath, tolerance, direction) {
  return { ...metric(name, fieldPath, tolerance, direction), maximum: 1 }
}

function metricValueInRange(value, spec) {
  return value >= spec.minimum && (spec.maximum === null || value <= spec.maximum)
}

function validateRequiredTrue(report, fieldPath, label, fieldName, invalidReasons) {
  const value = booleanAt(report, fieldPath)
  if (value === null) {
    invalidReasons.push(`${label}-field-missing:${fieldPath.join(".")}`)
  } else if (!value) {
    invalidReasons.push(`${label}-${fieldName}-failed`)
  }
}

function stringAt(value, fieldPath) {
  const result = readPath(value, fieldPath)
  return typeof result === "string" && result.length > 0 ? result : null
}

function numberAt(value, fieldPath) {
  const result = readPath(value, fieldPath)
  return typeof result === "number" && Number.isFinite(result) ? result : null
}

function booleanAt(value, fieldPath) {
  const result = readPath(value, fieldPath)
  return typeof result === "boolean" ? result : null
}

function readPath(value, fieldPath) {
  return fieldPath.reduce(
    (current, key) => (isRecord(current) || Array.isArray(current) ? current[key] : undefined),
    value,
  )
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
