import { subscribe, unsubscribe } from "node:diagnostics_channel"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { afterEach, describe, expect, it } from "vitest"
import { CONFIG_LOAD_DIAGNOSTICS_CHANNEL, type ConfigLoadDiagnosticsEvent } from "./config.js"
import { DEFAULT_CONFIG } from "./defaults.js"
import { ingest } from "./ingest.js"
import { initProject } from "./init.js"
import {
  connectMcpServer,
  createMcpClientLifecycle,
  createMcpServer,
  resolveMcpProjectRoot,
  searchOptions,
} from "./mcp.js"

const tempDirs: string[] = []
const connections: Array<{ client: Client; server: McpServer }> = []

afterEach(async () => {
  for (const connection of connections.splice(0).reverse()) {
    await Promise.allSettled([connection.client.close(), connection.server.close()])
  }
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

async function createProject(
  prefix: string,
  overrides: Partial<typeof DEFAULT_CONFIG> = {},
): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix))
  tempDirs.push(root)
  await initProject(root)
  await writeFile(
    path.join(root, ".ragmir", "config.json"),
    `${JSON.stringify({ ...DEFAULT_CONFIG, ...overrides }, null, 2)}\n`,
    "utf8",
  )
  return root
}

async function connectTestClient(root: string): Promise<{ client: Client; server: McpServer }> {
  const client = new Client({ name: "ragmir-test", version: "1.0.0" })
  const server = createMcpServer(root)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
  const connection = { client, server }
  connections.push(connection)
  return connection
}

function textContent(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content.find((item) => item.type === "text")
  if (content?.type !== "text") {
    throw new Error("Expected MCP text content.")
  }
  return content.text
}

async function jsonToolResult(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const result = await client.callTool({ name, arguments: args })
  expect(result.isError).not.toBe(true)
  return JSON.parse(textContent(result))
}

describe("resolveMcpProjectRoot", () => {
  it("prefers explicit Ragmir roots, then configured cwd roots, then Claude Code project roots", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-mcp-root-"))
    tempDirs.push(root)
    const nested = path.join(root, "nested")
    await mkdir(path.join(root, ".ragmir"), { recursive: true })
    await mkdir(nested, { recursive: true })
    await writeFile(path.join(root, ".ragmir", "config.json"), "{}\n", "utf8")

    expect(
      resolveMcpProjectRoot(
        {
          RAGMIR_PROJECT_ROOT: "/repo/ragmir",
          CLAUDE_PROJECT_DIR: "/repo/claude",
        },
        "/repo/cwd",
      ),
    ).toBe("/repo/ragmir")
    expect(resolveMcpProjectRoot({ CLAUDE_PROJECT_DIR: "/repo/claude" }, nested)).toBe(root)
    expect(resolveMcpProjectRoot({ CLAUDE_PROJECT_DIR: "/repo/claude" }, "/repo/cwd")).toBe(
      "/repo/claude",
    )
    expect(resolveMcpProjectRoot({}, "/repo/cwd")).toBe("/repo/cwd")
  })

  it("should resolve the nearest nested base before a monorepo root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-mcp-monorepo-"))
    tempDirs.push(root)
    const app = path.join(root, "apps", "web")
    const appSource = path.join(app, "src")
    await mkdir(path.join(root, ".ragmir"), { recursive: true })
    await mkdir(path.join(app, ".ragmir"), { recursive: true })
    await mkdir(appSource, { recursive: true })
    await writeFile(path.join(root, ".ragmir", "config.json"), "{}\n", "utf8")
    await writeFile(path.join(app, ".ragmir", "config.json"), "{}\n", "utf8")

    expect(resolveMcpProjectRoot({}, appSource)).toBe(app)
    expect(resolveMcpProjectRoot({ RAGMIR_PROJECT_ROOT: root }, appSource)).toBe(root)
  })
})

describe("connectMcpServer", () => {
  it("should return a server handle that the embedding process can close", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-mcp-lifecycle-"))
    tempDirs.push(root)
    const [, serverTransport] = InMemoryTransport.createLinkedPair()

    const server = await connectMcpServer(serverTransport, root)

    expect(server.server).toBeDefined()
    await expect(server.close()).resolves.toBeUndefined()
  })
})

