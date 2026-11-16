# Ragmir in TypeScript

`@jcode.labs/ragmir` publishes ESM with TypeScript declarations for Node.js 22.12+. Import from the
package root; the LangChain.js integration lives in `@jcode.labs/ragmir/langchain`.

## Persistent client

```ts
import { createRagmirClient, isRagmirError } from "@jcode.labs/ragmir"

const ragmir = await createRagmirClient({ cwd: "/srv/handbook" })
try {
  const results = await ragmir.search("release approval", {
    topK: 5,
    includePaths: ["docs", "**/*.pdf"],
    excludePaths: ["docs/archive"],
    maxChunksPerDocument: 1,
    timeoutMs: 5_000,
  })
  for (const result of results) {
    console.log(result.citation, result.weakEvidence ?? false, result.sourceStatus ?? "current")
  }
} catch (error) {
  if (isRagmirError(error) && error.retryable) {
    // OVERLOADED, TIMEOUT, or INDEX_BUSY: retry later with backoff.
  }
  throw error
} finally {
  await ragmir.close()
}
```

- `search` options: `topK` (up to 100), `includePaths` and `excludePaths` (folders, files, or
  globs where `**` crosses folders and `{a,b}` lists alternatives), `scope` (a named scope from
  the configuration), `contextPaths`, `maxChunksPerDocument`, `contextRadius` (up to 3 neighbour
  chunks), `explain`, `signal`, and `timeoutMs`.
- A `SearchResult` holds `citation`, `relativePath`, `text`, `contextPath`, line or page ranges,
  `context` (neighbour passages), `evidence` (content identity), `weakEvidence`, and
  `sourceStatus`.
- Errors carry structured codes: `TIMEOUT`, `OVERLOADED`, `INDEX_BUSY`, `INDEX_UNAVAILABLE`,
  `CLIENT_CLOSED`, and `CONFIG_MIGRATION_REQUIRED` (run `rgr upgrade`). The library never writes to
  stdout or stderr.

## Expand a citation and read a document through

```ts
const [first] = await ragmir.search("data retention period", { topK: 1 })
if (first) {
  let window = await ragmir.expandCitation(first.citation, {
    contextRadius: 1,
    expectedEvidenceId: first.evidence?.id, // rejects changed content with EVIDENCE_CHANGED
  })
  const pages = [window]
  while (window.nextCitation) {
    window = await ragmir.expandCitation(window.nextCitation, { contextRadius: 1 })
    pages.push(window)
  }
}
```

`expandCitation` returns `found`, `passages`, `documentChunks`, and `previousCitation` and
`nextCitation` for the neighbouring windows. `ragmir.sources({ paths: ["**/*.pdf"], offset, limit })`
lists indexed files with chunk counts, and `ragmir.status()` reports identity, readiness, and
freshness.

## Index from code

```ts
const report = await ragmir.ingest({
  onProgress: (progress) => console.log(progress),
  timeoutMs: 600_000,
})
console.log(report)
```

Ingestion is incremental and resumable; the previous index stays searchable until the new one
passes validation. One writer runs at a time per machine; a concurrent writer gets the retryable
`INDEX_BUSY`.

## LangChain.js retriever

```ts
import { createRagmirClient } from "@jcode.labs/ragmir"
import { RagmirRetriever } from "@jcode.labs/ragmir/langchain"

const ragmir = await createRagmirClient({ cwd: process.cwd() })
const retriever = new RagmirRetriever({ client: ragmir, topK: 4, includePaths: ["docs"] })
const documents = await retriever.invoke("Who approves a production release?")
for (const document of documents) {
  console.log(document.metadata.citation, document.pageContent)
}
```

Document metadata holds `source`, `citation`, line or page ranges, `contextPath`, `weakEvidence`,
and `sourceStatus`. The retriever returns an empty array when the sources hold no evidence, so a
chain can say so. It accepts the search options except `explain` and `signal`. With `projectRoot`
instead of `client`, it opens its own client: call `retriever.close()` at shutdown.

## LangChain.js and LangGraph.js agents

```ts
import { createAgent } from "langchain"
import { createRagmirClient } from "@jcode.labs/ragmir"
import { createRagmirTools } from "@jcode.labs/ragmir/langchain"

const ragmir = await createRagmirClient({ cwd: process.cwd() })
const agent = createAgent({
  model: "anthropic:claude-sonnet-5-5",
  tools: createRagmirTools({ client: ragmir, topK: 4 }),
  systemPrompt: "Answer from the project documents and cite each claim with its citation.",
})
const result = await agent.invoke({
  messages: [{ role: "user", content: "Who approves a production release?" }],
})
```

`ragmir_search` answers the model with numbered citations and passage text, flags weak matches and
changed files, and says so when nothing supports an answer; the tool message artifact holds the
LangChain documents. `ragmir_expand` reads one citation with its neighbours and the next citation
to read on. `new RagmirToolkit({ projectRoot })` opens its own client: call `toolkit.close()` at
shutdown.

## Host the MCP server

`serveMcp(cwd)` runs the stdio server, `createMcpServer(cwd)` returns a handle, and
`connectMcpServer(transport, cwd)` connects it to an MCP SDK transport. Close the handle when the
host stops. A network-facing host owns authentication, authorization, TLS, and rate limits.

Reference: https://github.com/jcode-works/ragmir/blob/main/docs/api-reference.md
