import { webcrypto } from "node:crypto"

const { handleLicenseWebhook } = await import("../dist/index.js")
const { privateKeyJwk, publicKeyJwk } = await generateKeyPair()
const env = {
  LEMONSQUEEZY_WEBHOOK_SECRET: "synthetic-webhook-secret",
  MIMIR_LICENSE_PRIVATE_KEY_JWK: JSON.stringify(privateKeyJwk),
  MIMIR_LICENSE_MAJOR_VERSION: "0",
  MIMIR_LICENSE_DOWNLOAD_URL: "https://mimir.jcode.works/download",
}

await smokeOrderLicense(publicKeyJwk)
await smokeInvalidSignature()
await smokeRecordOnlyEvent()

console.log("License webhook smoke passed.")

async function smokeOrderLicense(publicKeyJwk) {
  const body = JSON.stringify(syntheticOrderEvent())
  const response = await handleLicenseWebhook(await signedRequest(body), env)
  assertEqual(response.status, 200, "order response status")
  const output = await response.json()
  assertEqual(output.ok, true, "order ok")
  assertEqual(output.action, "license_issued", "order action")
  assertEqual(output.eventName, "order_created", "order eventName")
  assertEqual(output.licenseId, "lemonsqueezy:order:order-synthetic-001", "order licenseId")
  assertEqual(output.downloadUrl, "https://mimir.jcode.works/download", "order downloadUrl")

  const payload = await verifyLicenseKey(output.licenseKey, publicKeyJwk)
  assertEqual(payload.product, "mimir-desktop", "payload product")
  assertEqual(payload.holder, "Synthetic Buyer", "payload holder")
  assertEqual(payload.tier, "solo", "payload tier")
  assertEqual(payload.majorVersion, 0, "payload majorVersion")
  assertEqual(payload.licenseId, "lemonsqueezy:order:order-synthetic-001", "payload licenseId")
}

async function smokeInvalidSignature() {
  const response = await handleLicenseWebhook(
    new Request("https://mimir-license-webhook.test/lemonsqueezy", {
      method: "POST",
      headers: { "x-signature": "bad-signature" },
      body: JSON.stringify(syntheticOrderEvent()),
    }),
    env,
  )
  assertEqual(response.status, 401, "invalid signature response status")
}

async function smokeRecordOnlyEvent() {
  const body = JSON.stringify(syntheticSubscriptionCancelledEvent())
  const response = await handleLicenseWebhook(await signedRequest(body), env)
  assertEqual(response.status, 200, "record-only response status")
  const output = await response.json()
  assertEqual(output.ok, true, "record-only ok")
  assertEqual(output.action, "record_only", "record-only action")
  assertEqual(output.eventName, "subscription_cancelled", "record-only eventName")
  assertEqual(
    output.licenseId,
    "lemonsqueezy:subscription:sub-synthetic-001",
    "record-only licenseId",
  )
  if ("licenseKey" in output) {
    throw new Error("record-only events must not issue license keys")
  }
}

async function signedRequest(body) {
  return new Request("https://mimir-license-webhook.test/lemonsqueezy", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature": await lemonSignature(body, env.LEMONSQUEEZY_WEBHOOK_SECRET),
    },
    body,
  })
}

async function generateKeyPair() {
  const keyPair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])
  return {
    privateKeyJwk: await webcrypto.subtle.exportKey("jwk", keyPair.privateKey),
    publicKeyJwk: await webcrypto.subtle.exportKey("jwk", keyPair.publicKey),
  }
}

async function lemonSignature(body, secret) {
  const key = await webcrypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signature = await webcrypto.subtle.sign("HMAC", key, new TextEncoder().encode(body))
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  )
}

async function verifyLicenseKey(licenseKey, publicKeyJwk) {
  const parts = String(licenseKey).split(".")
  if (parts.length !== 3 || parts[0] !== "MIMIR1") {
    throw new Error("license key must use MIMIR1.payload.signature format")
  }

  const [, encodedPayload, encodedSignature] = parts
  const key = await webcrypto.subtle.importKey(
    "jwk",
    publicKeyJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  )
  const ok = await webcrypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    Buffer.from(encodedSignature, "base64url"),
    new TextEncoder().encode(encodedPayload),
  )

  if (!ok) {
    throw new Error("license signature verification failed")
  }

  return JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"))
}

function syntheticOrderEvent() {
  return {
    meta: { event_name: "order_created" },
    data: {
      type: "orders",
      id: "order-synthetic-id",
      attributes: {
        identifier: "order-synthetic-001",
        status: "paid",
        created_at: "2026-06-01T00:00:00.000Z",
        user_name: "Synthetic Buyer",
        user_email: "buyer@example.test",
        product_name: "Mimir Desktop",
        variant_name: "Mimir Desktop Solo",
      },
    },
  }
}

function syntheticSubscriptionCancelledEvent() {
  return {
    meta: { event_name: "subscription_cancelled" },
    data: {
      type: "subscriptions",
      id: "sub-synthetic-001",
      attributes: {
        status: "cancelled",
        created_at: "2026-06-01T00:00:00.000Z",
        user_name: "Synthetic Buyer",
        user_email: "buyer@example.test",
        product_name: "Mimir Desktop",
        variant_name: "Mimir Desktop Team",
      },
    },
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} mismatch: expected ${expected}, got ${actual}`)
  }
}
