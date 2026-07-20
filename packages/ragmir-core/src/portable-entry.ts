import { existsSync } from "node:fs"
import path from "node:path"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { loadConfig } from "./config.js"
import { RAGMIR_PORTABLE_READ_ONLY_ENV, RAGMIR_PROJECT_ROOT_ENV } from "./defaults.js"
import { verifyPortableKnowledgeBase } from "./portable.js"
import { routePrompt } from "./prompt-routing.js"
import { ask, expandCitation, search } from "./query.js"
import { readIndexManifestHeader } from "./store.js"
import type { SearchOptions, SearchResult } from "./types.js"
import { VERSION } from "./version.js"

const MAX_PORTABLE_TOP_K = 20
const MAX_COMPACT_SNIPPET_CHARACTERS = 320
const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}

const searchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(20_000),
    topK: z.number().int().positive().max(MAX_PORTABLE_TOP_K).optional(),
    contextRadius: z.number().int().min(0).max(3).optional(),
    compact: z.boolean().optional(),
    includePaths: z.array(z.string().min(1).max(500)).max(20).optional(),
    excludePaths: z.array(z.string().min(1).max(500)).max(20).optional(),
    contextPaths: z.array(z.string().min(1).max(500)).max(20).optional(),
  })
  .strict()

const expandInputSchema = z
  .object({
    citation: z.string().min(1).max(2_000),
    contextRadius: z.number().int().min(0).max(3).optional(),
  })
  .strict()

const routeInputSchema = z.object({ prompt: z.string().trim().min(1).max(20_000) }).strict()

export async function runPortableCli(argv = process.argv.slice(2)): Promise<void> {
  const [command, ...rest] = argv
  if (!command || command === "--help" || command === "-h") {
    writeHelp()
    return
  }
  if (command === "--version" || command === "-V") {
    process.stdout.write(`${VERSION}\n`)
    return
  }

  const root = portableRoot()
  process.chdir(root)
  process.env[RAGMIR_PROJECT_ROOT_ENV] = root
  process.env[RAGMIR_PORTABLE_READ_ONLY_ENV] = "1"

  if (command === "serve-mcp") {
    await servePortableMcp(root)
    return
  }
  if (command === "portable") {
    await runPortableVerification(rest, root)
    return
  }
  if (command === "status" || command === "doctor") {
    const json = rest.includes("--json")
    const result = await portableStatus(root)
    writeValue(result, json)
    return
  }
  if (command === "route-prompt") {
    const parsed = parseCommandArguments(rest)
    const prompt = parsed.positionals.join(" ")
    if (!prompt) {
      throw new Error("Missing prompt. Pass text after `route-prompt`.")
    }
    writeValue(routePrompt(prompt), parsed.json)
    return
  }
  if (command === "search" || command === "ask") {
    const parsed = parseCommandArguments(rest)
    const query = parsed.positionals.join(" ")
    if (!query) {
      throw new Error(`Missing query. Pass text after \`${command}\`.`)
    }
    const options = searchOptions(parsed, root)
    const result = command === "search" ? await search(query, options) : await ask(query, options)
    writeValue(parsed.compact ? compactValue(result) : result, parsed.json)
    return
  }

  throw new Error(
    "This frozen bundle allows only status, doctor, route-prompt, search, ask, serve-mcp, and portable verify.",
  )
}

async function runPortableVerification(args: string[], root: string): Promise<void> {
  const [subcommand, ...rest] = args
  if (subcommand !== "verify") {
    throw new Error("Portable bundles allow only the `portable verify` subcommand.")
  }
  const target = rest.find((value) => !value.startsWith("-")) ?? root
  const result = await verifyPortableKnowledgeBase(target)
  writeValue(result, rest.includes("--json"))
  if (!result.valid) {
    process.exitCode = 1
  }
}

export async function servePortableMcp(cwd = portableRoot()): Promise<void> {
  const server = createPortableMcpServer(cwd)
  await server.connect(new StdioServerTransport())
}

