import { randomUUID, webcrypto } from "node:crypto"
import { readFile } from "node:fs/promises"

export const PRODUCT_ID = "mimir-desktop"
export const LICENSE_FORMAT = "MIMIR1"
export const LICENSE_TIERS = new Set(["solo", "team", "company"])

export async function readPrivateKey(values) {
  if (values["private-key"]) {
    return JSON.parse(await readFile(values["private-key"], "utf8"))
  }
  if (process.env.MIMIR_LICENSE_PRIVATE_KEY_JWK) {
    return JSON.parse(process.env.MIMIR_LICENSE_PRIVATE_KEY_JWK)
  }
  throw new Error("Provide --private-key <path> or MIMIR_LICENSE_PRIVATE_KEY_JWK.")
}

export async function signLicensePayload(payload, privateKeyJwk) {
  const encodedPayload = base64Url(JSON.stringify(payload))
  const key = await webcrypto.subtle.importKey(
    "jwk",
    privateKeyJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  )
  const signature = await webcrypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(encodedPayload),
  )

  return `${LICENSE_FORMAT}.${encodedPayload}.${base64Url(signature)}`
}

export function licensePayload(values) {
  const holder = required(values.holder, "--holder is required.")
  return {
    product: PRODUCT_ID,
    licenseId: values["license-id"] ?? randomUUID(),
    holder,
    tier: licenseTier(values.tier),
    majorVersion: positiveInteger(values["major-version"] ?? "0", "major-version"),
    issuedAt: isoDate(values["issued-at"] ?? new Date().toISOString(), "issued-at"),
    updatesUntil: isoDate(values["updates-until"] ?? yearsFromNow(2), "updates-until"),
    ...(values["expires-at"] ? { expiresAt: isoDate(values["expires-at"], "expires-at") } : {}),
  }
}

export function licenseTier(value) {
  const tier = value ?? "solo"
  if (LICENSE_TIERS.has(tier)) {
    return tier
  }
  throw new Error("tier must be solo, team, or company.")
}

export function positiveInteger(value, label) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a positive integer.`)
  }
  return parsed
}

export function isoDate(value, label) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`${label} must be a valid date.`)
  }
  return date.toISOString()
}

export function yearsFromNow(years, from = new Date()) {
  const date = new Date(from)
  date.setFullYear(date.getFullYear() + years)
  return date.toISOString()
}

export function required(value, message) {
  if (!value) {
    throw new Error(message)
  }
  return value
}

export function parseArgs(values) {
  const parsed = {}
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
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

function base64Url(value) {
  const bytes =
    typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(new Uint8Array(value))
  return bytes.toString("base64url")
}
