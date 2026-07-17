import { existsSync, realpathSync } from "node:fs"
import path from "node:path"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import { z } from "zod"
import { accessLogUsageReport, MAX_USAGE_REPORT_DAYS, recordMcpOutput } from "./access-log.js"
import { createRagmirClient, type RagmirClient } from "./client.js"
import { findProjectConfig, loadConfig } from "./config.js"
import { RAGMIR_PROJECT_ROOT_ENV } from "./defaults.js"
import { evaluateGoldenQueries } from "./evaluate.js"
import { audit } from "./ingest.js"
import { knowledgeBaseIdentity } from "./knowledge-bases.js"
import { ingestionLimits } from "./limits.js"
import type {
  BoundedJsonMetadata,
  BudgetedMcpResult,
  McpAskPayload,
  McpResearchPayload,
  McpSearchPayload,
} from "./mcp-output.js"
import {
  budgetMcpJson,
  fitAskPayload,
  fitExpandedCitation,
  fitMcpJsonOutput,
  fitResearchPayload,
  fitSearchPayload,
  MIN_MCP_OUTPUT_BYTES,
  resolveMcpOutputBudget,
} from "./mcp-output.js"
import { routePrompt } from "./prompt-routing.js"
import { compactResearchReport, compactSearchResults } from "./research.js"
import { securityAudit } from "./security.js"
import type { AskResult, Config } from "./types.js"
import { VERSION } from "./version.js"

const MAX_MCP_INPUT_CHARACTERS = 20_000
const MAX_MCP_PATH_CHARACTERS = 500
const MAX_MCP_OUTPUT_BYTES = 1_048_576
const STRICT_MCP_FRESHNESS_WARNING =
  "Index freshness requires attention. Run `rgr doctor` locally for detailed diagnostics."
const STRICT_MCP_NEXT_STEP = "Run `rgr doctor` locally for detailed next steps."
const LOCAL_NON_DESTRUCTIVE_TOOL_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
}
const PURE_LOCAL_TOOL_ANNOTATIONS = {
  ...LOCAL_NON_DESTRUCTIVE_TOOL_ANNOTATIONS,
  readOnlyHint: true,
  idempotentHint: true,
}
const POTENTIALLY_NETWORKED_TOOL_ANNOTATIONS = {
  ...LOCAL_NON_DESTRUCTIVE_TOOL_ANNOTATIONS,
  openWorldHint: true,
}

const queryToolInputSchema = z
  .object({
    query: z.string().trim().min(1).max(MAX_MCP_INPUT_CHARACTERS),
    topK: z.number().int().positive().optional(),
    contextRadius: z.number().int().min(0).optional(),
    maxBytes: z.number().int().min(MIN_MCP_OUTPUT_BYTES).max(MAX_MCP_OUTPUT_BYTES).optional(),
    includePaths: z.array(z.string().min(1).max(MAX_MCP_PATH_CHARACTERS)).max(20).optional(),
    excludePaths: z.array(z.string().min(1).max(MAX_MCP_PATH_CHARACTERS)).max(20).optional(),
    contextPaths: z.array(z.string().min(1).max(MAX_MCP_PATH_CHARACTERS)).max(20).optional(),
    explain: z.boolean().optional(),
  })
  .strict()

const askToolInputSchema = queryToolInputSchema.extend({
  compact: z.boolean().optional(),
})

const researchToolInputSchema = z
  .object({
    query: z.string().trim().min(1).max(MAX_MCP_INPUT_CHARACTERS),
    topK: z.number().int().positive().optional(),
    includeCode: z.boolean().optional(),
    compact: z.boolean().optional(),
    maxBytes: z.number().int().min(MIN_MCP_OUTPUT_BYTES).max(MAX_MCP_OUTPUT_BYTES).optional(),
    includePaths: z.array(z.string().min(1).max(MAX_MCP_PATH_CHARACTERS)).max(20).optional(),
    excludePaths: z.array(z.string().min(1).max(MAX_MCP_PATH_CHARACTERS)).max(20).optional(),
    contextPaths: z.array(z.string().min(1).max(MAX_MCP_PATH_CHARACTERS)).max(20).optional(),
  })
  .strict()

