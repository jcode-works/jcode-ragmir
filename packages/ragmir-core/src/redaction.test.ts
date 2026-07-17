import { describe, expect, it } from "vitest"
import { chunkDocument } from "./chunking.js"
import { redactDocument, redactText } from "./redaction.js"
import { testConfig } from "./test-support/config.js"
import type { ParsedDocument } from "./types.js"

// Build the PEM header from a variable so the repo's public-surface secret scanner
// (scripts/public-surface-smoke.mjs) does not flag this fixture as a real leaked key.
function pemPrivateKeyFixture(): string {
  const label = "RSA PRIVATE KEY"
  return `-----BEGIN ${label}-----\nMIIByzqABC123secret\n-----END ${label}-----`
}

// Assemble the connection string from parts so GitHub secret scanning does not flag this
// fixture as a real Postgres credential. The runtime value is unchanged, so redactText still
// sees a complete `scheme://user:pass@host` URL to strip.
function urlWithCredentialsFixture(): string {
  const scheme = "postgres"
  const password = "s3cr3tPass"
  return `${scheme}://admin:${password}@db.internal:5432/app`
}

describe("redactText", () => {
  it("redacts built-in sensitive identifiers before indexing", () => {
    const config = testConfig()
    const result = redactText("Contact me at user@example.com.", config)

    expect(result.text).toContain("[REDACTED_EMAIL]")
    expect(result.text).not.toContain("user@example.com")
    expect(result.counts).toEqual([{ name: "email", count: 1 }])
  })

  it("supports custom repository patterns", () => {
    const config = testConfig({
      redaction: {
        enabled: true,
        builtIn: false,
        patterns: [{ name: "client_id", pattern: "CLIENT-[0-9]+", replacement: "[CLIENT]" }],
      },
    })

    expect(redactText("CLIENT-12345", config).text).toBe("[CLIENT]")
  })

  it.each([
    {
      name: "private key",
      sample: pemPrivateKeyFixture(),
      token: "[REDACTED_PRIVATE_KEY]",
      leaked: "MIIByzqABC123secret",
    },
    {
      name: "JWT",
      sample:
        "auth eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJ done",
      token: "[REDACTED_JWT]",
      leaked: "eyJhbGciOiJIUzI1NiJ9",
    },
    {
      name: "npm token",
      sample: "npm_0123456789abcdefghijklmnopqrstuvwxyz",
      token: "[REDACTED_API_TOKEN]",
      leaked: "npm_0123456789abcdefghijklmnopqrstuvwxyz",
    },
    {
      name: "OpenAI key",
      sample: "key sk-proj-0123456789abcdefghijklmnopqrstuvwxyz done",
      token: "[REDACTED_OPENAI_API_KEY]",
      leaked: "sk-proj-0123456789abcdefghijklmnopqrstuvwxyz",
    },
    {
      name: "AWS access key id",
      sample: "AKIAIOSFODNN7EXAMPLE",
      token: "[REDACTED_AWS_ACCESS_KEY_ID]",
      leaked: "AKIAIOSFODNN7EXAMPLE",
    },
    {
      name: "Google API key",
      sample: `AIza${"x".repeat(35)}`,
      token: "[REDACTED_GOOGLE_API_KEY]",
      leaked: `AIza${"x".repeat(35)}`,
    },
    {
      name: "Slack token",
      sample: "xoxb-012345678901234567",
      token: "[REDACTED_SLACK_TOKEN]",
      leaked: "xoxb-012345678901234567",
    },
    {
      name: "IBAN",
      sample: "wire IBAN DE89370400440532013000 today",
      token: "[REDACTED_IBAN]",
      leaked: "DE89370400440532013000",
    },
    {
      name: "credit card",
      sample: "card 4111 1111 1111 1111 exp",
      token: "[REDACTED_CREDIT_CARD]",
      leaked: "4111 1111 1111 1111",
    },
    {
      name: "Stripe secret key",
      sample: `sk_live_${"a".repeat(24)}`,
      token: "[REDACTED_STRIPE_SECRET_KEY]",
      leaked: `sk_live_${"a".repeat(24)}`,
    },
    {
      name: "GitLab token",
      sample: `glpat-${"0".repeat(20)}`,
      token: "[REDACTED_GITLAB_TOKEN]",
      leaked: `glpat-${"0".repeat(20)}`,
    },
    {
      name: "bearer token",
      sample: `Authorization: Bearer ${"a".repeat(40)}`,
      token: "[REDACTED_BEARER_TOKEN]",
      leaked: `${"a".repeat(40)}`,
    },
    {
      name: "URL credentials",
      sample: urlWithCredentialsFixture(),
      token: "[REDACTED_URL_CREDENTIALS]",
      leaked: "s3cr3tPass",
    },
  ])("redacts a $name before indexing", ({ sample, token, leaked }) => {
    const result = redactText(sample, testConfig())

    expect(result.text).toContain(token)
    expect(result.text).not.toContain(leaked)
  })

  it("returns text unchanged when redaction is disabled", () => {
    const secret = "contact user@example.com with key sk-proj-0123456789abcdefghijklmno"
    const config = testConfig({ redaction: { enabled: false, builtIn: true, patterns: [] } })

    const result = redactText(secret, config)

    expect(result.text).toBe(secret)
    expect(result.counts).toEqual([])
  })

  it("only redacts credit-card numbers that pass the Luhn checksum", () => {
    const config = testConfig()
    // 4111 1111 1111 1111 is a valid Luhn test card.
    const valid = redactText("card 4111 1111 1111 1111 done", config)
    expect(valid.text).toContain("[REDACTED_CREDIT_CARD]")

    // Same length, fails Luhn: must be preserved (no over-redaction).
    const invalid = redactText("ref 4111 1111 1111 1112 done", config)
    expect(invalid.text).not.toContain("[REDACTED_CREDIT_CARD]")
    expect(invalid.text).toContain("4111 1111 1111 1112")
  })

  it("redacts both the username and password in URLs with credentials", () => {
    const config = testConfig()
    const result = redactText(urlWithCredentialsFixture(), config)

    expect(result.text).not.toContain("s3cr3tPass")
    expect(result.text).not.toContain("admin")
  })

  it("does not match obfuscated or cross-line secrets (documented limitation)", () => {
    const config = testConfig()
    // Whitespace inserted inside a token is NOT caught: redaction is pattern-based,
    // not context-aware. This documents the boundary honestly rather than claiming coverage.
    const obfuscated = "key sk-proj- 0123456789abcdefghijklmnopqrstuvwxyz"
    const result = redactText(obfuscated, config)

    expect(result.text).toBe(obfuscated)
  })

  it("should preserve page provenance when an earlier page changes length", () => {
    const pageOne = "Contact first-page@example.com for access."
    const pageTwo = "Page two contains the durable decision."
    const text = `${pageOne}\n\n${pageTwo}`
    const document: ParsedDocument = {
      file: {
        absolutePath: "/tmp/pages.pdf",
        relativePath: "pages.pdf",
        source: "pages.pdf",
        extension: ".pdf",
        bytes: text.length,
        mtimeMs: 1,
        checksum: "pages",
      },
      text,
      sourceLineCoordinates: false,
      pages: [
        { pageNumber: 1, charStart: 0, charEnd: pageOne.length },
        { pageNumber: 2, charStart: pageOne.length + 2, charEnd: text.length },
      ],
      regions: [
        {
          charStart: 0,
          charEnd: pageOne.length,
          contextPath: "Page 1",
          location: { kind: "page", start: 1, end: 1 },
        },
        {
          charStart: pageOne.length + 2,
          charEnd: text.length,
          contextPath: "Page 2",
          location: { kind: "page", start: 2, end: 2 },
        },
      ],
    }

    const redacted = redactDocument(document, testConfig())
    const chunks = chunkDocument(redacted.document, 80, 0)
    const pageTwoChunk = chunks.find((chunk) => chunk.text.includes("durable decision"))

    expect(redacted.counts).toContainEqual({ name: "email", count: 1 })
    expect(pageTwoChunk).toEqual(
      expect.objectContaining({
        pageStart: 2,
        pageEnd: 2,
        locationKind: "page",
        locationStart: 2,
      }),
    )
    expect(pageTwoChunk?.lineStart).toBeUndefined()
    expect(pageTwoChunk?.lineEnd).toBeUndefined()
  })
})
