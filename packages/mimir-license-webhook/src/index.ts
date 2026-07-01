const PRODUCT_ID = "mimir-desktop"
const LICENSE_FORMAT = "MIMIR1"
const DEFAULT_MAJOR_VERSION = 0
const DEFAULT_UPDATE_YEARS = 2
const SIGNATURE_HEADER = "x-signature"
const SUBSCRIPTION_ACTIVE_STATUSES = new Set(["active", "on_trial", "past_due"])
const RECORD_ONLY_EVENTS = new Set([
  "order_refunded",
  "subscription_cancelled",
  "subscription_expired",
  "subscription_paused",
  "subscription_payment_failed",
])
type JsonRecord = Record<string, unknown>

type LicenseRecordStore = {
  get(key: string): Promise<string | null>
  put(key: string, value: string): Promise<void>
}

export type LicenseWebhookEnv = {
  LEMONSQUEEZY_WEBHOOK_SECRET?: string
  MIMIR_LICENSE_PRIVATE_KEY_JWK?: string
  MIMIR_LICENSE_MAJOR_VERSION?: string
  MIMIR_LICENSE_UPDATES_YEARS?: string
  MIMIR_LICENSE_DOWNLOAD_URL?: string
  MIMIR_LICENSE_RECORDS?: LicenseRecordStore
}

type LicensePayload = {
  product: typeof PRODUCT_ID
  licenseId: string
  holder: string
  tier: "solo" | "team" | "company"
  majorVersion: number
  issuedAt: string
  updatesUntil: string
  expiresAt?: string
}

type LemonEventSummary = {
  eventName: string
  sourceType: string
  sourceId: string
  idempotencyKey: string
}

type LicenseDraft = LemonEventSummary & {
  action: "license_issued"
  payload: LicensePayload
}

type RecordOnlyDraft = LemonEventSummary & {
  action: "record_only"
  licenseId: string
}

type WebhookDraft = LicenseDraft | RecordOnlyDraft

type WebhookResponseBody = JsonRecord & {
  ok: true
  action: WebhookDraft["action"]
  eventName: string
  sourceType: string
  sourceId: string
  idempotencyKey: string
  licenseId: string
}

export default {
  async fetch(request: Request, env: LicenseWebhookEnv): Promise<Response> {
    return handleLicenseWebhook(request, env)
  },
}

export async function handleLicenseWebhook(
  request: Request,
  env: LicenseWebhookEnv,
): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405)
  }

  const webhookSecret = requiredEnv(env.LEMONSQUEEZY_WEBHOOK_SECRET, "LEMONSQUEEZY_WEBHOOK_SECRET")
  const rawBody = await request.text()
  const signature = request.headers.get(SIGNATURE_HEADER)

  if (!signature || !(await verifyLemonSqueezySignature(rawBody, signature, webhookSecret))) {
    return jsonResponse({ ok: false, error: "invalid_signature" }, 401)
  }

  try {
    const event = parseJsonRecord(rawBody)
    const draft = draftFromLemonSqueezyEvent(event, env)
    const store = requiredStore(env.MIMIR_LICENSE_RECORDS)
    const storedBody = await readStoredBody(store, draft.idempotencyKey)

    if (storedBody) {
      return jsonResponse({ ...storedBody, idempotentReplay: true })
    }

    if (draft.action === "record_only") {
      const body: WebhookResponseBody = {
        ok: true,
        action: draft.action,
        eventName: draft.eventName,
        sourceType: draft.sourceType,
        sourceId: draft.sourceId,
        idempotencyKey: draft.idempotencyKey,
        licenseId: draft.licenseId,
      }
      await storeBody(store, body)
      return jsonResponse(body)
    }

    const privateKeyJwk = JSON.parse(
      requiredEnv(env.MIMIR_LICENSE_PRIVATE_KEY_JWK, "MIMIR_LICENSE_PRIVATE_KEY_JWK"),
    )
    const licenseKey = await signLicensePayload(draft.payload, privateKeyJwk)
    const body: WebhookResponseBody = {
      ok: true,
      action: draft.action,
      eventName: draft.eventName,
      sourceType: draft.sourceType,
      sourceId: draft.sourceId,
      idempotencyKey: draft.idempotencyKey,
      holder: draft.payload.holder,
      tier: draft.payload.tier,
      licenseId: draft.payload.licenseId,
      updatesUntil: draft.payload.updatesUntil,
      expiresAt: draft.payload.expiresAt ?? null,
      downloadUrl: env.MIMIR_LICENSE_DOWNLOAD_URL ?? null,
      licenseKey,
    }
    await storeBody(store, body)
    return jsonResponse(body)
  } catch (error) {
    return jsonResponse(
      { ok: false, error: error instanceof Error ? error.message : "license_webhook_failed" },
      400,
    )
  }
}

