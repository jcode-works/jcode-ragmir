import { execFile } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const here = path.dirname(fileURLToPath(import.meta.url))
const resultPath = path.resolve(
  process.env.RAGMIR_BENCH_RESULT ??
    path.join(here, ".results", `${new Date().toISOString().replaceAll(":", "-")}-models.json`),
)
const single = await lifecycleVariant("single")
const switched = await lifecycleVariant("switch")
const firstInstall = await reproducibilityRun()
const secondInstall = await reproducibilityRun()
const allowedLiveRssBytes = single.liveRssBytes * 1.15
const gates = {
  disposalDrained:
    switched.finalCache.entries === 0 &&
    switched.finalCache.activeLeases === 0 &&
    switched.finalCache.owners === 0,
  switchNearSingleModelRss: switched.liveRssBytes <= allowedLiveRssBytes,
  stablePolicyFingerprint:
    firstInstall.policyFingerprint === secondInstall.policyFingerprint,
  stableTopK: JSON.stringify(firstInstall.topK) === JSON.stringify(secondInstall.topK),
  pinnedRevision: /^[0-9a-f]{40}$/u.test(firstInstall.revision),
  resolvedDigest: /^sha256:[0-9a-f]{64}$/u.test(firstInstall.digest),
}
const report = {
  schemaVersion: 1,
  model: process.env.RAGMIR_BENCH_MODEL ?? "mixedbread-ai/mxbai-embed-xsmall-v1",
  single,
  switched,
  reproducibility: { firstInstall, secondInstall },
  allowedLiveRssBytes,
  gates,
  passed: Object.values(gates).every(Boolean),
}
await mkdir(path.dirname(resultPath), { recursive: true })
await writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`)
process.stdout.write(`${JSON.stringify({ resultPath, ...report }, null, 2)}\n`)
if (!report.passed) {
  process.exitCode = 1
}

async function lifecycleVariant(variant) {
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--expose-gc", path.join(here, "model-lifecycle-worker.mjs")],
    {
      env: { ...process.env, RAGMIR_MODEL_LIFECYCLE_VARIANT: variant },
      maxBuffer: 10 * 1_024 * 1_024,
    },
  )
  return JSON.parse(stdout)
}

async function reproducibilityRun() {
  const { stdout } = await execFileAsync(
    process.execPath,
    [path.join(here, "model-reproducibility-worker.mjs")],
    { env: process.env, maxBuffer: 10 * 1_024 * 1_024 },
  )
  return JSON.parse(stdout)
}
