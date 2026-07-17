import type { PathLike } from "node:fs"
import type { Connection } from "@lancedb/lancedb"
import { flushAccessLog } from "./access-log.js"
import { loadConfig } from "./config.js"
import {
  getKnowledgeBaseContextWithConfig,
  getKnowledgeBaseSourceCatalogWithConfig,
} from "./context-resources.js"
import { retainEmbeddingModel } from "./embeddings.js"
import { normalizeRagmirError, RagmirError } from "./errors.js"
import { ingestWithConfig } from "./ingest.js"
import { askWithConfig, expandCitationWithConfig, searchWithConfig } from "./query.js"
import { researchWithConfig } from "./research.js"
import type { IndexReadSnapshot } from "./store.js"
import {
  closeIndexReadSnapshot,
  closeStoreConnection,
  connectStore,
  indexReadSnapshotCurrent,
  loadIndexReadSnapshot,
} from "./store.js"
import type {
  AskResult,
  Config,
  ExpandCitationOptions,
  ExpandedCitation,
  IngestOptions,
  IngestResult,
  KnowledgeBaseContextReport,
  KnowledgeBaseSourceCatalog,
  KnowledgeBaseSourceCatalogOptions,
  OperationOptions,
  ResearchOptions,
  ResearchReport,
  SearchOptions,
  SearchResult,
} from "./types.js"

export interface RagmirClientOptions {
  cwd?: PathLike
}

interface IndexSnapshotEntry {
  snapshot: IndexReadSnapshot
  references: number
  retired: boolean
}

interface IndexSnapshotLease {
  snapshot: IndexReadSnapshot
  release(): void
}

export class RagmirClient {
  readonly projectRoot: string
  private readonly config: Config
  private readonly connection: Connection
  private readonly releaseEmbeddingModel: () => Promise<void>
  private readonly activeOperations = new Set<Promise<unknown>>()
  private readonly retiredIndexSnapshots = new Set<IndexSnapshotEntry>()
  private indexSnapshot: IndexSnapshotEntry | undefined
  private indexSnapshotLoad: Promise<IndexSnapshotEntry> | undefined
  private indexSnapshotEpoch = 0
  private closed = false
  private closePromise: Promise<void> | undefined

  private constructor(config: Config, connection: Connection) {
    this.config = config
    this.connection = connection
    this.projectRoot = config.projectRoot
    this.releaseEmbeddingModel = retainEmbeddingModel(config)
  }

  get isClosed(): boolean {
    return this.closed
  }

  static async create(options: RagmirClientOptions = {}): Promise<RagmirClient> {
    try {
      const config = await loadConfig(String(options.cwd ?? process.cwd()))
      return RagmirClient.createWithConfig(config)
    } catch (error) {
      throw normalizeRagmirError(error)
    }
  }

  static async createWithConfig(config: Config): Promise<RagmirClient> {
    try {
      const connection = await connectStore(config)
      return new RagmirClient(config, connection)
    } catch (error) {
      throw normalizeRagmirError(error)
    }
  }

  async ingest(options: Omit<IngestOptions, "cwd"> = {}): Promise<IngestResult> {
    return this.run(async () => {
      const result = await ingestWithConfig(this.config, options, this.connection)
      this.invalidateIndexSnapshot()
      return result
    })
  }

  async search(query: string, options: Omit<SearchOptions, "cwd"> = {}): Promise<SearchResult[]> {
    return this.run(async () => {
      const lease = await this.indexSnapshotForRead()
      try {
        return await searchWithConfig(
          query,
          options,
          this.config,
          this.connection,
          undefined,
          lease.snapshot,
        )
      } finally {
        lease.release()
      }
    })
  }

  async ask(query: string, options: Omit<SearchOptions, "cwd"> = {}): Promise<AskResult> {
    return this.run(async () => {
      const lease = await this.indexSnapshotForRead()
      try {
        return await askWithConfig(query, options, this.config, this.connection, lease.snapshot)
      } finally {
        lease.release()
      }
    })
  }

  async research(
    query: string,
    options: Omit<ResearchOptions, "cwd"> = {},
  ): Promise<ResearchReport> {
    return this.run(async () => {
      const lease = await this.indexSnapshotForRead()
      try {
        return await researchWithConfig(
          query,
          options,
          this.config,
          this.connection,
          lease.snapshot,
        )
      } finally {
        lease.release()
      }
    })
  }

