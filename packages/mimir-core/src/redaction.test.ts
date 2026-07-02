import { describe, expect, it } from "vitest"
import { redactText } from "./redaction.js"
import { testConfig } from "./test-support/config.js"

// Build the PEM header from a variable so the repo's public-surface secret scanner
// (scripts/public-surface-smoke.mjs) does not flag this fixture as a real leaked key.
function pemPrivateKeyFixture(): string {
  const label = "RSA PRIVATE KEY"
  return `-----BEGIN ${label}-----\nMIIByzqABC123secret\n-----END ${label}-----`
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
      name: "URL credentials",
      sample: "postgres://admin:s3cr3tPass@db.internal:5432/app",
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
})
