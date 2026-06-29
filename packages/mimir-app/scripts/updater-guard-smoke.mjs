import { spawnSync } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const UPDATER_GUARD_SCRIPT = join(SCRIPT_DIR, "updater-guard.mjs")
const tempDir = await mkdtemp(join(tmpdir(), "mimir-updater-guard-smoke-"))

try {
  const disabledConfig = join(tempDir, "updater-disabled.json")
  await writeJson(disabledConfig, {
    productName: "Mimir",
    version: "0.0.0",
    bundle: {},
    plugins: {},
  })

  const disabled = runGuard(["--config", disabledConfig, "--json"])
  assertEqual(disabled.status, 0, "disabled updater should pass")
  assertEqual(disabled.output.ok, true, "disabled updater output")
  assertEqual(disabled.output.checks[0]?.label, "updater disabled", "disabled updater check label")

  const placeholderConfig = join(tempDir, "updater-placeholder.json")
  await writeJson(placeholderConfig, {
    bundle: { createUpdaterArtifacts: true },
    plugins: {
      updater: {
        pubkey: "CONTENT FROM PUBLICKEY.PEM",
        endpoints: ["https://example.com/latest.json"],
      },
    },
  })

  const placeholder = runGuard(["--config", placeholderConfig, "--json", "--require-private-key"])
  assertEqual(placeholder.status, 1, "placeholder updater should fail")
  assertEqual(placeholder.output.ok, false, "placeholder updater output")
  assertIncludes(
    placeholder.output.checks.map((check) => check.label).join("\n"),
    "updater pubkey",
    "placeholder updater should audit the public key",
  )
  assertIncludes(
    placeholder.output.checks.map((check) => check.label).join("\n"),
    "updater private key",
    "placeholder updater should require a private key for desktop packaging",
  )

  const readyConfig = join(tempDir, "updater-ready.json")
  await writeJson(readyConfig, {
    bundle: { createUpdaterArtifacts: true },
    plugins: {
      updater: {
        pubkey: "mimir-updater-public-key-for-smoke-test-0001",
        endpoints: ["https://updates.example.invalid/mimir/latest.json"],
      },
    },
  })

  const ready = runGuard(["--config", readyConfig, "--json", "--require-private-key"], {
    TAURI_SIGNING_PRIVATE_KEY: "smoke-test-private-key",
  })
  assertEqual(ready.status, 0, "ready updater should pass")
  assertEqual(ready.output.ok, true, "ready updater output")

  console.log("Updater guard smoke passed.")
} finally {
  await rm(tempDir, { recursive: true, force: true })
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

function runGuard(args, env = {}) {
  const result = spawnSync(process.execPath, [UPDATER_GUARD_SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    shell: false,
  })
  return {
    status: result.status,
    output: JSON.parse(result.stdout),
    stderr: result.stderr,
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`)
  }
}

function assertIncludes(actual, expected, label) {
  if (!actual.includes(expected)) {
    throw new Error(`${label}: expected ${expected} in ${actual}`)
  }
}