const searchToolInputSchema = queryToolInputSchema.extend({
  compact: z.boolean().optional(),
})

const evaluateToolInputSchema = z
  .object({
    goldenPath: z.string().min(1).max(MAX_MCP_PATH_CHARACTERS),
    topK: z.number().int().positive().optional(),
    failUnder: z.number().min(0).max(1).optional(),
    maxBytes: z.number().int().min(MIN_MCP_OUTPUT_BYTES).max(MAX_MCP_OUTPUT_BYTES).optional(),
  })
  .strict()

const auditToolInputSchema = z
  .object({
    maxBytes: z.number().int().min(MIN_MCP_OUTPUT_BYTES).max(MAX_MCP_OUTPUT_BYTES).optional(),
  })
  .strict()

const usageReportInputSchema = z
  .object({
    days: z.number().int().positive().max(MAX_USAGE_REPORT_DAYS).optional(),
  })
  .strict()

const promptRouteInputSchema = z
  .object({
    prompt: z.string().trim().min(1).max(MAX_MCP_INPUT_CHARACTERS),
  })
  .strict()

const expandToolInputSchema = z
  .object({
    citation: z.string().min(1).max(2_000),
    contextRadius: z.number().int().min(0).max(3).optional(),
    maxBytes: z.number().int().min(MIN_MCP_OUTPUT_BYTES).max(MAX_MCP_OUTPUT_BYTES).optional(),
  })
  .strict()

interface McpClientLifecycle {
  getClient(config?: Config): Promise<RagmirClient>
  close(): Promise<void>
}

class LifecycleMcpServer extends McpServer {
  constructor(private readonly closeClient: () => Promise<void>) {
    super({
      name: "ragmir",
      version: VERSION,
    })
  }

  override async close(): Promise<void> {
    try {
      await super.close()
    } finally {
      await this.closeClient()
    }
  }
}

export function createMcpClientLifecycle(cwd: string): McpClientLifecycle {
  let clientPromise: Promise<RagmirClient> | undefined
  let clientConfigSignature: string | undefined
  let closePromise: Promise<void> | undefined
  let closing = false

  return {
    getClient(config) {
      return (async () => {
        const effectiveConfig = config ?? (await loadConfig(cwd))
        if (closing) {
          throw new Error("The MCP server is closed.")
        }

        const signature = JSON.stringify(effectiveConfig)
        if (clientPromise && clientConfigSignature === signature) {
          return clientPromise
        }

        const previous = clientPromise
        const pending = (async () => {
          if (previous) {
            let previousClient: RagmirClient | undefined
            try {
              previousClient = await previous
            } catch {
              // A failed lazy initialization has no open client to close.
            }
            await previousClient?.close()
          }
          if (closing) {
            throw new Error("The MCP server is closed.")
          }
          return createRagmirClient({ cwd })
        })()
        clientPromise = pending
        clientConfigSignature = signature
        void pending.catch(() => {
          if (clientPromise === pending) {
            clientPromise = undefined
            clientConfigSignature = undefined
          }
        })
        return pending
      })()
    },
    close() {
      closing = true
      if (!closePromise) {
        closePromise = (async () => {
          const pending = clientPromise
          if (!pending) {
            return
          }
          let client: RagmirClient
          try {
            client = await pending
          } catch {
            // A failed lazy initialization has no open client to close.
            return
          }
          await client.close()
        })()
      }
      return closePromise
    },
  }
}