export async function verifyLemonSqueezySignature(
  rawBody: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const expected = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody))
  return timingSafeEqual(normalizeHex(signature), bytesToHex(new Uint8Array(expected)))
}

function draftFromLemonSqueezyEvent(event: JsonRecord, env: LicenseWebhookEnv): WebhookDraft {
  const data = record(event.data ?? event)
  const attributes = record(data.attributes ?? event.attributes ?? event)
  const meta = record(event.meta)
  const sourceType = stringValue(data.type ?? event.type ?? attributes.type ?? "unknown")
  const sourceId = required(
    stringValue(data.id ?? attributes.identifier ?? attributes.order_id),
    "Lemon Squeezy source id is required.",
  )
  const eventName = stringValue(meta.event_name ?? event.event_name)
  const summary = {
    eventName,
    sourceType,
    sourceId,
    idempotencyKey: `${eventName || sourceType}:${sourceId}`,
  }

  if (RECORD_ONLY_EVENTS.has(eventName)) {
    return {
      ...summary,
      action: "record_only",
      licenseId: lemonLicenseId(
        sourceType === "subscriptions" ? "subscription" : "order",
        sourceId,
      ),
    }
  }

  if (sourceType === "subscriptions" || eventName.startsWith("subscription_")) {
    return {
      ...summary,
      action: "license_issued",
      payload: subscriptionLicensePayload(attributes, sourceId, env),
    }
  }

  return {
    ...summary,
    action: "license_issued",
    payload: orderLicensePayload(attributes, sourceId, env),
  }
}

function orderLicensePayload(
  attributes: JsonRecord,
  sourceId: string,
  env: LicenseWebhookEnv,
): LicensePayload {
  const status = stringValue(attributes.status)
  if (status && status !== "paid") {
    throw new Error(`Refusing to issue a license for unpaid order status: ${status}.`)
  }

  const issuedAt = isoDate(stringValue(attributes.created_at) || new Date().toISOString())
  const updateYears = positiveInteger(env.MIMIR_LICENSE_UPDATES_YEARS, DEFAULT_UPDATE_YEARS)
  return {
    product: PRODUCT_ID,
    licenseId: lemonLicenseId("order", firstNonEmpty(attributes.identifier, sourceId)),
    holder: holderName(attributes),
    tier: inferTier(attributes),
    majorVersion: positiveInteger(env.MIMIR_LICENSE_MAJOR_VERSION, DEFAULT_MAJOR_VERSION),
    issuedAt,
    updatesUntil: yearsFromNow(updateYears, issuedAt),
  }
}

function subscriptionLicensePayload(
  attributes: JsonRecord,
  sourceId: string,
  env: LicenseWebhookEnv,
): LicensePayload {
  const status = stringValue(attributes.status)
  if (!SUBSCRIPTION_ACTIVE_STATUSES.has(status)) {
    throw new Error(`Refusing to issue a license for subscription status: ${status || "unknown"}.`)
  }

  const issuedAt = isoDate(stringValue(attributes.created_at) || new Date().toISOString())
  const expiresAt = required(
    firstNonEmpty(attributes.renews_at, attributes.ends_at),
    "Subscription renews_at or ends_at is required.",
  )
  return {
    product: PRODUCT_ID,
    licenseId: lemonLicenseId("subscription", sourceId),
    holder: holderName(attributes),
    tier: inferTier(attributes),
    majorVersion: positiveInteger(env.MIMIR_LICENSE_MAJOR_VERSION, DEFAULT_MAJOR_VERSION),
    issuedAt,
    updatesUntil: isoDate(expiresAt),
    expiresAt: isoDate(expiresAt),
  }
}

async function signLicensePayload(payload: LicensePayload, privateKeyJwk: JsonWebKey) {
  const encodedPayload = base64UrlFromString(JSON.stringify(payload))
  const key = await crypto.subtle.importKey(
    "jwk",
    privateKeyJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  )
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(encodedPayload),
  )
  return `${LICENSE_FORMAT}.${encodedPayload}.${base64UrlFromBytes(new Uint8Array(signature))}`
}

