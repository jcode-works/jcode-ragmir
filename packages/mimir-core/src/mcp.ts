import path from "node:path"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { accessLogUsageReport } from "./access-log.js"
import { loadConfig } from "./config.js"
import { evaluateGoldenQueries } from "./evaluate.js"
import { audit } from "./ingest.js"
import { ask, search } from "./query.js"
import { compactResearchReport, compactSearchResults, research } from "./research.js"
import { securityAudit } from "./security.js"
import { countRows } from "./store.js"
import { VERSION } from "./version.js"

const queryToolInputSchema = z.object({
  query: z.string().min(1),
  topK: z.number().int().positive().optional(),
})

const searchToolInputSchema = queryToolInputSchema.extend({
  compact: z.boolean().optional(),
})

const researchToolInputSchema = queryToolInputSchema.extend({
  includeCode: z.boolean().optional(),
  compact: z.boolean().optional(),
})

const evaluateToolInputSchema = z.object({
  goldenPath: z.string().min(1),
  topK: z.number().int().positive().optional(),
  failUnder: z.number().min(0).max(1).optional(),
})

const usageReportInputSchema = z.object({
  days: z.number().int().positive().optional(),
})

export async function serveMcp(cwd = resolveMcpProjectRoot()): Promise<void> {
  const server = new McpServer({
    name: "mimir",
    version: VERSION,
  })

  server.registerTool(
    "mimir_status",
    {
      title: "Mimir Status",
      description: "Show active Mimir configuration and indexed chunk count.",
      inputSchema: z.object({}),
    },
    async () => {
      const config = await loadConfig(cwd)
      const chunksIndexed = await countRows(config)
      const output = {
        projectRoot: config.projectRoot,
        rawDir: config.rawDir,
        storageDir: config.storageDir,
        sourcesFile: config.sourcesFile,
        embeddingProvider: config.embeddingProvider,
        embeddingModel: config.embeddingModel,
        embeddingModelPath: config.embeddingModelPath,
        transformersAllowRemoteModels: config.transformersAllowRemoteModels,
        llmGeneration: false,
        redactionEnabled: config.redaction.enabled,
        mcpMaxTopK: config.mcpMaxTopK,
        maxFileBytes: config.maxFileBytes,
        ingestConcurrency: config.ingestConcurrency,
        embeddingBatchSize: config.embeddingBatchSize,
        includeExtensions: config.includeExtensions,
        pdfOcrCommand: config.pdfOcrCommand,
        pdfOcrTimeoutMs: config.pdfOcrTimeoutMs,
        imageOcrCommand: config.imageOcrCommand,
        imageOcrTimeoutMs: config.imageOcrTimeoutMs,
        legacyWordCommand: config.legacyWordCommand,
        legacyWordTimeoutMs: config.legacyWordTimeoutMs,
        chunksIndexed,
      }

      return textResult(output)
    },
  )

  server.registerTool(
    "mimir_search",
    {
      title: "Mimir Search",
      description: "Retrieve relevant passages from the local Mimir knowledge base.",
      inputSchema: searchToolInputSchema,
    },
    async ({ query, topK, compact }) => {
      const results = await search(query, await searchOptions(cwd, topK))
      return textResult(compact ? compactSearchResults(results) : results)
    },
  )

  server.registerTool(
    "mimir_ask",
    {
      title: "Mimir Ask",
      description: "Return cited retrieval context for a question without calling an LLM.",
      inputSchema: queryToolInputSchema,
    },
    async ({ query, topK }) => textResult(await ask(query, await searchOptions(cwd, topK))),
  )

  server.registerTool(
    "mimir_research",
    {
      title: "Mimir Research",
      description:
        "Run an audit-backed multi-query research pass with cited evidence and optional code matches.",
      inputSchema: researchToolInputSchema,
    },
    async ({ query, topK, includeCode, compact }) => {
      const options = await searchOptions(cwd, topK)
      const researchOptions: Parameters<typeof research>[1] = { cwd }
      addOption(researchOptions, "topK", options.topK)
      addOption(researchOptions, "includeCode", includeCode)
      const result = await research(query, researchOptions)
      return textResult(compact ? compactResearchReport(result) : result)
    },
  )

  server.registerTool(
    "mimir_audit",
    {
      title: "Mimir Audit",
      description: "Compare supported source files on disk with the current vector index.",
      inputSchema: z.object({}),
    },
    async () => textResult(await audit(cwd)),
  )

  server.registerTool(
    "mimir_evaluate",
    {
      title: "Mimir Evaluate",
      description: "Measure retrieval recall against a local golden query file.",
      inputSchema: evaluateToolInputSchema,
    },
    async ({ goldenPath, topK, failUnder }) => {
      const result = await evaluateGoldenQueries(await evaluationOptions(cwd, goldenPath, topK))
      if (failUnder === undefined) {
        return textResult(result)
      }
      const minimumRecall = failUnder
      return textResult({
        ...result,
        minimumRecall,
        passed: result.recall >= minimumRecall,
      })
    },
  )

  server.registerTool(
    "mimir_security_audit",
    {
      title: "Mimir Security Audit",
      description: "Show local privacy, provider, redaction, MCP, and gitignore posture.",
      inputSchema: z.object({}),
    },
    async () => textResult(await securityAudit(cwd)),
  )

  server.registerTool(
    "mimir_usage_report",
    {
      title: "Mimir Usage Report",
      description: "Summarize the metadata-only local access log.",
      inputSchema: usageReportInputSchema,
    },
    async ({ days }) => {
      const options: Parameters<typeof accessLogUsageReport>[0] = { cwd }
      if (days !== undefined) {
        options.days = days
      }
      return textResult(await accessLogUsageReport(options))
    },
  )

  await server.connect(new StdioServerTransport())
}

export function resolveMcpProjectRoot(
  env: NodeJS.ProcessEnv = process.env,
  fallback = process.cwd(),
): string {
  return env.MIMIR_PROJECT_ROOT ?? env.CLAUDE_PROJECT_DIR ?? fallback
}

function textResult(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
  }
}

async function searchOptions(
  cwd: string,
  topK: number | undefined,
): Promise<{ cwd: string; topK?: number }> {
  const config = await loadConfig(cwd)
  const boundedTopK = Math.min(topK ?? config.topK, config.mcpMaxTopK)
  return { cwd, topK: boundedTopK }
}

async function evaluationOptions(
  cwd: string,
  goldenPath: string,
  topK: number | undefined,
): Promise<{ cwd: string; goldenPath: string; topK?: number; maxTopK: number }> {
  const config = await loadConfig(cwd)
  const result = {
    cwd,
    goldenPath: projectRelativeGoldenPath(cwd, goldenPath),
    maxTopK: config.mcpMaxTopK,
  }
  if (topK === undefined) {
    return result
  }
  return { ...result, topK: Math.min(topK, config.mcpMaxTopK) }
}

function projectRelativeGoldenPath(cwd: string, goldenPath: string): string {
  const root = path.resolve(cwd)
  const absolutePath = path.resolve(root, goldenPath)
  const relativePath = path.relative(root, absolutePath)
  if (relativePath.length === 0 || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("mimir_evaluate goldenPath must stay inside the MCP project root.")
  }
  return relativePath
}

function addOption<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined,
): void {
  if (value !== undefined) {
    target[key] = value
  }
}
