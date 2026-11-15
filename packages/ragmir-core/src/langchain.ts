import { Document } from "@langchain/core/documents"
import { BaseRetriever, type BaseRetrieverInput } from "@langchain/core/retrievers"
import { BaseToolkit, type StructuredToolInterface, tool } from "@langchain/core/tools"
import { z } from "zod"
import { RagmirClient } from "./client.js"
import type { ExpandedCitation, SearchOptions, SearchResult, SourceStatus } from "./types.js"

/** Search settings the retriever forwards to `RagmirClient.search` on every query. */
export type RagmirRetrieverSearchOptions = Omit<SearchOptions, "cwd" | "explain" | "signal">

export interface RagmirRetrieverInput extends BaseRetrieverInput, RagmirRetrieverSearchOptions {
  /**
   * Client to query. The retriever never closes a client it did not open, so one client can serve
   * several retrievers and the rest of the application.
   */
  client?: RagmirClient
  /**
   * Project root, or a directory inside it, used to open a client on the first query when `client`
   * is not given. Defaults to the current working directory. Call `close()` during shutdown.
   */
  projectRoot?: string
}

/** Citation fields attached to every LangChain document the retriever returns. */
export interface RagmirDocumentMetadata extends Record<string, unknown> {
  /** Project-relative path of the cited file. */
  source: string
  /** Exact citation, such as `docs/runbook.md:L12-L18` or a PDF page, slide, or cell range. */
  citation: string
  chunkIndex: number
  /** Heading or structural path of the passage inside its file. */
  contextPath: string
  lineStart: number | null
  lineEnd: number | null
  pageStart: number | null
  pageEnd: number | null
  /** Vector distance when a semantic model scored the passage, otherwise null. */
  distance: number | null
  /** The passage holds few of the question's distinctive words: verify it before relying on it. */
  weakEvidence: boolean
  /** Set when the cited file changed or disappeared since it was indexed. */
  sourceStatus?: SourceStatus
  knowledgeBaseId?: string
}

/** Opens a client on first use unless the caller shares one, and closes only the one it opened. */
class ClientHandle {
  private owned: Promise<RagmirClient> | undefined

  constructor(
    private readonly shared: RagmirClient | undefined,
    private readonly projectRoot: string | undefined,
  ) {}

  get(): Promise<RagmirClient> {
    if (this.shared) {
      return Promise.resolve(this.shared)
    }
    if (!this.owned) {
      const opening = RagmirClient.create(
        this.projectRoot === undefined ? {} : { cwd: this.projectRoot },
      )
      this.owned = opening
      opening.catch(() => {
        if (this.owned === opening) {
          this.owned = undefined
        }
      })
    }
    return this.owned
  }

  async close(): Promise<void> {
    const owned = this.owned
    if (!owned) {
      return
    }
    const client = await owned.catch(() => undefined)
    await client?.close()
  }
}

/**
 * LangChain.js retriever backed by a local Ragmir base. Each document carries its citation in
 * `metadata`, and a query the indexed sources cannot answer returns an empty list instead of the
 * least unrelated passages.
 */
export class RagmirRetriever extends BaseRetriever<RagmirDocumentMetadata> {
  static lc_name(): string {
    return "RagmirRetriever"
  }

  lc_namespace = ["ragmir", "retrievers"]

  private readonly handle: ClientHandle
  private readonly searchOptions: RagmirRetrieverSearchOptions

  constructor(input: RagmirRetrieverInput = {}) {
    const { client, projectRoot, callbacks, tags, metadata, verbose, ...searchOptions } = input
    super({
      ...(callbacks === undefined ? {} : { callbacks }),
      ...(tags === undefined ? {} : { tags }),
      ...(metadata === undefined ? {} : { metadata }),
      ...(verbose === undefined ? {} : { verbose }),
    })
    this.handle = new ClientHandle(client, projectRoot)
    this.searchOptions = searchOptions
  }

  async _getRelevantDocuments(query: string): Promise<Document<RagmirDocumentMetadata>[]> {
    const client = await this.handle.get()
    const results = await client.search(query, this.searchOptions)
    return results.map(ragmirResultToDocument)
  }

  /** Closes the client this retriever opened. A client passed in `client` stays open. */
  async close(): Promise<void> {
    await this.handle.close()
  }
}

export interface RagmirToolkitInput extends RagmirRetrieverSearchOptions {
  /** Client the tools query; the toolkit never closes a client it did not open. */
  client?: RagmirClient
  /** Project root used to open a client on the first call when `client` is not given. */
  projectRoot?: string
}

const MAX_TOOL_TOP_K = 10
const MAX_TOOL_CONTEXT_RADIUS = 3

/**
 * Agent tools over a Ragmir base for LangChain and LangGraph agents: `ragmir_search` returns cited
 * passages and `ragmir_expand` reads one citation with its neighbours. Each tool answers the model
 * with text and keeps the structured results as the tool message artifact.
 */
export class RagmirToolkit extends BaseToolkit {
  tools: StructuredToolInterface[]

  private readonly handle: ClientHandle