function holderName(attributes: JsonRecord) {
  return required(
    stringValue(attributes.user_name) || stringValue(attributes.user_email),
    "Lemon Squeezy user_name or user_email is required.",
  )
}

function inferTier(attributes: JsonRecord): LicensePayload["tier"] {
  const customData = record(attributes.custom_data)
  const explicitTier = stringValue(customData.mimir_tier)
  if (explicitTier) return licenseTier(explicitTier)

  const firstOrderItem = record(attributes.first_order_item)
  const candidate = [
    attributes.variant_name,
    attributes.product_name,
    firstOrderItem.variant_name,
    firstOrderItem.product_name,
  ]
    .map(stringValue)
    .join(" ")
    .toLowerCase()

  if (candidate.includes("company") || candidate.includes("enterprise")) return "company"
  if (candidate.includes("team")) return "team"
  return "solo"
}

function licenseTier(value: string): LicensePayload["tier"] {
  if (value === "solo" || value === "team" || value === "company") {
    return value
  }
  throw new Error("tier must be solo, team, or company.")
}

function lemonLicenseId(kind: "order" | "subscription", value: unknown) {
  return `lemonsqueezy:${kind}:${required(stringValue(value), `Lemon Squeezy ${kind} id is required.`)}`
}

function parseJsonRecord(rawBody: string) {
  try {
    return record(JSON.parse(rawBody))
  } catch {
    throw new Error("Webhook body must be valid JSON.")
  }
}

function jsonResponse(body: JsonRecord, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  })
}

async function readStoredBody(
  store: LicenseRecordStore,
  idempotencyKey: string,
): Promise<WebhookResponseBody | null> {
  const stored = await store.get(storageKey(idempotencyKey))
  if (!stored) return null
  const parsed = record(JSON.parse(stored))
  if (isWebhookResponseBody(parsed)) {
    return parsed
  }
  throw new Error("Stored license webhook record is invalid.")
}

async function storeBody(store: LicenseRecordStore, body: WebhookResponseBody) {
  await store.put(storageKey(body.idempotencyKey), JSON.stringify(body))
}

function storageKey(idempotencyKey: string) {
  return `lemon:${idempotencyKey}`
}

function isWebhookResponseBody(value: JsonRecord): value is WebhookResponseBody {
  return (
    value.ok === true &&
    (value.action === "license_issued" || value.action === "record_only") &&
    typeof value.eventName === "string" &&
    typeof value.sourceType === "string" &&
    typeof value.sourceId === "string" &&
    typeof value.idempotencyKey === "string" &&
    typeof value.licenseId === "string"
  )
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? String(fallback), 10)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("value must be a positive integer.")
  }
  return parsed
}

function isoDate(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    throw new Error("value must be a valid date.")
  }
  return date.toISOString()
}

function yearsFromNow(years: number, from: Date | string = new Date()) {
  const date = new Date(from)
  date.setFullYear(date.getFullYear() + years)
  return date.toISOString()
}

function required(value: string, message: string) {
  if (!value) {
    throw new Error(message)
  }
  return value
}

function requiredEnv(value: string | undefined, name: string) {
  if (!value) {
    throw new Error(`${name} is required.`)
  }
  return value
}

function requiredStore(value: LicenseRecordStore | undefined) {
  if (!value) {
    throw new Error("MIMIR_LICENSE_RECORDS KV binding is required.")
  }
  return value
}

function firstNonEmpty(...values: unknown[]) {
  for (const value of values) {
    const text = stringValue(value)
    if (text) return text
  }
  return ""
}

function record(value: unknown): JsonRecord {
  return isRecord(value) ? value : {}
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim()
  if (typeof value === "number" || typeof value === "bigint") return String(value)
  return ""
}

function normalizeHex(value: string) {
  return value.trim().toLowerCase()
}

function timingSafeEqual(left: string, right: string) {
  const maxLength = Math.max(left.length, right.length)
  let mismatch = left.length === right.length ? 0 : 1
  for (let index = 0; index < maxLength; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
  }
  return mismatch === 0
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function base64UrlFromString(value: string) {
  return base64UrlFromBytes(new TextEncoder().encode(value))
}

function base64UrlFromBytes(bytes: Uint8Array) {
  let binary = ""
  const chunkSize = 8192
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize))
  }
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "")
}
