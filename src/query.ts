import { Ollama } from "ollama"
import { recordAccess } from "./access-log.js"
import { loadConfig } from "./config.js"
import { embedText } from "./embeddings.js"
import { assertNetworkPolicy } from "./network.js"
import { openRowsTable } from "./store.js"
import type { AskResult, SearchOptions, SearchResult } from "./types.js"

interface SearchRow {
  source: string
  relativePath: string
  chunkIndex: number
  text: string
  _distance?: number
}

export async function search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
  const config = await loadConfig(String(options.cwd ?? process.cwd()))
  const table = await openRowsTable(config)
  if (!table) {
    return []
  }

  const vector = await embedText(query, config)
  const rows = (await table
    .vectorSearch(vector)
    .limit(options.topK ?? config.topK)
    .toArray()) as SearchRow[]

  const results = rows.map((row) => ({
    source: row.source,
    relativePath: row.relativePath,
    chunkIndex: row.chunkIndex,
    text: row.text,
    distance: typeof row._distance === "number" ? row._distance : null,
  }))
  await recordAccess(config, {
    action: "search",
    query,
    topK: options.topK ?? config.topK,
    resultCount: results.length,
  })
  return results
}

export async function ask(query: string, options: SearchOptions = {}): Promise<AskResult> {
  const config = await loadConfig(String(options.cwd ?? process.cwd()))
  const sources = await search(query, options)

  if (sources.length === 0) {
    return {
      answer: "No relevant passages were found. Add documents and run `kb ingest` first.",
      sources,
    }
  }

  const context = sources
    .map(
      (source, index) =>
        `[${index + 1}] ${source.relativePath}#${source.chunkIndex}\n${source.text}`,
    )
    .join("\n\n---\n\n")

  assertNetworkPolicy(config)
  const client = new Ollama({ host: config.ollamaHost })
  const response = await client.chat({
    model: config.llmModel,
    messages: [
      {
        role: "system",
        content:
          "Answer only from the provided context. If the context is insufficient, say what is missing. Cite sources with [1], [2], etc.",
      },
      {
        role: "user",
        content: `Question:\n${query}\n\nContext:\n${context}`,
      },
    ],
    stream: false,
  })

  await recordAccess(config, {
    action: "ask",
    query,
    topK: options.topK ?? config.topK,
    resultCount: sources.length,
  })

  return {
    answer: response.message.content,
    sources,
  }
}