  async expandCitation(
    citation: string,
    options: Omit<ExpandCitationOptions, "cwd"> = {},
  ): Promise<ExpandedCitation> {
    return this.run(async () => {
      const lease = await this.indexSnapshotForRead()
      try {
        return await expandCitationWithConfig(
          citation,
          options,
          this.config,
          this.connection,
          lease.snapshot,
        )
      } finally {
        lease.release()
      }
    })
  }

  async status(options: OperationOptions = {}): Promise<KnowledgeBaseContextReport> {
    return this.run(() => getKnowledgeBaseContextWithConfig(this.config, options))
  }

  async sources(
    options: KnowledgeBaseSourceCatalogOptions = {},
  ): Promise<KnowledgeBaseSourceCatalog> {
    return this.run(() => getKnowledgeBaseSourceCatalogWithConfig(this.config, options))
  }

  async close(): Promise<void> {
    if (!this.closePromise) {
      this.closed = true
      this.closePromise = (async () => {
        await Promise.allSettled([...this.activeOperations])
        try {
          await flushAccessLog(this.config)
        } finally {
          try {
            this.invalidateIndexSnapshot()
            for (const entry of this.retiredIndexSnapshots) {
              this.closeRetiredIndexSnapshot(entry)
            }
            closeStoreConnection(this.connection, this.config)
          } finally {
            await this.releaseEmbeddingModel()
          }
        }
      })()
    }
    await this.closePromise
  }

  private assertOpen(): void {
    if (this.closed || !this.connection.isOpen()) {
      throw new RagmirError("CLIENT_CLOSED", "Ragmir client is closed.")
    }
  }

  private async indexSnapshotForRead(): Promise<IndexSnapshotLease> {
    while (true) {
      const cached = this.indexSnapshot
      if (cached) {
        const current = await indexReadSnapshotCurrent(cached.snapshot, this.config)
        if (current && cached === this.indexSnapshot && !cached.retired) {
          return this.retainIndexSnapshot(cached)
        }
        if (cached === this.indexSnapshot) {
          this.retireIndexSnapshot(cached)
        }
        continue
      }

      if (!this.indexSnapshotLoad) {
        const epoch = this.indexSnapshotEpoch
        const load = (async () => {
          const snapshot = await loadIndexReadSnapshot(this.config, this.connection)
          const entry: IndexSnapshotEntry = { snapshot, references: 0, retired: false }
          if (this.indexSnapshotEpoch === epoch) {
            this.indexSnapshot = entry
          } else {
            this.retireIndexSnapshot(entry)
          }
          return entry
        })()
        this.indexSnapshotLoad = load
        void load.then(
          () => {
            if (this.indexSnapshotLoad === load) {
              this.indexSnapshotLoad = undefined
            }
          },
          () => {
            if (this.indexSnapshotLoad === load) {
              this.indexSnapshotLoad = undefined
            }
          },
        )
      }

      const loaded = await this.indexSnapshotLoad
      if (!loaded.retired) {
        return this.retainIndexSnapshot(loaded)
      }
    }
  }

  private invalidateIndexSnapshot(): void {
    this.indexSnapshotEpoch += 1
    if (this.indexSnapshot) {
      this.retireIndexSnapshot(this.indexSnapshot)
    }
  }

  private retainIndexSnapshot(entry: IndexSnapshotEntry): IndexSnapshotLease {
    entry.references += 1
    let released = false
    return {
      snapshot: entry.snapshot,
      release: () => {
        if (released) {
          return
        }
        released = true
        entry.references -= 1
        this.closeRetiredIndexSnapshot(entry)
      },
    }
  }

  private retireIndexSnapshot(entry: IndexSnapshotEntry): void {
    entry.retired = true
    if (this.indexSnapshot === entry) {
      this.indexSnapshot = undefined
    }
    this.retiredIndexSnapshots.add(entry)
    this.closeRetiredIndexSnapshot(entry)
  }

  private closeRetiredIndexSnapshot(entry: IndexSnapshotEntry): void {
    if (!entry.retired || entry.references > 0) {
      return
    }
    closeIndexReadSnapshot(entry.snapshot, this.config)
    this.retiredIndexSnapshots.delete(entry)
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
