import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const coreRoot = path.join(repoRoot, "packages", "ragmir-core")
const packageManagerCli = process.env.npm_execpath
if (!packageManagerCli) {
  throw new Error("offline:smoke must run through pnpm so npm_execpath is available.")
}

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ragmir-offline-install-"))
try {
  const packRoot = path.join(tempRoot, "pack")
  const consumerRoot = path.join(tempRoot, "consumer")
  await mkdir(packRoot, { recursive: true })
  await mkdir(consumerRoot, { recursive: true })
  await runPnpm(["pack", "--pack-destination", packRoot], coreRoot)
  const tarballs = (await readdir(packRoot)).filter((entry) => entry.endsWith(".tgz"))
  if (tarballs.length !== 1 || !tarballs[0]) {
    throw new Error(`Expected one packed Core tarball, received ${tarballs.length}.`)
  }
  const tarballPath = path.join(packRoot, tarballs[0])
  await writeFile(
    path.join(consumerRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "ragmir-offline-consumer",
        private: true,
        type: "module",
        dependencies: { "@jcode.labs/ragmir": `file:${tarballPath}` },
      },
      null,
      2,
    )}\n`,
    "utf8",
  )
  await runPnpm(["install", "--lockfile-only", "--ignore-scripts"], consumerRoot)
  await runPnpm(["fetch", "--frozen-lockfile"], consumerRoot)
  await runPnpm(
    ["install", "--offline", "--frozen-lockfile", "--ignore-scripts"],
    consumerRoot,
    true,
  )

  const installedCliPath = path.join(consumerRoot, "node_modules", ".bin", "rgr")
  const installedVersion = await execFileAsync(installedCliPath, ["--version"], {
    cwd: consumerRoot,
    env: offlineEnvironment(),
    maxBuffer: 1024 * 1024,
  })
  const workerPath = path.join(consumerRoot, "verify.mjs")
  await writeFile(workerPath, offlineWorkerSource(), "utf8")
  const { stdout } = await execFileAsync(process.execPath, [workerPath], {
    cwd: consumerRoot,
    env: offlineEnvironment(),
    maxBuffer: 8 * 1_024 * 1_024,
  })
  const result = JSON.parse(stdout)
  const chatInstalled = existsSync(
    path.join(consumerRoot, "node_modules", "@jcode.labs", "ragmir-chat"),
  )
  const ttsInstalled = existsSync(
    path.join(consumerRoot, "node_modules", "@jcode.labs", "ragmir-tts"),
  )
  const heavyInstalled = (await readdir(path.join(consumerRoot, "node_modules", ".pnpm"))).filter(
    (entry) => /huggingface\+transformers|onnxruntime|^sharp@|node-llama-cpp/u.test(entry),
  )
  const passed =
    result.provider === "local-hash" &&
    result.indexedFiles === 1 &&
    result.resultPath === ".ragmir/raw/evidence.md" &&
    Array.isArray(result.forbiddenResolutions) &&
    result.forbiddenResolutions.length === 0 &&
    installedVersion.stdout.trim().length > 0 &&
    heavyInstalled.length === 0 &&
    result.missingSemanticRuntimeExplained === true &&
    !chatInstalled &&
    !ttsInstalled
  process.stdout.write(
    `${JSON.stringify({
      ...result,
      preloadMode: "lockfile-and-tarballs",
      installMode: "pnpm-offline-frozen-store",
      installedCliVersion: installedVersion.stdout.trim(),
      heavyInstalled,
      chatInstalled,
      ttsInstalled,
      passed,
    })}\n`,
  )
  if (!passed) {
    process.exitCode = 1
  }
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}

async function runPnpm(args, cwd, offline = false) {
  await execFileAsync(process.execPath, [packageManagerCli, ...args], {
    cwd,
    env: offline ? offlineEnvironment() : process.env,
    maxBuffer: 16 * 1_024 * 1_024,
  })
}

function offlineEnvironment() {
  return {
    ...process.env,
    npm_config_offline: "true",
    HF_HUB_OFFLINE: "1",
    TRANSFORMERS_OFFLINE: "1",
  }
}

function offlineWorkerSource() {
  return `
import { registerHooks } from "node:module"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

const forbidden = /(?:@huggingface\\/transformers|onnxruntime|sharp)/iu
const forbiddenResolutions = []
let checkingMissingPeer = false
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!checkingMissingPeer && forbidden.test(specifier)) {
      forbiddenResolutions.push(specifier)
      throw new Error(\`local-hash attempted to load forbidden runtime \${specifier}.\`)
    }
    return nextResolve(specifier, context)
  },
})

const { initProject, ingest, loadConfig, search, expandCitation } = await import("@jcode.labs/ragmir")
const projectRoot = path.join(process.cwd(), "project")
await initProject(projectRoot)
await mkdir(path.join(projectRoot, ".ragmir", "raw"), { recursive: true })
await writeFile(
  path.join(projectRoot, ".ragmir", "raw", "evidence.md"),
  "# Offline proof\\n\\nPORTABLE-EVIDENCE confirms local retrieval.\\n",
  "utf8",
)
const config = await loadConfig(projectRoot)
const ingestion = await ingest({ cwd: projectRoot })
const results = await search("PORTABLE-EVIDENCE local retrieval", { cwd: projectRoot, topK: 1 })
const expanded = await expandCitation(results[0].citation, { cwd: projectRoot })
if (!expanded.found) throw new Error("Packed citation expansion failed")
// Disable the resolution guard only for this explicit missing-runtime check.
checkingMissingPeer = true
let missingSemanticRuntimeExplained = false
await writeFile(path.join(projectRoot, ".ragmir", "config.json"), JSON.stringify({ embeddingProvider: "transformers" }))
const missing = await ingest({ cwd: projectRoot, rebuild: true }).catch((error) => ({ errors: [{ message: error.message }] }))
missingSemanticRuntimeExplained = missing.errors.some((error) => error.message.includes("Install it in your project"))
process.stdout.write(JSON.stringify({
  missingSemanticRuntimeExplained,
  provider: config.embeddingProvider,
  indexedFiles: ingestion.indexedFiles,
  resultPath: results[0]?.relativePath ?? null,
  forbiddenResolutions,
}))
`
}