  constructor(input: RagmirToolkitInput = {}) {
    super()
    const { client, projectRoot, ...searchOptions } = input
    this.handle = new ClientHandle(client, projectRoot)
    this.tools = [ragmirSearchTool(this.handle, searchOptions), ragmirExpandTool(this.handle)]
  }

  /** Closes the client this toolkit opened. A client passed in `client` stays open. */
  async close(): Promise<void> {
    await this.handle.close()
  }
}

/** The `ragmir_search` and `ragmir_expand` agent tools over one shared client. */
export function createRagmirTools(input: RagmirToolkitInput & { client: RagmirClient }) {
  return new RagmirToolkit(input).getTools()
}

function ragmirSearchTool(handle: ClientHandle, defaults: RagmirRetrieverSearchOptions) {
  return tool(
    async ({ query, topK, includePaths, excludePaths }) => {
      const client = await handle.get()
      const results = await client.search(query, {
        ...defaults,
        ...(topK === undefined ? {} : { topK }),
        ...(includePaths === undefined ? {} : { includePaths }),
        ...(excludePaths === undefined ? {} : { excludePaths }),
      })
      const documents = results.map(ragmirResultToDocument)
      return [searchResultsText(results), documents] as const
    },
    {
      name: "ragmir_search",
      description:
        "Search the project's indexed documents and code for passages that answer a question. Each passage comes with a citation (file and lines, PDF page, slide, sheet cells, or section) to quote. No passage means the documents hold no evidence: say so instead of guessing. Use ragmir_expand to read a cited passage with its surroundings.",
      schema: z.object({
        query: z
          .string()
          .min(1)
          .describe("One focused question, in natural language or with exact identifiers."),
        topK: z
          .number()
          .int()
          .min(1)
          .max(MAX_TOOL_TOP_K)
          .optional()
          .describe("Passages to return, 1 to 10."),
        includePaths: z
          .array(z.string().min(1))
          .max(20)
          .optional()
          .describe("Search only these folders, files, or globs such as docs/** or **/*.pdf."),
        excludePaths: z
          .array(z.string().min(1))
          .max(20)
          .optional()
          .describe("Skip these folders, files, or globs."),
      }),
      responseFormat: "content_and_artifact",
    },
  )
}

function ragmirExpandTool(handle: ClientHandle) {
  return tool(
    async ({ citation, contextRadius }) => {
      const client = await handle.get()
      const expanded = await client.expandCitation(citation, {
        contextRadius: contextRadius ?? 1,
      })
      return [expandedCitationText(expanded), expanded] as const
    },
    {
      name: "ragmir_expand",
      description:
        "Read the full text of one citation returned by ragmir_search, with up to three neighbouring passages on each side. To read a long document through, call it again with the nextCitation it returns.",
      schema: z.object({
        citation: z
          .string()
          .min(1)
          .describe("A citation from ragmir_search, such as docs/runbook.md:L12-L18#4."),
        contextRadius: z
          .number()
          .int()
          .min(0)
          .max(MAX_TOOL_CONTEXT_RADIUS)
          .optional()
          .describe("Neighbouring passages on each side, 0 to 3. Default 1."),
      }),
      responseFormat: "content_and_artifact",
    },
  )
}

function searchResultsText(results: SearchResult[]): string {
  if (results.length === 0) {
    return "No passage in the indexed documents supports an answer to this question."
  }
  return results
    .map((result, index) => {
      const notes = [
        result.weakEvidence ? "weak match: verify before relying on it" : "",
        result.sourceStatus ? `file ${result.sourceStatus} since indexing` : "",
      ].filter(Boolean)
      return `[${index + 1}] ${result.citation}${notes.length > 0 ? ` (${notes.join("; ")})` : ""}\n${result.text}`
    })
    .join("\n\n")
}

function expandedCitationText(expanded: ExpandedCitation): string {
  if (!expanded.found) {
    return `${expanded.requestedCitation} is no longer in the index. Search again for current evidence.`
  }
  const passages = expanded.passages.map((passage) => `[${passage.citation}]\n${passage.text}`)
  const next = expanded.nextCitation ? [`Continue reading: ${expanded.nextCitation}`] : []
  return [...passages, ...next].join("\n\n")
}

/** Converts one Ragmir search result into a LangChain document that keeps its citation. */
export function ragmirResultToDocument(result: SearchResult): Document<RagmirDocumentMetadata> {
  const metadata: RagmirDocumentMetadata = {
    source: result.relativePath,
    citation: result.citation,
    chunkIndex: result.chunkIndex,
    contextPath: result.contextPath,
    lineStart: result.lineStart,
    lineEnd: result.lineEnd,
    pageStart: result.pageStart,
    pageEnd: result.pageEnd,
    distance: result.distance,
    weakEvidence: result.weakEvidence === true,
  }
  if (result.sourceStatus) {
    metadata.sourceStatus = result.sourceStatus
  }
  if (result.evidence?.knowledgeBaseId) {
    metadata.knowledgeBaseId = result.evidence.knowledgeBaseId
  }
  return new Document<RagmirDocumentMetadata>({
    pageContent: result.text,
    metadata,
    id: result.evidence?.id ?? result.citation,
  })
}