export function createPortableMcpServer(cwd = portableRoot()): McpServer {
  const server = new McpServer({ name: "ragmir-portable", version: VERSION })

  server.registerResource(
    "ragmir-context",
    "ragmir://context",
    {
      title: "Ragmir Portable Knowledge Base Context",
      description: "Identity and read-only capabilities of this frozen portable knowledge base.",
      mimeType: "application/json",
    },
    async (uri) => jsonResource(uri.href, await portableStatus(cwd)),
  )

  server.registerResource(
    "ragmir-sources",
    "ragmir://sources",
    {
      title: "Ragmir Portable Source Catalog",
      description: "The source catalog is intentionally unavailable in a frozen portable bundle.",
      mimeType: "application/json",
    },
    async (uri) =>
      jsonResource(uri.href, {
        sourceFilesIncluded: false,
        indexedPassagesIncluded: true,
        message: "Raw source files are intentionally excluded from this frozen portable bundle.",
      }),
  )

  server.registerTool(
    "ragmir_status",
    {
      title: "Ragmir Portable Status",
      description: "Show frozen knowledge-base identity, readiness, and read-only capabilities.",
      inputSchema: z.object({}).strict(),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => jsonToolResult(await portableStatus(cwd)),
  )

  server.registerTool(
    "ragmir_route_prompt",
    {
      title: "Ragmir Prompt Router",
      description: "Classify a prompt and suggest whether cited portable evidence is useful.",
      inputSchema: routeInputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ prompt }) => jsonToolResult(routePrompt(prompt)),
  )

  server.registerTool(
    "ragmir_search",
    {
      title: "Ragmir Portable Search",
      description: "Retrieve cited evidence from the frozen portable knowledge base.",
      inputSchema: searchInputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input) => {
      const results = await search(input.query, searchOptions(input, cwd))
      return jsonToolResult(input.compact === false ? results : compactResults(results))
    },
  )

  server.registerTool(
    "ragmir_ask",
    {
      title: "Ragmir Portable Ask",
      description: "Return cited retrieval context without invoking an LLM.",
      inputSchema: searchInputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input) => {
      const result = await ask(input.query, searchOptions(input, cwd))
      return jsonToolResult(
        input.compact === false
          ? result
          : {
              answer: "Ragmir returns compact cited retrieval only. Expand a citation when needed.",
              sources: compactResults(result.sources),
              staleWarning: result.staleWarning,
            },
      )
    },
  )

  server.registerTool(
    "ragmir_expand",
    {
      title: "Ragmir Portable Expand",
      description: "Expand an exact cited passage from the frozen portable knowledge base.",
      inputSchema: expandInputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ citation, contextRadius }) =>
      jsonToolResult(
        await expandCitation(citation, {
          cwd,
          ...(contextRadius === undefined ? {} : { contextRadius }),
        }),
      ),
  )

  return server
}

async function portableStatus(cwd: string): Promise<Record<string, unknown>> {
  const config = await loadConfig(cwd)
  const manifest = await readIndexManifestHeader(config)
  return {
    knowledgeBaseId: ".",
    frozen: true,
    ready: manifest !== null && (manifest.chunkCount ?? 0) > 0,
    corpusFingerprint: manifest?.corpusFingerprint ?? null,
    indexedFiles: manifest?.fileCount ?? 0,
    chunksIndexed: manifest?.chunkCount ?? 0,
    embeddingProvider: config.embeddingProvider,
    embeddingModel: config.embeddingModel,
    embeddingModelRevision: config.embeddingModelRevision,
    embeddingModelDigest: config.embeddingModelDigest,
    retrievalProfile: config.retrievalProfile,
    sourceFilesIncluded: false,
    indexedPassagesIncluded: true,
    accessLogsIncluded: false,
    tools: ["ragmir_status", "ragmir_route_prompt", "ragmir_search", "ragmir_ask", "ragmir_expand"],
  }
}

interface ParsedCommandArguments {
  json: boolean
  compact: boolean
  topK: number | undefined
  contextRadius: number | undefined
  includePaths: string[]
  excludePaths: string[]
  contextPaths: string[]
  positionals: string[]
}