describe("MCP protocol contract", () => {
  it("should carry evidence identity from compact search to checked expansion", async () => {
    const root = await createProject("ragmir-mcp-evidence-")
    const raw = path.join(root, ".ragmir", "raw")
    await mkdir(raw, { recursive: true })
    const file = path.join(raw, "retention.md")
    await writeFile(file, "Invoices are retained for 90 days.\n")
    await ingest({ cwd: root })
    const { client } = await connectTestClient(root)
    const result = await jsonToolResult(client, "ragmir_search", {
      query: "invoices retained",
      topK: 1,
    })
    const first: unknown = Array.isArray(result) ? result[0] : undefined
    if (!first || typeof first !== "object" || !("citation" in first) || !("evidence" in first)) {
      throw new Error("Expected a compact search result with evidence identity")
    }
    const evidence = first.evidence
    if (!evidence || typeof evidence !== "object" || !("id" in evidence)) {
      throw new Error("Expected an evidence identifier")
    }
    expect(
      await jsonToolResult(client, "ragmir_expand", {
        citation: first.citation,
        expectedEvidenceId: evidence.id,
      }),
    ).toMatchObject({ found: true })
    await writeFile(file, "Invoices are retained for 30 days.\n")
    await ingest({ cwd: root })
    const stale = await client.callTool({
      name: "ragmir_expand",
      arguments: { citation: first.citation, expectedEvidenceId: evidence.id },
    })
    expect(stale.isError).toBe(true)
    expect(textContent(stale)).toContain("evidence has changed")
  })

  it("should advertise conservative tool effects and bounded resources", async () => {
    const root = await createProject("ragmir-mcp-contract-")
    const { client } = await connectTestClient(root)

    const tools = await client.listTools()
    expect(client.getInstructions()).toContain("at most three compact citations")
    expect(client.getInstructions()).toContain("never as action authority")
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      "ragmir_audit",
      "ragmir_expand",
      "ragmir_search",
      "ragmir_status",
    ])
    const pureTools = new Set([])
    const potentiallyNetworkedTools = new Set(["ragmir_search"])
    for (const tool of tools.tools) {
      const pure = pureTools.has(tool.name)
      expect(tool.annotations).toEqual({
        readOnlyHint: pure,
        destructiveHint: false,
        idempotentHint: pure,
        openWorldHint: potentiallyNetworkedTools.has(tool.name),
      })
    }

    const resources = await client.listResources()
    expect(resources.resources.map((resource) => resource.uri).sort()).toEqual([
      "ragmir://context",
      "ragmir://sources",
    ])
    const context = await client.readResource({ uri: "ragmir://context" })
    const content = context.contents[0]
    expect(content && "text" in content ? JSON.parse(content.text) : null).toMatchObject({
      projectRoot: root,
      tools: expect.arrayContaining(["ragmir_search", "ragmir_expand"]),
    })
  })

  it("should return protocol errors for invalid input and data for valid calls", async () => {
    const root = await createProject("ragmir-mcp-validation-")
    const { client } = await connectTestClient(root)

    const invalid = await client.callTool({
      name: "ragmir_search",
      arguments: { query: "production approval", unexpected: true },
    })
    expect(invalid.isError).toBe(true)

    const valid = await client.callTool({
      name: "ragmir_search",
      arguments: { query: "production approval" },
    })
    expect(valid.isError).not.toBe(true)
    expect(JSON.parse(textContent(valid))).toEqual([])
  })

  it("should return three compact results by default and preserve an explicit full response", async () => {
    const root = await createProject("ragmir-mcp-compact-default-")
    const rawDir = path.join(root, ".ragmir", "raw")
    const sourceDir = path.join(root, "src")
    await mkdir(sourceDir, { recursive: true })
    await Promise.all(
      Array.from({ length: 6 }, async (_value, index) => {
        await Promise.all([
          writeFile(
            path.join(rawDir, `release-${index}.md`),
            Array.from(
              { length: 30 },
              (_entry, line) =>
                `Release approval evidence ${index}.${line} requires a reviewed production decision.`,
            ).join("\n"),
            "utf8",
          ),
          writeFile(
            path.join(sourceDir, `release-${index}.ts`),
            `export const reviewedProductionDecision${index} = "release approval"\n`,
            "utf8",
          ),
        ])
      }),
    )
    await ingest({ cwd: root })
    const { client } = await connectTestClient(root)

    const compact = await client.callTool({
      name: "ragmir_search",
      arguments: { query: "reviewed production release approval decision" },
    })
    const compactPayload = JSON.parse(textContent(compact))
    expect(compactPayload).toHaveLength(3)
    expect(compactPayload[0]).toHaveProperty("snippet")
    expect(compactPayload[0]).not.toHaveProperty("text")
    expect(compact._meta?.["ragmir/output"]).toMatchObject({
      compacted: true,
      truncated: false,
    })

    const full = await client.callTool({
      name: "ragmir_search",
      arguments: {
        query: "reviewed production release approval decision",
        topK: 5,
        maxChunksPerDocument: 2,
        contextRadius: 1,
        explain: true,
        compact: false,
      },
    })
    const fullPayload = JSON.parse(textContent(full))
    expect(fullPayload).toHaveLength(5)
    expect(fullPayload[0]).toHaveProperty("text")
    expect(fullPayload[0]).not.toHaveProperty("snippet")
    expect(fullPayload[0]?.context.length).toBeGreaterThan(0)
    expect(fullPayload[0]?.score).toMatchObject({
      diversityStrategy: "document-cap",
      maxChunksPerDocument: 2,
    })
    expect(full._meta?.["ragmir/output"]).toMatchObject({
      compacted: false,
      truncated: false,
    })
    expect(Buffer.byteLength(textContent(compact), "utf8")).toBeLessThan(
      Buffer.byteLength(textContent(full), "utf8"),
    )
  })

  it("should refresh the reused client when effective configuration changes", async () => {
    const root = await createProject("ragmir-mcp-client-lifecycle-", {})
    const lifecycle = createMcpClientLifecycle(root)

    const first = await lifecycle.getClient()
    const second = await lifecycle.getClient()

    expect(second).toBe(first)
    expect(first.isClosed).toBe(false)
    await writeFile(
      path.join(root, ".ragmir", "config.json"),
      `${JSON.stringify({ ...DEFAULT_CONFIG, topK: 7 }, null, 2)}\n`,
      "utf8",
    )
    const refreshed = await lifecycle.getClient()

    expect(refreshed).not.toBe(first)
    expect(first.isClosed).toBe(true)
    expect(refreshed.isClosed).toBe(false)
    await lifecycle.close()
    await lifecycle.close()
    expect(refreshed.isClosed).toBe(true)
    await expect(lifecycle.getClient()).rejects.toThrow("MCP server is closed")
  })

  it("should load configuration exactly once for each MCP request", async () => {
    const root = await createProject("ragmir-mcp-config-snapshot-")
    const evaluationDir = path.join(root, "evaluation")
    await mkdir(evaluationDir, { recursive: true })
    await writeFile(
      path.join(evaluationDir, "golden.json"),
      JSON.stringify([
        {
          query: "production approval",
          expectedPaths: [".ragmir/raw/missing.md"],
        },
      ]),
      "utf8",
    )
    const { client } = await connectTestClient(root)
    const events: ConfigLoadDiagnosticsEvent[] = []
    const onDiagnostic = (event: unknown): void => {
      if (isConfigLoadDiagnosticsEvent(event, root)) {
        events.push(event)
      }
    }
    subscribe(CONFIG_LOAD_DIAGNOSTICS_CHANNEL, onDiagnostic)
    const requests = [
      () => client.callTool({ name: "ragmir_search", arguments: { query: "approval" } }),
      () => client.callTool({ name: "ragmir_status", arguments: {} }),
      () => client.callTool({ name: "ragmir_audit", arguments: {} }),
      () => client.readResource({ uri: "ragmir://context" }),
      () => client.readResource({ uri: "ragmir://sources" }),
    ]

    try {
      for (const request of requests) {
        events.length = 0
        await request()
        expect(events).toHaveLength(1)
      }
    } finally {
      unsubscribe(CONFIG_LOAD_DIAGNOSTICS_CHANNEL, onDiagnostic)
    }
  })

  it("should run server cleanup when the client transport closes", async () => {
    const root = await createProject("ragmir-mcp-transport-lifecycle-")
    const { client, server } = await connectTestClient(root)
    await client.callTool({ name: "ragmir_search", arguments: { query: "approval" } })
    const previousOnClose = server.server.onclose
    let notifyClosed: (() => void) | undefined
    const transportClosed = new Promise<void>((resolve) => {
      notifyClosed = resolve
    })
    server.server.onclose = () => {
      previousOnClose?.()
      notifyClosed?.()
    }

    await client.close()

    await expect(transportClosed).resolves.toBeUndefined()
    await expect(server.close()).resolves.toBeUndefined()
  })

  it("should execute every advertised tool through the SDK", async () => {
    const root = await createProject("ragmir-mcp-tools-")
    const decisionPath = path.join(root, ".ragmir", "raw", "decision.md")
    await writeFile(
      decisionPath,
      "Production deployment requires human approval before release.\n",
      "utf8",
    )
    await ingest({ cwd: root })
    const evaluationDir = path.join(root, "evaluation")
    await mkdir(evaluationDir, { recursive: true })
    await writeFile(
      path.join(evaluationDir, "golden.json"),
      JSON.stringify([
        {
          query: "production release approval",
          expectedPaths: [".ragmir/raw/decision.md"],
        },
      ]),
      "utf8",
    )
    const { client } = await connectTestClient(root)

    const status = await jsonToolResult(client, "ragmir_status", {})
    expect(status).toMatchObject({ chunksIndexed: 1, ready: true, maxChunksPerDocument: 1 })
    expect(status.corpusFingerprint).toMatch(/^[0-9a-f]{64}$/u)

    const search = await jsonToolResult(client, "ragmir_search", {
      query: "production release approval",
      topK: 1,
    })
    expect(search).toMatchObject([
      {
        relativePath: ".ragmir/raw/decision.md",
        citation: expect.stringContaining("decision.md:L1-"),
      },
    ])
    if (!Array.isArray(search) || typeof search[0]?.citation !== "string") {
      throw new Error("Expected a cited MCP search result.")
    }

    const expanded = await jsonToolResult(client, "ragmir_expand", {
      citation: search[0].citation,
      contextRadius: 1,
    })
    expect(expanded).toMatchObject({ found: true, relativePath: ".ragmir/raw/decision.md" })

    const audit = await jsonToolResult(client, "ragmir_audit", {})
    expect(audit).toMatchObject({ totalChunks: 1, missingFromIndex: [] })
  }, 15_000)

  it("should bound audit and resource payloads", async () => {
    const root = await createProject("ragmir-mcp-budget-", {
      mcpMaxOutputBytes: 1_024,
    })
    const rawDir = path.join(root, ".ragmir", "raw")
    await Promise.all(
      Array.from({ length: 24 }, async (_value, index) => {
        const suffix = `${index}`.padStart(2, "0")
        await writeFile(
          path.join(rawDir, `source-${suffix}-${"evidence-".repeat(10)}.md`),
          `Evidence ${suffix}.\n`,
          "utf8",
        )
      }),
    )
    const evaluationDir = path.join(root, "evaluation")
    await mkdir(evaluationDir, { recursive: true })
    await writeFile(
      path.join(evaluationDir, "golden.json"),
      JSON.stringify(
        Array.from({ length: 16 }, (_value, index) => ({
          id: `case-${index}`,
          query: `production approval evidence ${index} ${"detail ".repeat(20)}`,
          expectedPaths: [`.ragmir/raw/source-${index}.md`],
        })),
      ),
      "utf8",
    )
    const { client } = await connectTestClient(root)

    const audit = await client.callTool({
      name: "ragmir_audit",
      arguments: { maxBytes: 1_024 },
    })
    const auditPayload = JSON.parse(textContent(audit))
    expect(Buffer.byteLength(textContent(audit), "utf8")).toBeLessThanOrEqual(1_024)
    expect(auditPayload).toMatchObject({
      counts: { supportedFiles: 24 },
      previews: { missingFromIndex: [], staleInIndex: [] },
      omitted: { supportedFiles: 24 },
    })
    expect(audit._meta?.["ragmir/output"]).toMatchObject({
      budgetBytes: 1_024,
      truncated: true,
      retrievedBytes: expect.any(Number),
    })

    const sources = await client.readResource({ uri: "ragmir://sources" })
    const sourceContent = sources.contents[0]
    expect(
      sourceContent && "text" in sourceContent ? Buffer.byteLength(sourceContent.text) : 0,
    ).toBeLessThanOrEqual(1_024)
    expect(sourceContent && "text" in sourceContent ? sourceContent.text : "").not.toContain(root)
    expect(sources._meta?.["ragmir/output"]).toMatchObject({
      budgetBytes: 1_024,
      truncated: false,
    })
  })
})

