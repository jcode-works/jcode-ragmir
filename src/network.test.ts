import { describe, expect, it } from "vitest"
import { assertNetworkPolicy, classifyHost } from "./network.js"
import type { Config } from "./types.js"

describe("network policy", () => {
  it("classifies loopback and private hosts", () => {
    expect(classifyHost("http://localhost:11434").kind).toBe("loopback")
    expect(classifyHost("http://127.0.0.1:11434").kind).toBe("loopback")
    expect(classifyHost("http://192.168.1.10:11434").kind).toBe("private")
    expect(classifyHost("https://example.com").kind).toBe("remote")
  })

  it("blocks remote Ollama hosts by default", () => {
    expect(() => assertNetworkPolicy(testConfig({ ollamaHost: "https://example.com" }))).toThrow(
      /Refusing to send document text/,
    )
  })

  it("allows private hosts only when explicitly configured", () => {
    expect(() =>
      assertNetworkPolicy(
        testConfig({ ollamaHost: "http://192.168.1.10:11434", networkPolicy: "allow-private" }),
      ),
    ).not.toThrow()
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
