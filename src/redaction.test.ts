import { describe, expect, it } from "vitest"
import { redactText } from "./redaction.js"
import type { Config } from "./types.js"

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

function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    projectRoot: "/tmp/project",
    rawDir: "/tmp/project/private",
    storageDir: "/tmp/project/.kb/storage",
    sourcesFile: "/tmp/project/.kb/sources.txt",
    accessLogPath: "/tmp/project/.kb/access.log",
    tableName: "chunks",
    ollamaHost: "http://localhost:11434",
    networkPolicy: "local-only",
    embedModel: "nomic-embed-text",
    llmModel: "gemma4:latest",
    redaction: { enabled: true, builtIn: true, patterns: [] },
    accessLog: true,
    mcpMaxTopK: 10,
    topK: 5,
    chunkSize: 1200,
    chunkOverlap: 150,
    ...overrides,
  }
}
