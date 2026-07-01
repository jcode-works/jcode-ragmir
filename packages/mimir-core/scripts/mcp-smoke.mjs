import { execFileSync } from "node:child_process"
import { cp, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const cliPath = path.join(packageRoot, "dist", "cli.js")
const demoSourceRoot = path.join(packageRoot, "examples", "sovereign-rag-demo")
const tempRoot = await mkdtemp(path.join(tmpdir(), "mimir-mcp-smoke-"))
const demoRoot = path.join(tempRoot, "sovereign-rag-demo")
const requiredTools = [
  "mimir_status",
  "mimir_search",
  "mimir_ask",
  "mimir_research",
  "mimir_audit",
  "mimir_evaluate",
  "mimir_usage_report",
  "mimir_security_audit",
]

const client = new Client({ name: "mimir-mcp-smoke", version: "0.0.0" })
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [cliPath, "--project-root", demoRoot, "serve-mcp"],
  stderr: "pipe",
})

let serverStderr = ""
transport.stderr?.on("data", (chunk) => {
  serverStderr += chunk.toString()
})

try {
  await cp(demoSourceRoot, demoRoot, { recursive: true })
  await rm(path.join(demoRoot, ".mimir", "access.log"), { force: true })
  await rm(path.join(demoRoot, ".mimir", "storage"), { recursive: true, force: true })
  const ingestReport = runCliJson(["--project-root", demoRoot, "ingest", "--json"])
  if (ingestReport.errors.length > 0) {
    throw new Error(`Demo ingest failed with ${ingestReport.errors.length} error(s).`)
  }
  if (ingestReport.chunks < 1) {
    throw new Error("Demo ingest did not index any chunks.")
  }

  await client.connect(transport)

  const toolsResult = await client.listTools(undefined, { timeout: 5_000 })
  const toolNames = toolsResult.tools.map((tool) => tool.name)
  for (const toolName of requiredTools) {
    if (!toolNames.includes(toolName)) {
      throw new Error(`Missing MCP tool: ${toolName}`)
    }
  }

  const status = await callJsonTool(client, "mimir_status", {})
  if (status.chunksIndexed < 1) {
    throw new Error("MCP status reported an empty index.")
  }

  const searchResults = await callJsonTool(client, "mimir_search", {
    query: "offline retrieval approval",
    topK: 2,
    compact: true,
  })
  if (!Array.isArray(searchResults) || searchResults.length < 1) {
    throw new Error("MCP search returned no results.")
  }
  if (!("snippet" in searchResults[0]) || "text" in searchResults[0]) {
    throw new Error("MCP compact search did not return snippet-only results.")
  }

  const answer = await callJsonTool(client, "mimir_ask", {
    query: "What evidence supports offline operation?",
    topK: 2,
  })
  if (!Array.isArray(answer.sources) || answer.sources.length < 1) {
    throw new Error("MCP ask returned no cited sources.")
  }

  const research = await callJsonTool(client, "mimir_research", {
    query: "offline retrieval approval",
    topK: 2,
    compact: true,
  })
  if (!Array.isArray(research.evidence) || research.evidence.length < 1) {
    throw new Error("MCP research returned no cited evidence.")
  }
  if (!("snippet" in research.evidence[0]) || "text" in research.evidence[0]) {
    throw new Error("MCP compact research did not return snippet-only evidence.")
  }

  const evaluation = await callJsonTool(client, "mimir_evaluate", {
    goldenPath: "golden-queries.json",
    failUnder: 1,
  })
  if (evaluation.total !== 4 || evaluation.recall !== 1 || evaluation.passed !== true) {
    throw new Error(`MCP evaluate returned an unexpected report: ${JSON.stringify(evaluation)}`)
  }

  const usage = await callJsonTool(client, "mimir_usage_report", { days: 7 })
  if (usage.totalEvents < 1 || typeof usage.eventsByAction !== "object") {
    throw new Error(`MCP usage report returned an unexpected report: ${JSON.stringify(usage)}`)
  }
  if (JSON.stringify(usage).includes(demoRoot)) {
    throw new Error("MCP usage report should not expose local project paths.")
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        projectRoot: demoRoot,
        tools: requiredTools,
        chunksIndexed: status.chunksIndexed,
        searchResults: searchResults.length,
        askSources: answer.sources.length,
        researchEvidence: research.evidence.length,
        evaluationRecall: evaluation.recall,
        usageEvents: usage.totalEvents,
      },
      null,
      2,
    ),
  )
} catch (error) {
  if (serverStderr.length > 0) {
    console.error(serverStderr)
  }
  throw error
} finally {
  await client.close()
  await rm(tempRoot, { recursive: true, force: true })
}

function runCliJson(args) {
  const output = execFileSync(process.execPath, [cliPath, ...args], {
    cwd: packageRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  return JSON.parse(output)
}

async function callJsonTool(client, name, args) {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 10_000 })
  if (result.isError) {
    throw new Error(`${name} returned an MCP error.`)
  }

  const textItem = result.content.find((item) => item.type === "text")
  if (!textItem) {
    throw new Error(`${name} returned no text content.`)
  }

  return JSON.parse(textItem.text)
}
