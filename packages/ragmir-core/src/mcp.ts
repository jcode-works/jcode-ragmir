import { existsSync } from "node:fs"
import path from "node:path"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { accessLogUsageReport } from "./access-log.js"
import { findProjectConfig, loadConfig } from "./config.js"
import { RAGMIR_PROJECT_ROOT_ENV } from "./defaults.js"
import { evaluateGoldenQueries } from "./evaluate.js"
import { audit } from "./ingest.js"
import { ingestionLimits } from "./limits.js"
import { routePrompt } from "./prompt-routing.js"
import { ask, search } from "./query.js"
import { compactResearchReport, compactSearchResults, research } from "./research.js"
import { securityAudit } from "./security.js"
import { countRows } from "./store.js"
import { VERSION } from "./version.js"

const queryToolInputSchema = z.object({
  query: z.string().min(1),
  topK: z.number().int().positive().optional(),
  contextRadius: z.number().int().min(0).optional(),
  includePaths: z.array(z.string().min(1).max(500)).max(20).optional(),
  excludePaths: z.array(z.string().min(1).max(500)).max(20).optional(),
})

const researchToolInputSchema = z.object({
  query: z.string().min(1),
  topK: z.number().int().positive().optional(),
  includeCode: z.boolean().optional(),
  compact: z.boolean().optional(),
  includePaths: z.array(z.string().min(1).max(500)).max(20).optional(),
  excludePaths: z.array(z.string().min(1).max(500)).max(20).optional(),
})

