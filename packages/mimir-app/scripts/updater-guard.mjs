import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_CONFIG_PATH = resolve(SCRIPT_DIR, "../src-tauri/tauri.conf.json")
const PLACEHOLDER_PATTERNS = [
  /CONTENT FROM PUBLICKEY\.PEM/iu,
  /\b(change-?me|placeholder|todo|fake|dummy)\b/iu,
  /releases\.myapp\.com/iu,
  /github\.com\/user\/repo/iu,
  /example\.(com|org|net)/iu,
  /localhost|127\.0\.0\.1|0\.0\.0\.0/iu,
]

const args = parseArgs(process.argv.slice(2))
const configPath = resolve(process.cwd(), args.config ?? DEFAULT_CONFIG_PATH)
const config = readConfig(configPath)
const checks = auditUpdaterConfig(config, {
  requirePrivateKey: Boolean(args["require-private-key"]),
})
const ok = checks.every((check) => check.ok)

if (args.json) {
  console.log(JSON.stringify({ configPath, ok, checks }, null, 2))
} else {
  console.log(`Mimir app updater config: ${ok ? "ok" : "needs attention"}`)
  for (const check of checks) {
    console.log(`${check.ok ? "ok" : "missing"} ${check.label}: ${check.detail}`)
  }
}

if (!ok) {
  process.exitCode = 1
}

function readConfig(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch (error) {
    throw new Error(`failed to read Tauri config at ${path}: ${error.message}`)
  }
}

function auditUpdaterConfig(value, options) {
  const bundle = isRecord(value.bundle) ? value.bundle : {}
  const plugins = isRecord(value.plugins) ? value.plugins : {}
  const updater = isRecord(plugins.updater) ? plugins.updater : undefined
  const createUpdaterArtifacts = bundle.createUpdaterArtifacts
  const updaterSignals = Boolean(updater) || typeof createUpdaterArtifacts !== "undefined"

  if (!updaterSignals) {
    return [
      {
        label: "updater disabled",
        ok: true,
        detail: "manual direct-download updates remain the active release path",
      },
    ]
  }

  const checks = [
    {
      label: "bundle.createUpdaterArtifacts",
      ok: createUpdaterArtifacts === true,
      detail:
        createUpdaterArtifacts === true
          ? "v2 updater artifacts enabled"
          : "must be true when the updater is configured",
    },
    {
      label: "plugins.updater",
      ok: Boolean(updater),
      detail: updater ? "updater plugin config present" : "missing updater plugin config",
    },
  ]

  if (updater) {
    checks.push(...updaterChecks(updater))
  }

  if (options.requirePrivateKey && updaterSignals) {
    const hasPrivateKey =
      Boolean(process.env.TAURI_SIGNING_PRIVATE_KEY) ||
      Boolean(process.env.TAURI_SIGNING_PRIVATE_KEY_PATH)
    checks.push({
      label: "updater private key",
      ok: hasPrivateKey,
      detail: hasPrivateKey
        ? "TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH is set"
        : "set TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH in release secrets",
    })
  }

  return checks
}

function updaterChecks(updater) {
  const pubkey = typeof updater.pubkey === "string" ? updater.pubkey.trim() : ""
  const endpoints = Array.isArray(updater.endpoints) ? updater.endpoints : []

  return [
    {
      label: "updater pubkey",
      ok: isRealValue(pubkey) && pubkey.length >= 32,
      detail:
        isRealValue(pubkey) && pubkey.length >= 32
          ? "public updater key present"
          : "commit a real Tauri updater public key before enabling updates",
    },
    {
      label: "updater endpoints",
      ok:
        endpoints.length > 0 &&
        endpoints.every((endpoint) => typeof endpoint === "string" && isValidEndpoint(endpoint)),
      detail:
        endpoints.length > 0
          ? "all endpoints must be non-placeholder HTTPS URLs"
          : "add at least one HTTPS update endpoint or static manifest URL",
    },
  ]
}

function isValidEndpoint(value) {
  if (!isRealValue(value)) return false

  try {
    const url = new URL(value)
    return url.protocol === "https:" && !isPlaceholder(value)
  } catch {
    return false
  }
}

function isRealValue(value) {
  return value.trim().length > 0 && !isPlaceholder(value)
}

function isPlaceholder(value) {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value))
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
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
