import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const PREFLIGHT_SCRIPT = join(SCRIPT_DIR, "release-preflight.mjs")
const SECRET_VALUES = [
  "synthetic-apple-id@example.invalid",
  "synthetic-apple-password",
  "synthetic-apple-team-id",
  "synthetic-apple-signing-identity",
  "synthetic-windows-thumbprint",
  "https://timestamp.example.invalid/ragmir",
  "/tmp/synthetic-android-sdk",
  "/tmp/synthetic-java-home",
]

for (const target of ["linux", "macos", "windows", "android"]) {
  const result = runPreflight(["--target", target, "--soft", "--json"], envForTarget(target))
  assertEqual(result.status, 0, `${target} soft status`)
  assertNoSecretValues(result, `${target} output`)
  assertEqual(result.output.target, target, `${target} target`)
  assertEqual(Array.isArray(result.output.checks), true, `${target} checks array`)
  assertIncludes(
    checkLabels(result.output),
    "Tauri updater configuration",
    `${target} updater guard`,
  )
}

const macos = runPreflight(["--target", "macos", "--soft", "--json"], envForTarget("macos"))
assertIncludes(checkLabels(macos.output), "Apple notarization account", "macOS Apple account check")
assertIncludes(checkDetails(macos.output), "APPLE_ID is set", "macOS Apple ID detail")
assertIncludes(checkDetails(macos.output), "APPLE_PASSWORD is set", "macOS Apple password detail")
assertIncludes(checkDetails(macos.output), "APPLE_TEAM_ID is set", "macOS Apple team detail")

const windows = runPreflight(["--target", "windows", "--soft", "--json"], envForTarget("windows"))
assertIncludes(checkLabels(windows.output), "certificate thumbprint", "Windows certificate check")
assertIncludes(
  checkDetails(windows.output),
  "WINDOWS_CERTIFICATE_THUMBPRINT is set",
  "Windows thumbprint detail",
)
assertIncludes(
  checkDetails(windows.output),
  "WINDOWS_TIMESTAMP_URL is set",
  "Windows timestamp detail",
)

const android = runPreflight(["--target", "android", "--soft", "--json"], envForTarget("android"))
assertIncludes(checkLabels(android.output), "Android SDK root", "Android SDK check")
assertIncludes(checkDetails(android.output), "ANDROID_HOME is set", "Android SDK detail")
assertIncludes(checkDetails(android.output), "JAVA_HOME is set", "Android Java detail")

const invalid = spawnSync(
  process.execPath,
  [PREFLIGHT_SCRIPT, "--target", "ios", "--soft", "--json"],
  {
    encoding: "utf8",
    shell: false,
  },
)
assertEqual(invalid.status === 0, false, "iOS release target should fail")
assertIncludes(
  invalid.stderr,
  "target must be one of macos, windows, linux, android",
  "invalid target stderr",
)

console.log("Release preflight smoke passed.")

function runPreflight(args, env = {}) {
  const result = spawnSync(process.execPath, [PREFLIGHT_SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    shell: false,
  })
  if (result.status !== 0) {
    throw new Error(
      `release preflight failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    )
  }
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    output: JSON.parse(result.stdout),
  }
}

function envForTarget(target) {
  if (target === "macos") {
    return {
      APPLE_ID: "synthetic-apple-id@example.invalid",
      APPLE_PASSWORD: "synthetic-apple-password",
      APPLE_SIGNING_IDENTITY: "synthetic-apple-signing-identity",
      APPLE_TEAM_ID: "synthetic-apple-team-id",
    }
  }
  if (target === "windows") {
    return {
      WINDOWS_CERTIFICATE_THUMBPRINT: "synthetic-windows-thumbprint",
      WINDOWS_TIMESTAMP_URL: "https://timestamp.example.invalid/ragmir",
    }
  }
  if (target === "android") {
    return {
      ANDROID_HOME: "/tmp/synthetic-android-sdk",
      JAVA_HOME: "/tmp/synthetic-java-home",
    }
  }
  return {}
}

function assertNoSecretValues(result, label) {
  const output = `${result.stdout}\n${result.stderr}`
  for (const value of SECRET_VALUES) {
    if (output.includes(value)) {
      throw new Error(`${label}: preflight output must not print secret-like value ${value}`)
    }
  }
}

function checkLabels(output) {
  return output.checks.map((check) => check.label).join("\n")
}

function checkDetails(output) {
  return output.checks.map((check) => check.detail).join("\n")
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