const searchToolInputSchema = queryToolInputSchema.extend({
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

const promptRouteInputSchema = z.object({
  prompt: z.string().min(1),
})

export async function serveMcp(cwd = resolveMcpProjectRoot()): Promise<void> {
  const server = new McpServer({
    name: "ragmir",
    version: VERSION,
  })

  server.registerTool(
    "ragmir_status",
    {
      title: "Ragmir Status",
      description: "Show active Ragmir configuration and indexed chunk count.",
      inputSchema: z.object({}),
    },
    async () => {
      const config = await loadConfig(cwd)
      const chunksIndexed = await countRows(config)
      const strict = config.privacyProfile === "strict"
      const output = {
        projectRoot: strict ? "." : config.projectRoot,
        rawDir: strict ? path.relative(config.projectRoot, config.rawDir) : config.rawDir,
        storageDir: strict
          ? path.relative(config.projectRoot, config.storageDir)
          : config.storageDir,
        sourcesFile: strict
          ? path.relative(config.projectRoot, config.sourcesFile)
          : config.sourcesFile,
        privacyProfile: config.privacyProfile,
        retrievalProfile: config.retrievalProfile,
        embeddingProvider: config.embeddingProvider,
        embeddingModel: config.embeddingModel,
        embeddingModelRevision: config.embeddingModelRevision,
        embeddingModelPath: strict
          ? path.relative(config.projectRoot, config.embeddingModelPath)
          : config.embeddingModelPath,
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
        ingestionLimits: ingestionLimits(config),
        chunksIndexed,
      }

      return textResult(output)
    },
  )

  server.registerTool(
    "ragmir_route_prompt",
    {
      title: "Ragmir Prompt Router",
      description:
        "Classify a prompt and suggest whether an agent should use Ragmir local context.",
      inputSchema: promptRouteInputSchema,
    },
    async ({ prompt }) => textResult(routePrompt(prompt)),
  )

  server.registerTool(
    "ragmir_search",
    {
      title: "Ragmir Search",
      description: "Retrieve relevant passages from the local Ragmir knowledge base.",
      inputSchema: searchToolInputSchema,
    },
    async ({ query, topK, contextRadius, compact, includePaths, excludePaths }) => {
      const config = await loadConfig(cwd)
      const results = await search(
        query,
        await searchOptions(cwd, topK, contextRadius, includePaths, excludePaths),
      )
      const compactOutput = compact ?? config.privacyProfile === "strict"
      return textResult(compactOutput ? compactSearchResults(results) : results)
    },
  )

  server.registerTool(
    "ragmir_ask",
    {
      title: "Ragmir Ask",
      description: "Return cited retrieval context for a question without calling an LLM.",
      inputSchema: queryToolInputSchema,
    },
    async ({ query, topK, contextRadius, includePaths, excludePaths }) => {
      const config = await loadConfig(cwd)
      const options = await searchOptions(cwd, topK, contextRadius, includePaths, excludePaths)
      if (config.privacyProfile === "strict") {
        const results = await search(query, options)
        return textResult({
          answer: "Strict privacy profile returns compact cited retrieval only.",
          sources: compactSearchResults(results),
        })
      }
      return textResult(await ask(query, options))
    },
  )

  server.registerTool(
    "ragmir_research",
    {
      title: "Ragmir Research",
      description:
        "Run an audit-backed multi-query research pass with cited evidence and optional code matches.",
      inputSchema: researchToolInputSchema,
    },
    async ({ query, topK, includeCode, compact, includePaths, excludePaths }) => {
      const config = await loadConfig(cwd)
      const options = await searchOptions(cwd, topK, undefined, includePaths, excludePaths)
      const researchOptions: Parameters<typeof research>[1] = { cwd }
      addOption(researchOptions, "topK", options.topK)
      addOption(researchOptions, "includeCode", includeCode)
      addOption(researchOptions, "includePaths", options.includePaths)
      addOption(researchOptions, "excludePaths", options.excludePaths)
      const result = await research(query, researchOptions)
      const compactOutput = compact ?? config.privacyProfile === "strict"
      return textResult(compactOutput ? compactResearchReport(result) : result)
    },
  )

  server.registerTool(
    "ragmir_audit",
    {
      title: "Ragmir Audit",
      description: "Compare supported source files on disk with the current vector index.",
      inputSchema: z.object({}),
    },
    async () => textResult(await audit(cwd)),
  )

  server.registerTool(
    "ragmir_evaluate",
    {
      title: "Ragmir Evaluate",
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
    "ragmir_security_audit",
    {
      title: "Ragmir Security Audit",
      description: "Show local privacy, provider, redaction, MCP, and gitignore posture.",
      inputSchema: z.object({}),
    },
    async () => {
      const config = await loadConfig(cwd)
      const report = await securityAudit(cwd)
      if (config.privacyProfile !== "strict") {
        return textResult(report)
      }
      return textResult({
        ...report,
        projectRoot: ".",
        providers: {
          ...report.providers,
          embeddingModelPath: path.relative(
            config.projectRoot,
            report.providers.embeddingModelPath,
          ),
        },
        accessLog: {
          ...report.accessLog,
          path: path.relative(config.projectRoot, report.accessLog.path),
        },
        storage: {
          ...report.storage,
          path: path.relative(config.projectRoot, report.storage.path),
        },
      })
    },
  )

  server.registerTool(
    "ragmir_usage_report",
    {
      title: "Ragmir Usage Report",
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
  const explicitRoot = env[RAGMIR_PROJECT_ROOT_ENV]
  if (explicitRoot) {
    return explicitRoot
  }

  const fallbackConfig = findProjectConfig(fallback)
  if (existsSync(fallbackConfig.configPath)) {
    return fallbackConfig.projectRoot
  }

  return env.CLAUDE_PROJECT_DIR ?? fallback
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

export async function searchOptions(
  cwd: string,
  topK: number | undefined,
  contextRadius?: number | undefined,
  includePaths?: string[] | undefined,
  excludePaths?: string[] | undefined,
): Promise<{
  cwd: string
  topK?: number
  contextRadius?: number
  includePaths?: string[]
  excludePaths?: string[]
}> {
  const config = await loadConfig(cwd)
  const boundedTopK = Math.min(topK ?? config.topK, config.mcpMaxTopK)
  const boundedContextRadius =
    contextRadius === undefined ? undefined : Math.min(Math.max(0, contextRadius), 3)
  const result: {
    cwd: string
    topK?: number
    contextRadius?: number
    includePaths?: string[]
    excludePaths?: string[]
  } = {
    cwd,
    topK: boundedTopK,
  }
  addOption(result, "contextRadius", boundedContextRadius)
  addOption(result, "includePaths", includePaths)
  addOption(result, "excludePaths", excludePaths)
  return result
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

export function projectRelativeGoldenPath(cwd: string, goldenPath: string): string {
  const root = path.resolve(cwd)
  const absolutePath = path.resolve(root, goldenPath)
  const relativePath = path.relative(root, absolutePath)
  if (relativePath.length === 0 || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("ragmir_evaluate goldenPath must stay inside the MCP project root.")
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
