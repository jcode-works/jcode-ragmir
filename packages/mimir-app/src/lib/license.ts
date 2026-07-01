const LICENSE_STORAGE_KEY = "mimir.licenseKey.v1"
const LICENSE_FORMAT = "MIMIR1"
const PRODUCT_ID = "mimir-desktop"
const CURRENT_MAJOR_VERSION = 0

export type LicenseTier = "solo" | "team" | "company"

export interface LicensePayload {
  product: typeof PRODUCT_ID
  licenseId: string
  holder: string
  tier: LicenseTier
  majorVersion: number
  issuedAt: string
  updatesUntil: string
  expiresAt?: string
}

export type LicenseValidation =
  | {
      status: "empty"
      message: string
    }
  | {
      status: "unconfigured"
      message: string
    }
  | {
      status: "invalid"
      message: string
    }
  | {
      status: "expired"
      message: string
      payload: LicensePayload
    }
  | {
      status: "valid"
      message: string
      payload: LicensePayload
      updatesExpired: boolean
    }

type PublicLicenseKey = JsonWebKey & { kty: "EC"; crv: "P-256"; x: string; y: string }
type LicensePayloadCheck =
  | {
      ok: true
      payload: LicensePayload
    }
  | {
      ok: false
      message: string
    }

export function loadLicenseKey(storage = browserStorage()): string {
  return storage?.getItem(LICENSE_STORAGE_KEY) ?? ""
}

export function saveLicenseKey(licenseKey: string, storage = browserStorage()): void {
  storage?.setItem(LICENSE_STORAGE_KEY, licenseKey)
}

export function clearLicenseKey(storage = browserStorage()): void {
  storage?.removeItem(LICENSE_STORAGE_KEY)
}

export async function validateLicenseKey(
  licenseKey: string,
  now = new Date(),
): Promise<LicenseValidation> {
  const trimmed = licenseKey.trim()
  if (!trimmed) {
    return { status: "empty", message: "No license key is installed." }
  }

  const publicKey = configuredPublicKey()
  if (!publicKey) {
    return {
      status: "unconfigured",
      message: "License validation needs a build-time public key.",
    }
  }

  const parts = trimmed.split(".")
  if (parts.length !== 3 || parts[0] !== LICENSE_FORMAT) {
    return { status: "invalid", message: "License key format is invalid." }
  }

  const [, encodedPayload, encodedSignature] = parts
  if (!encodedPayload || !encodedSignature) {
    return { status: "invalid", message: "License key is incomplete." }
  }

  const decodedPayload = decodePayload(encodedPayload)
  if (!decodedPayload) {
    return { status: "invalid", message: "License payload is invalid." }
  }

  const payloadCheck = licensePayloadCheck(decodedPayload)
  if (!payloadCheck.ok) {
    return { status: "invalid", message: payloadCheck.message }
  }
  const { payload } = payloadCheck

  const signatureValid = await verifyLicenseSignature(publicKey, encodedPayload, encodedSignature)
  if (!signatureValid) {
    return { status: "invalid", message: "License signature is invalid." }
  }

  if (payload.majorVersion !== CURRENT_MAJOR_VERSION) {
    return {
      status: "invalid",
      message: `License is for major ${payload.majorVersion}, this app is major ${CURRENT_MAJOR_VERSION}.`,
    }
  }

  if (payload.expiresAt && dateHasPassed(payload.expiresAt, now)) {
    return {
      status: "expired",
      message: "License has expired.",
      payload,
    }
  }

  const updatesExpired = dateHasPassed(payload.updatesUntil, now)
  return {
    status: "valid",
    message: updatesExpired ? "License is active; update window expired." : "License is active.",
    payload,
    updatesExpired,
  }
}

function configuredPublicKey(): PublicLicenseKey | null {
  const raw = import.meta.env.VITE_MIMIR_LICENSE_PUBLIC_KEY_JWK
  if (!raw) {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(raw)
    return isPublicLicenseKey(parsed) ? parsed : null
  } catch {
    return null
  }
}

function decodePayload(encodedPayload: string): unknown | null {
  try {
    return JSON.parse(textFromBase64Url(encodedPayload))
  } catch {
    return null
  }
}

function licensePayloadCheck(value: unknown): LicensePayloadCheck {
  if (!isRecord(value)) return { ok: false, message: "License payload is invalid." }
  if (value.product !== PRODUCT_ID)
    return { ok: false, message: "License product is not Mimir Desktop." }
  if (typeof value.licenseId !== "string") return { ok: false, message: "License id is missing." }
  if (!value.licenseId.trim()) return { ok: false, message: "License id is missing." }
  if (typeof value.holder !== "string") return { ok: false, message: "License holder is missing." }
  if (!value.holder.trim()) return { ok: false, message: "License holder is missing." }
  if (!isLicenseTier(value.tier)) return { ok: false, message: "License tier is invalid." }
  if (
    typeof value.majorVersion !== "number" ||
    !Number.isInteger(value.majorVersion) ||
    value.majorVersion < 0
  ) {
    return { ok: false, message: "License major version is invalid." }
  }
  if (typeof value.issuedAt !== "string" || !isIsoDate(value.issuedAt)) {
    return { ok: false, message: "License issue date is invalid." }
  }
  if (typeof value.updatesUntil !== "string" || !isIsoDate(value.updatesUntil)) {
    return { ok: false, message: "License update window is invalid." }
  }
  if (
    value.expiresAt !== undefined &&
    (typeof value.expiresAt !== "string" || !isIsoDate(value.expiresAt))
  ) {
    return { ok: false, message: "License expiration date is invalid." }
  }
  return {
    ok: true,
    payload: {
      product: PRODUCT_ID,
      licenseId: value.licenseId,
      holder: value.holder,
      tier: value.tier,
      majorVersion: value.majorVersion,
      issuedAt: value.issuedAt,
      updatesUntil: value.updatesUntil,
      ...(value.expiresAt ? { expiresAt: value.expiresAt } : {}),
    },
  }
}

async function verifyLicenseSignature(
  publicKey: PublicLicenseKey,
  encodedPayload: string,
  encodedSignature: string,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      publicKey,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    )
    return crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      bytesFromBase64Url(encodedSignature),
      new TextEncoder().encode(encodedPayload),
    )
  } catch {
    return false
  }
}

function textFromBase64Url(value: string): string {
  return new TextDecoder().decode(bytesFromBase64Url(value))
}

function bytesFromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/gu, "+").replace(/_/gu, "/")
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function dateHasPassed(value: string, now: Date): boolean {
  return new Date(value).getTime() < now.getTime()
}

function isIsoDate(value: string): boolean {
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp)
}

function isLicenseTier(value: unknown): value is LicenseTier {
  return value === "solo" || value === "team" || value === "company"
}

function isPublicLicenseKey(value: unknown): value is PublicLicenseKey {
  return (
    isRecord(value) &&
    value.kty === "EC" &&
    value.crv === "P-256" &&
    typeof value.x === "string" &&
    typeof value.y === "string"
  )
}

function browserStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