export function createMcpServer(cwd = resolveMcpProjectRoot()): McpServer {
  const clientLifecycle = createMcpClientLifecycle(cwd)
  const server = new LifecycleMcpServer(() => clientLifecycle.close())
  server.server.onclose = () => {
    void clientLifecycle.close().catch(() => undefined)
  }

  server.registerResource(
    "ragmir-context",
    "ragmir://context",
    {
      title: "Ragmir Knowledge Base Context",
      description:
        "Active base identity, readiness, freshness, coverage, and available operations.",
      mimeType: "application/json",
    },
    async (uri, { signal }) => {
      throwIfMcpAborted(signal)
      const config = await loadConfig(cwd)
      const client = await clientLifecycle.getClient(config)
      const context = await abortableMcpOperation(client.status({ signal }), signal)
      const output =
        config.privacyProfile !== "strict"
          ? context
          : {
              ...context,
              indexFreshness: {
                ...context.indexFreshness,
                warning:
                  context.indexFreshness.warning === null ? null : STRICT_MCP_FRESHNESS_WARNING,
              },
              nextSteps: context.nextSteps.length === 0 ? [] : [STRICT_MCP_NEXT_STEP],
            }
      return jsonResource(
        uri,
        output,
        mcpOutputBudget(config.mcpMaxOutputBytes),
        "ragmir://context",
      )
    },
  )

  server.registerResource(
    "ragmir-sources",
    "ragmir://sources",
    {
      title: "Ragmir Source Catalog",
      description:
        "Bounded source coverage, skipped-file counts, and index drift for the active base.",
      mimeType: "application/json",
    },
    async (uri, { signal }) => {
      throwIfMcpAborted(signal)
      const config = await loadConfig(cwd)
      const client = await clientLifecycle.getClient(config)
      const sources = await abortableMcpOperation(client.sources({ signal }), signal)
      return jsonResource(
        uri,
        sources,
        mcpOutputBudget(config.mcpMaxOutputBytes),
        "ragmir://sources",
      )
    },
  )

  server.registerTool(
    "ragmir_status",
    {
      title: "Ragmir Status",
      description: "Show active Ragmir configuration and indexed chunk count.",
      inputSchema: z.object({}).strict(),
      annotations: LOCAL_NON_DESTRUCTIVE_TOOL_ANNOTATIONS,
    },
    async (_input, { signal }) => {
      throwIfMcpAborted(signal)
      const config = await loadConfig(cwd)
      const client = await clientLifecycle.getClient(config)
      const context = await abortableMcpOperation(client.status({ signal }), signal)
      const identity = knowledgeBaseIdentity(config.projectRoot)
      const strict = config.privacyProfile === "strict"
      const output = {
        knowledgeBaseId: identity?.id ?? null,
        projectRoot: strict ? "." : config.projectRoot,
        rawDir: strict ? privateProjectPath(config.projectRoot, config.rawDir) : config.rawDir,
        storageDir: strict
          ? privateProjectPath(config.projectRoot, config.storageDir)
          : config.storageDir,
        sourcesFile: strict
          ? privateProjectPath(config.projectRoot, config.sourcesFile)
          : config.sourcesFile,
        privacyProfile: config.privacyProfile,
        retrievalProfile: config.retrievalProfile,
        embeddingProvider: config.embeddingProvider,
        embeddingModel: strict ? privateMcpPath(config.embeddingModel) : config.embeddingModel,
        embeddingModelRevision: config.embeddingModelRevision,
        embeddingModelPath: strict
          ? privateProjectPath(config.projectRoot, config.embeddingModelPath)
          : config.embeddingModelPath,
        transformersAllowRemoteModels: config.transformersAllowRemoteModels,
        llmGeneration: false,
        redactionEnabled: config.redaction.enabled,
        mcpMaxTopK: config.mcpMaxTopK,
        mcpMaxOutputBytes: config.mcpMaxOutputBytes,
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
        chunksIndexed: context.coverage.chunksIndexed,
      }

      return boundedJsonResult(output, mcpOutputBudget(config.mcpMaxOutputBytes), "ragmir_status")
    },
  )

  server.registerTool(
    "ragmir_route_prompt",
    {
      title: "Ragmir Prompt Router",
      description:
        "Classify a prompt and suggest whether an agent should use Ragmir local context.",
      inputSchema: promptRouteInputSchema,
      annotations: PURE_LOCAL_TOOL_ANNOTATIONS,
    },
    async ({ prompt }, { signal }) => {
      throwIfMcpAborted(signal)
      const config = await loadConfig(cwd)
      return boundedJsonResult(
        routePrompt(prompt),
        mcpOutputBudget(config.mcpMaxOutputBytes),
        "ragmir_route_prompt",
      )
    },
  )

  server.registerTool(
    "ragmir_search",
    {
      title: "Ragmir Search",
      description: "Retrieve relevant passages from the local Ragmir knowledge base.",
      inputSchema: searchToolInputSchema,
      annotations: POTENTIALLY_NETWORKED_TOOL_ANNOTATIONS,
    },
    async (
      {
        query,
        topK,
        contextRadius,
        compact,
        maxBytes,
        includePaths,
        excludePaths,
        contextPaths,
        explain,
      },
      { signal },
    ) => {
      throwIfMcpAborted(signal)
      const config = await loadConfig(cwd)
      const options = await searchOptions(
        cwd,
        topK,
        contextRadius,
        includePaths,
        excludePaths,
        contextPaths,
        explain,
      )
      const client = await clientLifecycle.getClient(config)
      const results = await client.search(query, { ...options, signal })
      const compactResults = compactSearchResults(results)
      const compactOutput = config.privacyProfile === "strict" || compact === true
      const preferred: McpSearchPayload = compactOutput ? compactResults : results
      const bounded = budgetMcpJson({
        tool: "ragmir_search",
        maxBytes: mcpOutputBudget(config.mcpMaxOutputBytes, maxBytes),
        fullValue: results,
        preferredValue: preferred,
        compactValue: compactResults,
        compacted: compactOutput,
        reduce: fitSearchPayload,
      })
      await recordBudgetedOutput(config, bounded)
      return bounded.result
    },
  )

  server.registerTool(
    "ragmir_ask",
    {
      title: "Ragmir Ask",
      description: "Return cited retrieval context for a question without calling an LLM.",
      inputSchema: askToolInputSchema,
      annotations: POTENTIALLY_NETWORKED_TOOL_ANNOTATIONS,
    },
    async (
      {
        query,
        topK,
        contextRadius,
        compact,
        maxBytes,
        includePaths,
        excludePaths,
        contextPaths,
        explain,
      },
      { signal },
    ) => {
      throwIfMcpAborted(signal)
      const config = await loadConfig(cwd)
      const options = await searchOptions(
        cwd,
        topK,
        contextRadius,
        includePaths,
        excludePaths,
        contextPaths,
        explain,
      )
      const cancellableOptions = { ...options, signal }
      const client = await clientLifecycle.getClient(config)
      let fullPayload: AskResult
      if (config.privacyProfile === "strict") {
        const results = await client.search(query, cancellableOptions)
        fullPayload = {
          answer: "Strict privacy profile returns compact cited retrieval only.",
          sources: results,
          staleWarning: null,
        }
      } else {
        fullPayload = await client.ask(query, cancellableOptions)
      }
      const compactPayload: McpAskPayload = {
        answer: "Ragmir returns compact cited retrieval only. Expand a citation when needed.",
        sources: compactSearchResults(fullPayload.sources),
        staleWarning: fullPayload.staleWarning,
      }
      const compactOutput = config.privacyProfile === "strict" || compact === true
      const bounded = budgetMcpJson({
        tool: "ragmir_ask",
        maxBytes: mcpOutputBudget(config.mcpMaxOutputBytes, maxBytes),
        fullValue: fullPayload,
        preferredValue: compactOutput ? compactPayload : fullPayload,
        compactValue: compactPayload,
        compacted: compactOutput,
        reduce: fitAskPayload,
      })
      await recordBudgetedOutput(config, bounded)
      return bounded.result
    },
  )

  server.registerTool(
    "ragmir_research",
    {
      title: "Ragmir Research",
      description:
        "Run an audit-backed multi-query research pass with cited evidence and optional code matches.",
      inputSchema: researchToolInputSchema,
      annotations: POTENTIALLY_NETWORKED_TOOL_ANNOTATIONS,
    },
    async (
      { query, topK, includeCode, compact, maxBytes, includePaths, excludePaths, contextPaths },
      { signal },
    ) => {
      throwIfMcpAborted(signal)
      const config = await loadConfig(cwd)
      const options = await searchOptions(
        cwd,
        topK,
        undefined,
        includePaths,
        excludePaths,
        contextPaths,
      )
      const researchOptions: Parameters<RagmirClient["research"]>[1] = { signal }
      addOption(researchOptions, "topK", options.topK)
      addOption(researchOptions, "includeCode", includeCode)
      addOption(researchOptions, "includePaths", options.includePaths)
      addOption(researchOptions, "excludePaths", options.excludePaths)
      addOption(researchOptions, "contextPaths", options.contextPaths)
      const client = await clientLifecycle.getClient(config)
      const result = await client.research(query, researchOptions)
      const compactResult = compactResearchReport(result)
      const compactOutput = config.privacyProfile === "strict" || compact === true
      const preferred: McpResearchPayload = compactOutput ? compactResult : result
      const bounded = budgetMcpJson({
        tool: "ragmir_research",
        maxBytes: mcpOutputBudget(config.mcpMaxOutputBytes, maxBytes),
        fullValue: result,
        preferredValue: preferred,
        compactValue: compactResult,
        compacted: compactOutput,
        reduce: fitResearchPayload,
      })
      await recordBudgetedOutput(config, bounded)
      return bounded.result
    },
  )

  server.registerTool(
    "ragmir_expand",
    {
      title: "Ragmir Expand",
      description: "Expand one Ragmir citation into a bounded exact passage window.",
      inputSchema: expandToolInputSchema,
      annotations: LOCAL_NON_DESTRUCTIVE_TOOL_ANNOTATIONS,
    },
    async ({ citation, contextRadius, maxBytes }, { signal }) => {
      throwIfMcpAborted(signal)
      const config = await loadConfig(cwd)
      const client = await clientLifecycle.getClient(config)
      const expanded = await client.expandCitation(citation, {
        signal,
        ...(contextRadius === undefined ? {} : { contextRadius }),
      })
      const bounded = budgetMcpJson({
        tool: "ragmir_expand",
        maxBytes: mcpOutputBudget(config.mcpMaxOutputBytes, maxBytes),
        fullValue: expanded,
        preferredValue: expanded,
        compacted: false,
        reduce: fitExpandedCitation,
      })
      await recordBudgetedOutput(config, bounded)
      return bounded.result
    },
  )

  server.registerTool(
    "ragmir_audit",
    {
      title: "Ragmir Audit",
      description: "Compare supported source files on disk with the current vector index.",
      inputSchema: auditToolInputSchema,
      annotations: LOCAL_NON_DESTRUCTIVE_TOOL_ANNOTATIONS,
    },
    async ({ maxBytes }, { signal }) => {
      throwIfMcpAborted(signal)
      const config = await loadConfig(cwd)
      const report = await abortableMcpOperation(audit(cwd, { signal }), signal)
      return boundedJsonResult(
        report,
        mcpOutputBudget(config.mcpMaxOutputBytes, maxBytes),
        "ragmir_audit",
      )
    },
  )

  server.registerTool(
    "ragmir_evaluate",
    {
      title: "Ragmir Evaluate",
      description: "Measure retrieval quality against a local golden query file.",
      inputSchema: evaluateToolInputSchema,
      annotations: POTENTIALLY_NETWORKED_TOOL_ANNOTATIONS,
    },
    async ({ goldenPath, topK, failUnder, maxBytes }, { signal }) => {
      throwIfMcpAborted(signal)
      const config = await loadConfig(cwd)
      try {
        const options = evaluationOptions(cwd, goldenPath, topK, config.mcpMaxTopK)
        const result = await abortableMcpOperation(
          evaluateGoldenQueries({ ...options, signal }),
          signal,
        )
        const safeResult = { ...result, goldenPath: options.goldenPath }
        const legacyRecallPassed = failUnder === undefined || result.recall >= failUnder
        const output =
          failUnder === undefined
            ? safeResult
            : {
                ...safeResult,
                minimumRecall: failUnder,
                legacyRecallPassed,
                passed: result.passed && legacyRecallPassed,
              }
        return boundedJsonResult(
          output,
          mcpOutputBudget(config.mcpMaxOutputBytes, maxBytes),
          "ragmir_evaluate",
        )
      } catch (error) {
        if (signal.aborted || config.privacyProfile !== "strict") {
          throw error
        }
        throw new Error(
          "ragmir_evaluate could not read or evaluate the project-relative golden file.",
        )
      }
    },
  )

  server.registerTool(
    "ragmir_security_audit",
    {
      title: "Ragmir Security Audit",
      description: "Show local privacy, provider, redaction, MCP, and gitignore posture.",
      inputSchema: z.object({}).strict(),
      annotations: PURE_LOCAL_TOOL_ANNOTATIONS,
    },
    async (_input, { signal }) => {
      throwIfMcpAborted(signal)
      const config = await loadConfig(cwd)
      const report = await abortableMcpOperation(securityAudit(cwd, { signal }), signal)
      const output =
        config.privacyProfile !== "strict"
          ? report
          : {
              ...report,
              projectRoot: ".",
              providers: {
                ...report.providers,
                embeddingModel: privateMcpPath(report.providers.embeddingModel),
                embeddingModelPath: privateProjectPath(
                  config.projectRoot,
                  report.providers.embeddingModelPath,
                ),
              },
              accessLog: {
                ...report.accessLog,
                path: privateProjectPath(config.projectRoot, report.accessLog.path),
              },
              storage: {
                ...report.storage,
                path: privateProjectPath(config.projectRoot, report.storage.path),
              },
            }
      return boundedJsonResult(
        output,
        mcpOutputBudget(config.mcpMaxOutputBytes),
        "ragmir_security_audit",
      )
    },
  )

  server.registerTool(
    "ragmir_usage_report",
    {
      title: "Ragmir Usage Report",
      description: "Summarize the metadata-only local access log.",
      inputSchema: usageReportInputSchema,
      annotations: PURE_LOCAL_TOOL_ANNOTATIONS,
    },
    async ({ days }, { signal }) => {
      throwIfMcpAborted(signal)
      const options: Parameters<typeof accessLogUsageReport>[0] = { cwd }
      options.signal = signal
      if (days !== undefined) {
        options.days = days
      }
      const config = await loadConfig(cwd)
      const report = await abortableMcpOperation(accessLogUsageReport(options), signal)
      return boundedJsonResult(
        report,
        mcpOutputBudget(config.mcpMaxOutputBytes),
        "ragmir_usage_report",
      )
    },
  )

  return server
}

