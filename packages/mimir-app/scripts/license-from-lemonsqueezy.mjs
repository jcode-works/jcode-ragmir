import { readFile } from "node:fs/promises"
import {
  isoDate,
  licensePayload,
  licenseTier,
  parseArgs,
  positiveInteger,
  readPrivateKey,
  required,
  signLicensePayload,
  yearsFromNow,
} from "./license-core.mjs"

const SUBSCRIPTION_ACTIVE_STATUSES = new Set(["active", "on_trial", "past_due"])
const DEFAULT_UPDATE_YEARS = 2

const args = parseArgs(process.argv.slice(2))
const event = await readEvent(args.event)
const draft = licenseDraftFromLemonSqueezy(event, args)
const privateKeyJwk = await readPrivateKey(args)
const key = await signLicensePayload(draft.payload, privateKeyJwk)

if (args.json) {
  console.log(
    JSON.stringify(
      {
        eventName: draft.eventName,
        sourceType: draft.sourceType,
        holder: draft.payload.holder,
        tier: draft.payload.tier,
        licenseId: draft.payload.licenseId,
        updatesUntil: draft.payload.updatesUntil,
        expiresAt: draft.payload.expiresAt ?? null,
        licenseKey: key,
      },
      null,
      2,
    ),
  )
} else {
  console.log(key)
}

async function readEvent(target) {
  const raw =
    !target || target === "-"
      ? await new Promise((resolve, reject) => {
          let data = ""
          process.stdin.setEncoding("utf8")
          process.stdin.on("data", (chunk) => {
            data += chunk
          })
          process.stdin.on("end", () => resolve(data))
          process.stdin.on("error", reject)
        })
      : await readFile(target, "utf8")
  return JSON.parse(raw)
}

function licenseDraftFromLemonSqueezy(event, values) {
  const data = record(event.data ?? event)
  const attributes = record(data.attributes ?? event.attributes ?? event)
  const sourceType = stringValue(data.type ?? event.type ?? attributes.type ?? "unknown")
  const eventName = stringValue(event.meta?.event_name ?? event.event_name ?? values["event-name"])

  if (sourceType === "subscriptions" || eventName.startsWith("subscription_")) {
    return subscriptionLicenseDraft(attributes, data.id, eventName, sourceType, values)
  }

  return orderLicenseDraft(attributes, data.id, eventName, sourceType, values)
}

function orderLicenseDraft(attributes, id, eventName, sourceType, values) {
  const status = stringValue(attributes.status)
  if (status && status !== "paid" && !values["allow-unpaid"]) {
    throw new Error(`Refusing to issue a license for unpaid order status: ${status}.`)
  }

  const issuedAt = isoDate(
    stringValue(attributes.created_at) || new Date().toISOString(),
    "created_at",
  )
  const updateYears = positiveInteger(
    values["updates-years"] ?? String(DEFAULT_UPDATE_YEARS),
    "updates-years",
  )
  const holder = holderName(attributes)
  const licenseValues = {
    holder,
    tier: values.tier ?? inferTier(attributes),
    "major-version": values["major-version"] ?? "0",
    "license-id":
      values["license-id"] ?? lemonLicenseId("order", firstNonEmpty(attributes.identifier, id)),
    "issued-at": issuedAt,
    "updates-until": values["updates-until"] ?? yearsFromNow(updateYears, issuedAt),
  }

  return {
    eventName,
    sourceType,
    payload: licensePayload(licenseValues),
  }
}

function subscriptionLicenseDraft(attributes, id, eventName, sourceType, values) {
  const status = stringValue(attributes.status)
  if (!SUBSCRIPTION_ACTIVE_STATUSES.has(status) && !values["allow-inactive"]) {
    throw new Error(`Refusing to issue a license for subscription status: ${status || "unknown"}.`)
  }

  const issuedAt = isoDate(
    stringValue(attributes.created_at) || new Date().toISOString(),
    "created_at",
  )
  const expiresAt = firstNonEmpty(values["expires-at"], attributes.renews_at, attributes.ends_at)
  const holder = holderName(attributes)
  const licenseValues = {
    holder,
    tier: values.tier ?? inferTier(attributes),
    "major-version": values["major-version"] ?? "0",
    "license-id":
      values["license-id"] ??
      lemonLicenseId("subscription", firstNonEmpty(id, attributes.order_id)),
    "issued-at": issuedAt,
    "updates-until":
      values["updates-until"] ??
      required(expiresAt, "Subscription renews_at or expires-at is required."),
    "expires-at": required(expiresAt, "Subscription renews_at or expires-at is required."),
  }

  return {
    eventName,
    sourceType,
    payload: licensePayload(licenseValues),
  }
}

function holderName(attributes) {
  const userName = stringValue(attributes.user_name)
  const userEmail = stringValue(attributes.user_email)
  return required(userName || userEmail, "Lemon Squeezy user_name or user_email is required.")
}

function inferTier(attributes) {
  const explicitTier = stringValue(attributes.custom_data?.mimir_tier)
  if (explicitTier) {
    return licenseTier(explicitTier)
  }

  const candidate = [
    attributes.variant_name,
    attributes.product_name,
    attributes.first_order_item?.variant_name,
    attributes.first_order_item?.product_name,
  ]
    .map(stringValue)
    .join(" ")
    .toLowerCase()

  if (candidate.includes("company") || candidate.includes("enterprise")) return "company"
  if (candidate.includes("team")) return "team"
  return "solo"
}

function lemonLicenseId(kind, value) {
  const id = stringValue(value)
  if (!id) {
    throw new Error(`Lemon Squeezy ${kind} id is required.`)
  }
  return `lemonsqueezy:${kind}:${id}`
}

function record(value) {
  return typeof value === "object" && value !== null ? value : {}
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = stringValue(value)
    if (text) {
      return text
    }
  }
  return ""
}

function stringValue(value) {
  if (typeof value === "string") {
    return value.trim()
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value)
  }
  return ""
}
