import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const UPDATER_GUARD_SCRIPT = join(SCRIPT_DIR, "updater-guard.mjs")
const TARGETS = new Set(["macos", "windows", "linux", "android"])
const args = parseArgs(process.argv.slice(2))
const target = args.target ?? currentTarget()
const checks = releaseChecks(target)
const ok = checks.every((check) => check.ok)

if (args.json) {
  console.log(JSON.stringify({ target, ok, checks }, null, 2))
} else {
  console.log(`Mimir app release preflight: ${target}`)
  for (const check of checks) {
    console.log(`${check.ok ? "ok" : "missing"} ${check.label}: ${check.detail}`)
  }
}

if (!ok && !args.soft) {
  process.exitCode = 1
}

function releaseChecks(releaseTarget) {
  if (!TARGETS.has(releaseTarget)) {
    throw new Error(`target must be one of ${Array.from(TARGETS).join(", ")}.`)
  }

  const common = [
    commandCheck("pnpm", ["--version"], "pnpm workspace runner"),
    commandCheck("cargo", ["--version"], "Rust/Cargo toolchain"),
    commandCheck("rustc", ["--version"], "Rust compiler"),
    commandCheck("pnpm", ["exec", "tauri", "--version"], "Tauri CLI"),
    updaterGuardCheck(releaseTarget),
  ]

  if (releaseTarget === "macos") {
    return [
      ...common,
      platformCheck("darwin", "macOS release builds must run on macOS."),
      commandCheck("security", ["find-identity", "-v", "-p", "codesigning"], "Apple keychain"),
      envCheck("APPLE_SIGNING_IDENTITY", "Developer ID Application identity name"),
      envCheck("APPLE_ID", "Apple notarization account"),
      envCheck("APPLE_PASSWORD", "Apple app-specific notarization password"),
      envCheck("APPLE_TEAM_ID", "Apple notarization team"),
    ]
  }

  if (releaseTarget === "windows") {
    return [
      ...common,
      platformCheck("win32", "Windows release builds must run on Windows."),
      commandCheck("signtool", ["sign", "/?"], "Windows Authenticode signing tool"),
      envCheck("WINDOWS_CERTIFICATE_THUMBPRINT", "certificate thumbprint"),
      envCheck("WINDOWS_TIMESTAMP_URL", "trusted timestamp server URL"),
    ]
  }

  if (releaseTarget === "linux") {
    return [...common, platformCheck("linux", "Linux AppImage/deb builds must run on Linux.")]
  }

  return [
    ...common,
    commandCheck("rustup", ["--version"], "Rust target manager"),
    envAnyCheck(["ANDROID_HOME", "ANDROID_SDK_ROOT"], "Android SDK root"),
    envCheck("JAVA_HOME", "JDK for Android build tooling"),
  ]
}

function commandCheck(command, commandArgs, label) {
  const result = spawnSync(command, commandArgs, { encoding: "utf8", shell: false })
  return {
    label,
    ok: result.status === 0,
    detail:
      result.status === 0 ? firstLine(result.stdout || result.stderr) : `${command} not available`,
  }
}

function updaterGuardCheck(releaseTarget) {
  const commandArgs = [UPDATER_GUARD_SCRIPT]
  if (releaseTarget !== "android") {
    commandArgs.push("--require-private-key")
  }
  return commandCheck(process.execPath, commandArgs, "Tauri updater configuration")
}

function platformCheck(expected, detail) {
  return {
    label: `platform ${expected}`,
    ok: process.platform === expected,
    detail: process.platform === expected ? process.platform : detail,
  }
}

function envCheck(name, label) {
  return {
    label,
    ok: Boolean(process.env[name]),
    detail: process.env[name] ? `${name} is set` : `${name} is not set`,
  }
}

function envAnyCheck(names, label) {
  const found = names.find((name) => process.env[name])
  return {
    label,
    ok: Boolean(found),
    detail: found ? `${found} is set` : `${names.join(" or ")} is not set`,
  }
}

function firstLine(value) {
  return value.trim().split(/\r?\n/u).at(0) ?? "available"
}

function currentTarget() {
  if (process.platform === "darwin") return "macos"
  if (process.platform === "win32") return "windows"
  if (process.platform === "linux") return "linux"
  return "android"
}

function parseArgs(values) {
  const parsed = {}
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (value === "--") continue
    if (!value?.startsWith("--")) continue
    const key = value.slice(2)
    const next = values[index + 1]
    if (!next || next.startsWith("--")) {
      parsed[key] = "true"
      continue
    }
    parsed[key] = next
    index += 1
  }
  return parsed
}