export async function connectMcpServer(
  transport: Transport,
  cwd = resolveMcpProjectRoot(),
): Promise<McpServer> {
  const server = createMcpServer(cwd)
  await server.connect(transport)
  return server
}

export async function serveMcp(cwd = resolveMcpProjectRoot()): Promise<void> {
  await connectMcpServer(new StdioServerTransport(), cwd)
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

function jsonResource(
  uri: URL,
  value: unknown,
  maxBytes: number,
  source: string,
): {
  contents: Array<{ uri: string; mimeType: string; text: string }>
  _meta: { "ragmir/output": BoundedJsonMetadata }
} {
  const bounded = fitMcpJsonOutput(value, maxBytes, source)
  return {
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: bounded.text,
      },
    ],
    _meta: { "ragmir/output": bounded.metadata },
  }
}

function boundedJsonResult(
  value: unknown,
  maxBytes: number,
  source: string,
): {
  content: [{ type: "text"; text: string }]
  _meta: { "ragmir/output": BoundedJsonMetadata }
} {
  const bounded = fitMcpJsonOutput(value, maxBytes, source)
  return {
    content: [{ type: "text", text: bounded.text }],
    _meta: { "ragmir/output": bounded.metadata },
  }
}

function mcpOutputBudget(configured: number, requested?: number): number {
  return resolveMcpOutputBudget(Math.min(configured, MAX_MCP_OUTPUT_BYTES), requested)
}