function parseCommandArguments(args: string[]): ParsedCommandArguments {
  const parsed: ParsedCommandArguments = {
    json: false,
    compact: false,
    topK: undefined,
    contextRadius: undefined,
    includePaths: [],
    excludePaths: [],
    contextPaths: [],
    positionals: [],
  }
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]
    if (value === undefined) {
      continue
    }
    if (value === "--json") {
      parsed.json = true
      continue
    }
    if (value === "--compact") {
      parsed.compact = true
      continue
    }
    if (value === "--top-k" || value === "--topK") {
      parsed.topK = parsePositiveInteger(args[++index], value)
      continue
    }
    if (value === "--context-radius") {
      parsed.contextRadius = parseNonnegativeInteger(args[++index], value)
      continue
    }
    if (value === "--include-path") {
      parsed.includePaths.push(requiredOptionValue(args[++index], value))
      continue
    }
    if (value === "--exclude-path") {
      parsed.excludePaths.push(requiredOptionValue(args[++index], value))
      continue
    }
    if (value === "--context-path") {
      parsed.contextPaths.push(requiredOptionValue(args[++index], value))
      continue
    }
    if (value.startsWith("-")) {
      throw new Error(`Unknown option: ${value}`)
    }
    parsed.positionals.push(value)
  }
  return parsed
}

function searchOptions(
  input: {
    topK?: number | undefined
    contextRadius?: number | undefined
    includePaths?: string[] | undefined
    excludePaths?: string[] | undefined
    contextPaths?: string[] | undefined
  },
  cwd: string,
): SearchOptions {
  return {
    cwd,
    ...(input.topK === undefined ? {} : { topK: Math.min(input.topK, MAX_PORTABLE_TOP_K) }),
    ...(input.contextRadius === undefined ? {} : { contextRadius: input.contextRadius }),
    ...(input.includePaths?.length ? { includePaths: input.includePaths } : {}),
    ...(input.excludePaths?.length ? { excludePaths: input.excludePaths } : {}),
    ...(input.contextPaths?.length ? { contextPaths: input.contextPaths } : {}),
  }
}

function compactResults(results: SearchResult[]): Array<Record<string, unknown>> {
  return results.map((result) => ({
    source: result.source,
    relativePath: result.relativePath,
    chunkIndex: result.chunkIndex,
    contextPath: result.contextPath,
    citation: result.citation,
    snippet: result.text.slice(0, MAX_COMPACT_SNIPPET_CHARACTERS),
    distance: result.distance,
    lineStart: result.lineStart,
    lineEnd: result.lineEnd,
    pageStart: result.pageStart,
    pageEnd: result.pageEnd,
  }))
}

function compactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return compactResults(value as SearchResult[])
  }
  return value
}

function jsonToolResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
  }
}

function jsonResource(uri: string, value: unknown) {
  return {
    contents: [{ uri, mimeType: "application/json", text: JSON.stringify(value) }],
  }
}

function writeValue(value: unknown, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
    return
  }
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function writeHelp(): void {
  process.stdout.write(
    [
      "Usage: node bin/rgr.cjs <command> [options]",
      "",
      "Frozen portable knowledge-base commands:",
      "  status [--json]",
      "  doctor [--json]",
      "  route-prompt [--json] <prompt>",
      "  search [--json] [--compact] [--top-k <n>] <query>",
      "  ask [--json] [--compact] [--top-k <n>] <query>",
      "  serve-mcp",
      "  portable verify [directory] [--json]",
      "",
    ].join("\n"),
  )
}

function portableRoot(): string {
  const configured = process.env[RAGMIR_PROJECT_ROOT_ENV]
  if (configured && existsSync(path.join(configured, ".ragmir", "config.json"))) {
    return path.resolve(configured)
  }
  return process.cwd()
}

function parsePositiveInteger(value: string | undefined, option: string): number {
  const parsed = parseNonnegativeInteger(value, option)
  if (parsed < 1) {
    throw new Error(`${option} must be a positive integer.`)
  }
  return parsed
}

function parseNonnegativeInteger(value: string | undefined, option: string): number {
  const parsed = Number(requiredOptionValue(value, option))
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${option} must be a non-negative integer.`)
  }
  return parsed
}

function requiredOptionValue(value: string | undefined, option: string): string {
  if (!value || value.startsWith("-")) {
    throw new Error(`Missing value for ${option}.`)
  }
  return value
}

if (process.argv[1]?.endsWith("portable-entry.js")) {
  runPortableCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
