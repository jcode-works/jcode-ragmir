import { Document } from "@langchain/core/documents"
import { BaseRetriever, type BaseRetrieverInput } from "@langchain/core/retrievers"
import { RagmirClient } from "./client.js"
import type { SearchOptions, SearchResult, SourceStatus } from "./types.js"

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

  private readonly sharedClient: RagmirClient | undefined
  private readonly projectRoot: string | undefined
  private readonly searchOptions: RagmirRetrieverSearchOptions
  private ownedClient: Promise<RagmirClient> | undefined

  constructor(input: RagmirRetrieverInput = {}) {
    const { client, projectRoot, callbacks, tags, metadata, verbose, ...searchOptions } = input
    super({
      ...(callbacks === undefined ? {} : { callbacks }),
      ...(tags === undefined ? {} : { tags }),
      ...(metadata === undefined ? {} : { metadata }),
      ...(verbose === undefined ? {} : { verbose }),
    })
    this.sharedClient = client
    this.projectRoot = projectRoot
    this.searchOptions = searchOptions
  }

  async _getRelevantDocuments(query: string): Promise<Document<RagmirDocumentMetadata>[]> {
    const client = await this.client()
    const results = await client.search(query, this.searchOptions)
    return results.map(ragmirResultToDocument)
  }

  /** Closes the client this retriever opened. A client passed in `client` stays open. */
  async close(): Promise<void> {
    const owned = this.ownedClient
    if (!owned) {
      return
    }
    const client = await owned.catch(() => undefined)
    await client?.close()
  }

  private client(): Promise<RagmirClient> {
    if (this.sharedClient) {
      return Promise.resolve(this.sharedClient)
    }
    if (!this.ownedClient) {
      const opening = RagmirClient.create(
        this.projectRoot === undefined ? {} : { cwd: this.projectRoot },
      )
      this.ownedClient = opening
      opening.catch(() => {
        if (this.ownedClient === opening) {
          this.ownedClient = undefined
        }
      })
    }
    return this.ownedClient
  }
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