function throwIfMcpAborted(signal: AbortSignal): void {
  if (!signal.aborted) {
    return
  }
  if (signal.reason instanceof Error) {
    throw signal.reason
  }
  throw new Error("The MCP request was cancelled.")
}

function abortableMcpOperation<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  throwIfMcpAborted(signal)
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup()
      try {
        throwIfMcpAborted(signal)
      } catch (error) {
        reject(error)
      }
    }
    const cleanup = () => signal.removeEventListener("abort", onAbort)
    signal.addEventListener("abort", onAbort, { once: true })
    void operation.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error: unknown) => {
        cleanup()
        reject(error)
      },
    )
  })
}

async function recordBudgetedOutput(
  config: Awaited<ReturnType<typeof loadConfig>>,
  bounded: BudgetedMcpResult,
): Promise<void> {
  await recordMcpOutput(config, {
    tool: bounded.metadata.tool,
    retrievedBytes: bounded.metadata.retrievedBytes,
    returnedBytes: bounded.metadata.returnedBytes,
    compacted: bounded.metadata.compacted,
    truncated: bounded.metadata.truncated,
  })
}

export async function searchOptions(
  cwd: string,
  topK: number | undefined,
  contextRadius?: number | undefined,
  includePaths?: string[] | undefined,
  excludePaths?: string[] | undefined,
  contextPaths?: string[] | undefined,
  explain?: boolean | undefined,
): Promise<{
  cwd: string
  topK?: number
  contextRadius?: number
  includePaths?: string[]
  excludePaths?: string[]
  contextPaths?: string[]
  explain?: boolean
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
    contextPaths?: string[]
    explain?: boolean
  } = {
    cwd,
    topK: boundedTopK,
  }
  addOption(result, "contextRadius", boundedContextRadius)
  addOption(result, "includePaths", includePaths)
  addOption(result, "excludePaths", excludePaths)
  addOption(result, "contextPaths", contextPaths)
  addOption(result, "explain", explain)
  return result
}

