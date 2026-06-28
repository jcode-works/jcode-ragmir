import { describe, expect, it } from "vitest"
import { redactText } from "./redaction.js"
import { testConfig } from "./test-support/config.js"

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
})
