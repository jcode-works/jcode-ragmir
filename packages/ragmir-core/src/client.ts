import type { PathLike } from "node:fs"
import type { Connection } from "@lancedb/lancedb"
import { loadConfig } from "./config.js"
import { getKnowledgeBaseContext, getKnowledgeBaseSourceCatalog } from "./context-resources.js"
import { normalizeRagmirError, RagmirError } from "./errors.js"
import { ingestWithConfig } from "./ingest.js"
import { askWithConfig, expandCitationWithConfig, searchWithConfig } from "./query.js"
import { researchWithConfig } from "./research.js"
import { connectStore } from "./store.js"
import type {
  AskResult,
  Config,
  ExpandCitationOptions,
  ExpandedCitation,
  IngestOptions,
  IngestResult,
  KnowledgeBaseContextReport,
  KnowledgeBaseSourceCatalog,
  OperationOptions,
  ResearchOptions,
  ResearchReport,
  SearchOptions,
  SearchResult,
} from "./types.js"

export interface RagmirClientOptions {
  cwd?: PathLike
}

export class RagmirClient {
  readonly projectRoot: string
  private readonly config: Config
  private readonly connection: Connection
  private readonly activeOperations = new Set<Promise<unknown>>()
  private closed = false
  private closePromise: Promise<void> | undefined

  private constructor(config: Config, connection: Connection) {
    this.config = config
    this.connection = connection
    this.projectRoot = config.projectRoot
  }

  get isClosed(): boolean {
    return this.closed
  }

  static async create(options: RagmirClientOptions = {}): Promise<RagmirClient> {
    try {
      const config = await loadConfig(String(options.cwd ?? process.cwd()))
      const connection = await connectStore(config)
      return new RagmirClient(config, connection)
    } catch (error) {
      throw normalizeRagmirError(error)
    }
  }

  async ingest(options: Omit<IngestOptions, "cwd"> = {}): Promise<IngestResult> {
    return this.run(() => ingestWithConfig(this.config, options, this.connection))
  }

  async search(query: string, options: Omit<SearchOptions, "cwd"> = {}): Promise<SearchResult[]> {
    return this.run(() => searchWithConfig(query, options, this.config, this.connection))
  }

  async ask(query: string, options: Omit<SearchOptions, "cwd"> = {}): Promise<AskResult> {
    return this.run(() => askWithConfig(query, options, this.config, this.connection))
  }

  async research(
    query: string,
    options: Omit<ResearchOptions, "cwd"> = {},
  ): Promise<ResearchReport> {
    return this.run(() => researchWithConfig(query, options, this.config, this.connection))
  }

  async expandCitation(
    citation: string,
    options: Omit<ExpandCitationOptions, "cwd"> = {},
  ): Promise<ExpandedCitation> {
    return this.run(() => expandCitationWithConfig(citation, options, this.config, this.connection))
  }

  async status(options: OperationOptions = {}): Promise<KnowledgeBaseContextReport> {
    return this.run(() => getKnowledgeBaseContext(this.projectRoot, options))
  }

  async sources(options: OperationOptions = {}): Promise<KnowledgeBaseSourceCatalog> {
    return this.run(() => getKnowledgeBaseSourceCatalog(this.projectRoot, options))
  }

  async close(): Promise<void> {
    if (!this.closePromise) {
      this.closed = true
      this.closePromise = (async () => {
        await Promise.allSettled([...this.activeOperations])
        this.connection.close()
      })()
    }
    await this.closePromise
  }

  private assertOpen(): void {
    if (this.closed || !this.connection.isOpen()) {
      throw new RagmirError("CLIENT_CLOSED", "Ragmir client is closed.")
    }
  }

  private run<T>(operation: () => Promise<T>): Promise<T> {
    this.assertOpen()
    const active = (async () => {
      try {
        return await operation()
      } catch (error) {
        throw normalizeRagmirError(error)
      }
    })()
    this.activeOperations.add(active)
    void active.then(
      () => this.activeOperations.delete(active),
      () => this.activeOperations.delete(active),
    )
    return active
  }
}

export async function createRagmirClient(options: RagmirClientOptions = {}): Promise<RagmirClient> {
  return RagmirClient.create(options)
}