function evaluationOptions(
  cwd: string,
  goldenPath: string,
  topK: number | undefined,
  maxTopK: number,
): { cwd: string; goldenPath: string; topK?: number; maxTopK: number } {
  const result = {
    cwd,
    goldenPath: projectRelativeGoldenPath(cwd, goldenPath),
    maxTopK,
  }
  if (topK === undefined) {
    return result
  }
  return { ...result, topK: Math.min(topK, maxTopK) }
}

export function projectRelativeGoldenPath(cwd: string, goldenPath: string): string {
  if (path.isAbsolute(goldenPath)) {
    throw new Error("ragmir_evaluate goldenPath must stay inside the MCP project root.")
  }
  const root = realpathSync.native(path.resolve(cwd))
  const absolutePath = path.resolve(root, goldenPath)
  const lexicalRelativePath = path.relative(root, absolutePath)
  if (pathEscapesRoot(lexicalRelativePath)) {
    throw new Error("ragmir_evaluate goldenPath must stay inside the MCP project root.")
  }
  const resolvedPath = realpathSync.native(absolutePath)
  const relativePath = path.relative(root, resolvedPath)
  if (pathEscapesRoot(relativePath)) {
    throw new Error("ragmir_evaluate goldenPath must stay inside the MCP project root.")
  }
  return relativePath
}

function pathEscapesRoot(relativePath: string): boolean {
  return (
    relativePath.length === 0 ||
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  )
}

function privateMcpPath(value: string): string {
  return path.isAbsolute(value) ? "<absolute-path>" : value
}

function privateProjectPath(projectRoot: string, value: string): string {
  const relativePath = path.relative(projectRoot, path.resolve(value))
  if (relativePath.length === 0) {
    return "."
  }
  return pathEscapesRoot(relativePath) ? "<outside-project>" : relativePath
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
