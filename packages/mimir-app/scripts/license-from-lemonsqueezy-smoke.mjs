import { spawnSync } from "node:child_process"
import { webcrypto } from "node:crypto"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const CONVERTER_SCRIPT = join(SCRIPT_DIR, "license-from-lemonsqueezy.mjs")
const tempDir = await mkdtemp(join(tmpdir(), "mimir-lemonsqueezy-smoke-"))

try {
  const { privateKeyJwk, publicKeyJwk } = await generateKeyPair()
  const privateKeyPath = join(tempDir, "private.jwk")
  await writeFile(privateKeyPath, `${JSON.stringify(privateKeyJwk)}\n`, { mode: 0o600 })

  const orderOutput = await convertEvent({
    privateKeyPath,
    eventName: "order-created.json",
    event: syntheticOrderEvent(),
  })
  await assertLicenseOutput(orderOutput, publicKeyJwk, {
    eventName: "order_created",
    sourceType: "orders",
    tier: "solo",
    licenseId: "lemonsqueezy:order:order-synthetic-001",
    expiresAt: null,
  })

  const subscriptionOutput = await convertEvent({
    privateKeyPath,
    eventName: "subscription-created.json",
    event: syntheticSubscriptionEvent(),
  })
  await assertLicenseOutput(subscriptionOutput, publicKeyJwk, {
    eventName: "subscription_created",
    sourceType: "subscriptions",
    tier: "team",
    licenseId: "lemonsqueezy:subscription:sub-synthetic-001",
    expiresAt: "2026-08-01T00:00:00.000Z",
  })

  console.log("Lemon Squeezy license smoke passed.")
} finally {
  await rm(tempDir, { recursive: true, force: true })
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

async function convertEvent({ privateKeyPath, eventName, event }) {
  const eventPath = join(tempDir, eventName)
  await writeFile(eventPath, `${JSON.stringify(event, null, 2)}\n`, { mode: 0o600 })

  const result = spawnSync(
    process.execPath,
    [
      CONVERTER_SCRIPT,
      "--event",
      eventPath,
      "--private-key",
      privateKeyPath,
      "--major-version",
      "0",
      "--json",
    ],
    { encoding: "utf8", shell: false },
  )

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "license conversion failed")
  }

  return JSON.parse(result.stdout)
}

async function assertLicenseOutput(output, publicKeyJwk, expected) {
  assertEqual(output.eventName, expected.eventName, "eventName")
  assertEqual(output.sourceType, expected.sourceType, "sourceType")
  assertEqual(output.tier, expected.tier, "tier")
  assertEqual(output.licenseId, expected.licenseId, "licenseId")
  assertEqual(output.expiresAt ?? null, expected.expiresAt, "expiresAt")

  const payload = await verifyLicenseKey(output.licenseKey, publicKeyJwk)
  assertEqual(payload.product, "mimir-desktop", "payload.product")
  assertEqual(payload.holder, "Synthetic Buyer", "payload.holder")
  assertEqual(payload.tier, expected.tier, "payload.tier")
  assertEqual(payload.licenseId, expected.licenseId, "payload.licenseId")
  assertEqual(payload.expiresAt ?? null, expected.expiresAt, "payload.expiresAt")
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

function syntheticSubscriptionEvent() {
  return {
    meta: { event_name: "subscription_created" },
    data: {
      type: "subscriptions",
      id: "sub-synthetic-001",
      attributes: {
        status: "active",
        created_at: "2026-06-01T00:00:00.000Z",
        renews_at: "2026-08-01T00:00:00.000Z",
        user_name: "Synthetic Buyer",
        user_email: "buyer@example.test",
        product_name: "Mimir Desktop",
        variant_name: "Mimir Desktop Team",
        custom_data: {
          mimir_tier: "team",
        },
      },
    },
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} mismatch: expected ${expected}, got ${actual}`)
  }
}
