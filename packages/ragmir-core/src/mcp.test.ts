import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { afterEach, describe, expect, it } from "vitest"
import { DEFAULT_CONFIG } from "./defaults.js"
import { ingest } from "./ingest.js"
import { initProject } from "./init.js"
import {
  connectMcpServer,
  createMcpClientLifecycle,
  createMcpServer,
  projectRelativeGoldenPath,
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
  it("should advertise conservative tool effects and bounded resources", async () => {
    const root = await createProject("ragmir-mcp-contract-")
    const { client } = await connectTestClient(root)

    const tools = await client.listTools()
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      "ragmir_ask",
      "ragmir_audit",
      "ragmir_evaluate",
      "ragmir_expand",
      "ragmir_research",
      "ragmir_route_prompt",
      "ragmir_search",
      "ragmir_security_audit",
      "ragmir_status",
      "ragmir_usage_report",
    ])
    const pureTools = new Set([
      "ragmir_route_prompt",
      "ragmir_security_audit",
      "ragmir_usage_report",
    ])
    const potentiallyNetworkedTools = new Set([
      "ragmir_ask",
      "ragmir_evaluate",
      "ragmir_research",
      "ragmir_search",
    ])
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
      tools: expect.arrayContaining(["ragmir_search", "ragmir_evaluate"]),
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

  it("should refresh the reused client when effective configuration changes", async () => {
    const root = await createProject("ragmir-mcp-client-lifecycle-", {
      privacyProfile: "trusted",
    })
    const lifecycle = createMcpClientLifecycle(root)

    const first = await lifecycle.getClient()
    const second = await lifecycle.getClient()

    expect(second).toBe(first)
    expect(first.isClosed).toBe(false)
    await writeFile(
      path.join(root, ".ragmir", "config.json"),
      `${JSON.stringify({ ...DEFAULT_CONFIG, privacyProfile: "strict" }, null, 2)}\n`,
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
    expect(status).toMatchObject({ chunksIndexed: 1 })

    const route = await jsonToolResult(client, "ragmir_route_prompt", {
      prompt: "Use Ragmir to find cited evidence in this local repository about release policy.",
    })
    expect(route).toMatchObject({ shouldUseRagmir: true })

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

    const ask = await jsonToolResult(client, "ragmir_ask", {
      query: "What does production deployment require?",
      topK: 1,
    })
    expect(ask).toMatchObject({ sources: [{ relativePath: ".ragmir/raw/decision.md" }] })

    const research = await jsonToolResult(client, "ragmir_research", {
      query: "production release approval",
      topK: 1,
      includeCode: false,
    })
    expect(research).toMatchObject({ ready: true, evidence: expect.any(Array) })

    const expanded = await jsonToolResult(client, "ragmir_expand", {
      citation: search[0].citation,
      contextRadius: 1,
    })
    expect(expanded).toMatchObject({ found: true, relativePath: ".ragmir/raw/decision.md" })

    const audit = await jsonToolResult(client, "ragmir_audit", {})
    expect(audit).toMatchObject({ totalChunks: 1, missingFromIndex: [] })

    const evaluation = await jsonToolResult(client, "ragmir_evaluate", {
      goldenPath: "evaluation/golden.json",
      failUnder: 1,
    })
    expect(evaluation).toMatchObject({ recall: 1, passed: true })

    const security = await jsonToolResult(client, "ragmir_security_audit", {})
    expect(security).toMatchObject({ zeroTelemetry: true })

    const usage = await jsonToolResult(client, "ragmir_usage_report", { days: 1 })
    expect(usage).toMatchObject({ totalEvents: expect.any(Number) })
  })

  it("should bound audit, evaluation, and resource payloads", async () => {
    const root = await createProject("ragmir-mcp-budget-", {
      privacyProfile: "strict",
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

    const route = await client.callTool({
      name: "ragmir_route_prompt",
      arguments: {
        prompt: `Use Ragmir to research this private architecture. ${"context ".repeat(2_000)}`,
      },
    })
    expect(Buffer.byteLength(textContent(route), "utf8")).toBeLessThanOrEqual(1_024)
    expect(route._meta?.["ragmir/output"]).toMatchObject({
      budgetBytes: 1_024,
      truncated: true,
    })

    const audit = await client.callTool({
      name: "ragmir_audit",
      arguments: { maxBytes: 1_024 },
    })
    expect(Buffer.byteLength(textContent(audit), "utf8")).toBeLessThanOrEqual(1_024)
    expect(audit._meta?.["ragmir/output"]).toMatchObject({
      budgetBytes: 1_024,
      truncated: true,
    })

    const evaluation = await client.callTool({
      name: "ragmir_evaluate",
      arguments: { goldenPath: "evaluation/golden.json", maxBytes: 1_024 },
    })
    const evaluationPayload = JSON.parse(textContent(evaluation))
    expect(Buffer.byteLength(textContent(evaluation), "utf8")).toBeLessThanOrEqual(1_024)
    expect(evaluationPayload.goldenPath).toBe(path.join("evaluation", "golden.json"))
    expect(JSON.stringify(evaluationPayload)).not.toContain(root)
    expect(evaluation._meta?.["ragmir/output"]).toMatchObject({
      budgetBytes: 1_024,
      truncated: true,
    })

    const sources = await client.readResource({ uri: "ragmir://sources" })
    const sourceContent = sources.contents[0]
    expect(
      sourceContent && "text" in sourceContent ? Buffer.byteLength(sourceContent.text) : 0,
    ).toBeLessThanOrEqual(1_024)
    expect(sourceContent && "text" in sourceContent ? sourceContent.text : "").not.toContain(root)
    expect(sources._meta?.["ragmir/output"]).toMatchObject({
      budgetBytes: 1_024,
      truncated: true,
    })
  })

  it("should bound security and usage reports with the configured MCP budget", async () => {
    const customPatterns = Array.from({ length: 100 }, (_value, index) => ({
      name: `custom-pattern-${index}-${"description-".repeat(10)}`,
      pattern: `SECRET_${index}`,
    }))
    const root = await createProject("ragmir-mcp-report-budget-", {
      privacyProfile: "strict",
      mcpMaxOutputBytes: 1_024,
      redaction: {
        enabled: true,
        builtIn: false,
        patterns: customPatterns,
      },
    })
    const { client } = await connectTestClient(root)

    const security = await client.callTool({
      name: "ragmir_security_audit",
      arguments: {},
    })
    expect(Buffer.byteLength(textContent(security), "utf8")).toBeLessThanOrEqual(1_024)
    expect(security._meta?.["ragmir/output"]).toMatchObject({
      budgetBytes: 1_024,
      truncated: true,
    })

    const usage = await client.callTool({
      name: "ragmir_usage_report",
      arguments: { days: 1 },
    })
    expect(Buffer.byteLength(textContent(usage), "utf8")).toBeLessThanOrEqual(1_024)
    expect(usage._meta?.["ragmir/output"]).toMatchObject({ budgetBytes: 1_024 })
  })

  it("should reject escaped and symlinked golden files without strict path leaks", async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "ragmir-mcp-outside-"))
    tempDirs.push(outside)
    const root = await createProject("ragmir-mcp-strict-path-", {
      privacyProfile: "strict",
      embeddingModel: "/private/models/embedding",
      embeddingModelPath: path.join(outside, "models"),
      rawDir: path.join(outside, "raw"),
      storageDir: path.join(outside, "storage"),
      sourcesFile: path.join(outside, "sources.txt"),
      accessLogPath: path.join(outside, "access.log"),
      pdfOcrCommand: ["/private/bin/ocr", "--credential=private"],
    })
    await mkdir(path.join(outside, "raw"), { recursive: true })
    const outsideFile = path.join(outside, "private-golden.json")
    await writeFile(
      outsideFile,
      JSON.stringify([{ query: "private", expectedPaths: ["private.md"] }]),
      "utf8",
    )
    const evaluationDir = path.join(root, "evaluation")
    await mkdir(evaluationDir, { recursive: true })
    await symlink(outsideFile, path.join(evaluationDir, "linked.json"))
    const { client } = await connectTestClient(root)

    const status = JSON.parse(
      textContent(await client.callTool({ name: "ragmir_status", arguments: {} })),
    )
    expect(status.embeddingModel).toBe("<absolute-path>")
    expect(status.embeddingModelPath).toBe("<outside-project>")
    expect(status.rawDir).toBe("<outside-project>")
    expect(status.storageDir).toBe("<outside-project>")
    expect(status.sourcesFile).toBe("<outside-project>")
    expect(status.pdfOcrCommand).toEqual([])
    expect(JSON.stringify(status)).not.toContain(outside)

    const security = JSON.parse(
      textContent(await client.callTool({ name: "ragmir_security_audit", arguments: {} })),
    )
    expect(security.providers.embeddingModelPath).toBe("<outside-project>")
    expect(security.accessLog.path).toBe("<outside-project>")
    expect(security.storage.path).toBe("<outside-project>")
    expect(JSON.stringify(security)).not.toContain(outside)

    for (const goldenPath of ["../private-golden.json", "evaluation/linked.json", outsideFile]) {
      const result = await client.callTool({
        name: "ragmir_evaluate",
        arguments: { goldenPath },
      })
      const message = textContent(result)
      expect(result.isError).toBe(true)
      expect(message).toContain("project-relative golden file")
      expect(message).not.toContain(root)
      expect(message).not.toContain(outside)
      expect(message).not.toContain(outsideFile)
    }
  })

  it("should replace path-bearing context diagnostics when privacy is strict", async () => {
    const root = await createProject("ragmir-mcp-strict-context-", {
      privacyProfile: "strict",
      embeddingModel: "/private/models/original",
    })
    await writeFile(
      path.join(root, ".ragmir", "raw", "decision.md"),
      "Production release requires approval.\n",
      "utf8",
    )
    await ingest({ cwd: root })
    await writeFile(
      path.join(root, ".ragmir", "config.json"),
      `${JSON.stringify(
        {
          ...DEFAULT_CONFIG,
          privacyProfile: "strict",
          embeddingModel: "/private/models/current",
        },
        null,
        2,
      )}\n`,
      "utf8",
    )
    const { client } = await connectTestClient(root)

    const resource = await client.readResource({ uri: "ragmir://context" })
    const content = resource.contents[0]
    const text = content && "text" in content ? content.text : ""
    const context: unknown = JSON.parse(text)

    expect(context).toMatchObject({
      projectRoot: ".",
      indexFreshness: {
        warning:
          "Index freshness requires attention. Run `rgr doctor` locally for detailed diagnostics.",
      },
      nextSteps: ["Run `rgr doctor` locally for detailed next steps."],
    })
    expect(text).not.toContain("/private/models")
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
    expect((await searchOptions(root, undefined)).topK).toBe(5)
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
      ),
    ).toEqual({
      cwd: root,
      topK: 2,
      contextRadius: 1,
      includePaths: [".ragmir/raw/primary"],
      excludePaths: [".ragmir/raw/research"],
      contextPaths: ["Operations > Release"],
      explain: true,
    })
  })
})

describe("projectRelativeGoldenPath", () => {
  it("should keep real project files and reject traversal and absolute paths", async () => {
    const root = await createProject("ragmir-mcp-golden-path-")
    const evaluationDir = path.join(root, "eval")
    await mkdir(evaluationDir, { recursive: true })
    const goldenPath = path.join(evaluationDir, "golden.json")
    await writeFile(goldenPath, "[]\n", "utf8")

    expect(projectRelativeGoldenPath(root, "eval/golden.json")).toBe(
      path.join("eval", "golden.json"),
    )
    expect(() => projectRelativeGoldenPath(root, "../secrets.json")).toThrow(
      "must stay inside the MCP project root",
    )
    expect(() => projectRelativeGoldenPath(root, goldenPath)).toThrow(
      "must stay inside the MCP project root",
    )
  })
})