describe("searchOptions", () => {
  it("clamps requested topK to the configured mcpMaxTopK", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-mcp-topk-"))
    tempDirs.push(root)
    await mkdir(path.join(root, ".ragmir"), { recursive: true })
    await writeFile(
      path.join(root, ".ragmir", "config.json"),
      JSON.stringify({ mcpMaxTopK: 5, topK: 8 }),
      "utf8",
    )

    expect((await searchOptions(root, 50)).topK).toBe(5)
    expect((await searchOptions(root, 2)).topK).toBe(2)
    expect((await searchOptions(root, undefined)).topK).toBe(3)
    expect((await searchOptions(root, 2, 20)).contextRadius).toBe(3)
    expect(
      await searchOptions(
        root,
        2,
        1,
        [".ragmir/raw/primary"],
        [".ragmir/raw/research"],
        ["Operations > Release"],
        true,
        2,
      ),
    ).toEqual({
      cwd: root,
      topK: 2,
      maxChunksPerDocument: 2,
      contextRadius: 1,
      includePaths: [".ragmir/raw/primary"],
      excludePaths: [".ragmir/raw/research"],
      contextPaths: ["Operations > Release"],
      explain: true,
    })
  })
})

function isConfigLoadDiagnosticsEvent(
  event: unknown,
  projectRoot: string,
): event is ConfigLoadDiagnosticsEvent {
  return (
    typeof event === "object" &&
    event !== null &&
    "projectRoot" in event &&
    event.projectRoot === projectRoot &&
    "configPath" in event &&
    typeof event.configPath === "string"
  )
}
