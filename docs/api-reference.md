# TypeScript API

Install `@jcode.labs/ragmir` in a Node.js 22.12+ application. It publishes ESM and TypeScript declarations.
Import from the package root. Model synthesis belongs to your application or agent.

## Persistent client

```ts
import { createRagmirClient } from "@jcode.labs/ragmir"

const ragmir = await createRagmirClient({ cwd: process.cwd() })
try {
  await ragmir.ingest({ collectMetrics: true })
  const results = await ragmir.search("release approval", {
    topK: 3,
    maxChunksPerDocument: 1,
    includePaths: ["docs"],
    explain: true,
    signal: AbortSignal.timeout(10_000),
  })
  if (results[0]) {
    const citation = await ragmir.expandCitation(results[0].citation, {
      contextRadius: 1,
      expectedEvidenceId: results[0].evidence?.id,
    })
    console.log(citation)
  }
  console.log(await ragmir.status())
  console.log(await ragmir.sources())
} finally {
  await ragmir.close()
}
```

Use one client per project root in each long-running process. The client reuses a connection and
an immutable read snapshot, detects generation replacement, drains accepted operations at shutdown,
and releases storage and model resources. Always close it, including when an operation fails.

## LangChain.js retriever and agent tools

`@jcode.labs/ragmir/langchain` exports `RagmirRetriever`, a LangChain.js `BaseRetriever`, and
`RagmirToolkit`, the `ragmir_search` and `ragmir_expand` tools for LangChain and LangGraph agents.
Install the optional peer `@langchain/core` 1.x next to Ragmir:

```bash
npm install @jcode.labs/ragmir @langchain/core
```

```ts
import { createRagmirClient } from "@jcode.labs/ragmir"
import { RagmirRetriever } from "@jcode.labs/ragmir/langchain"

const ragmir = await createRagmirClient({ cwd: process.cwd() })
const retriever = new RagmirRetriever({ client: ragmir, topK: 3, includePaths: ["docs"] })
try {
  const documents = await retriever.invoke("release approval")
  for (const document of documents) {
    console.log(document.metadata.citation, document.pageContent)
  }
} finally {
  await ragmir.close()
}
```

Each document keeps its citation in `metadata`: `source`, `citation`, line or page ranges,
`contextPath`, `weakEvidence`, and `sourceStatus` when the file changed since indexing. A question
the sources cannot answer returns an empty array, so a chain can say so instead of answering from
unrelated text. The retriever accepts the same search options as `search` except `explain` and
`signal`. Pass `projectRoot` instead of `client` to let it open its own client, then call
`retriever.close()` during shutdown; it never closes a client you passed in.

For agentic RAG, give the agent tools instead of a fixed retrieval step. The agent decides what to
search, reads the passages it needs, and answers with its own model:

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
try {
  const result = await agent.invoke({
    messages: [{ role: "user", content: "Who approves a production release?" }],
  })
  console.log(result.messages.at(-1)?.content)
} finally {
  await ragmir.close()
}
```

`ragmir_search` answers the model with numbered citations and passage text, flags weak matches and
changed files, and says so when no passage supports an answer; its tool message `artifact` holds
the LangChain documents. The model may add `searches`, its own formulations of the question. `ragmir_expand` returns a citation with its neighbours and the next
citation to read on; its artifact is the `ExpandedCitation`. `new RagmirToolkit({ projectRoot })`
opens its own client instead: call `toolkit.close()` at shutdown.

## One-shot operations

```ts
import { compactSearchResults, ingest, search, expandCitation } from "@jcode.labs/ragmir"

await ingest({ cwd: "/path/to/project" })
const results = await search("release approval", { cwd: "/path/to/project", topK: 3 })
console.log(compactSearchResults(results))
if (results[0]) {
  console.log(await expandCitation(results[0].citation, { cwd: "/path/to/project" }))
}
```

`SearchOptions` includes `topK`, `maxChunksPerDocument`, `contextRadius`, `includePaths`,
`excludePaths`, `contextPaths`, `scope` (a named scope from the config), `explain`,
`vectorSearchMode: "exact"` for ANN comparisons, and `retriever: "lexical" | "vector"` to rank
with one channel for diagnostics (default `"hybrid"`). `includePaths` and `excludePaths` take folders,
files, or globs (`**` crosses folders, `*` and `?` stay within one, `{a,b}` lists alternatives), so
`["**/*.pdf"]` searches only PDF files. Path filters accept backslashes and either Unicode form;
results always use forward slashes and NFC.

`searches` adds up to five formulations of the same need, fused with the question into one
ranking. Each one searches the channel that suits it:

```ts
const results = await ragmir.search("How are API requests throttled?", {
  searches: [
    { type: "lex", query: '"rate limit" quota -deprecated' },
    { type: "vec", query: "limits on how many calls a client may send" },
    { type: "hyde", query: "Each API key may send 600 requests per minute." },
  ],
  explain: true,
})
```

A `lex` search ranks by its words, keeps only passages holding each `"quoted phrase"`, and removes
every passage holding a `-word` or `-"phrase"`, including passages the question found. `vec`
adds a paraphrase and `hyde` a short passage written as the answer might be; Ragmir searches their
words. Each formulation weighs half as much as the question's own lists (`hyde` a quarter), and
evidence rules judge every passage against the question: with a semantic model, a passage that
only formulations found is measured by its distance to the question. Only the question decides
whether there is an answer, so formulations never turn a refusal into one. With
`explain: true`, `score.formulations` lists the formulations that found a result (`lex#1`,
`vec#1`, ...) with its rank and its share of the fused score. An invalid formulation throws
`INVALID_ARGUMENT` with a message naming the field, such as
`searches[0].query leaves a quote open: close every "phrase".`

`expandCitation` returns the cited chunk and its neighbours, `documentChunks` (the chunk count of the
cited document), and `nextCitation` / `previousCitation`: expand them with the same `contextRadius`
to read the neighbouring windows of a long document. `client.sources({ paths, offset, limit })`
lists indexed files under folders or matching globs, with chunk counts, the `title` and
`description` of a Markdown page's front matter, `page.nextOffset`, and the number of matching
files in `filter.matchedFiles`; with `outline: true` and paths matching one file, it adds that
file's outline, each heading path with the citation of its first passage. For a Markdown page,
`expandCitation` also returns `links` (`DocumentLinks`): the links the page writes, with the
indexed file each reaches or `null` when broken, and the pages that link to it with the citation of
the linking passage.
`searchReport(query, options)` and `client.searchReport(...)` return `{ results, absentTerms }`:
the same results, plus the words of the question that no indexed passage holds, so an application
can tell "the documents never mention this" from "nothing ranked well". Results carry
`pathContext` when the configuration describes their folder (`pathContexts` or a scope
description). `compactSearchResults(results, maxLength, { query, intent })` builds bounded
snippets from the lines that hold the question's words, with `excerptLine` for line-aware sources;
`intent`, a few words on what the question is about, weighs less than the question's own words.
Use `CompactSearchResult` for bounded snippets or `SearchResult` for text and neighboring context.
Score explanations describe retrieval signals, not calibrated confidence in a claim.

Queries preserve their full constraints up to 20,000 UTF-16 code units. Whitespace is normalized;
oversized input throws `INVALID_ARGUMENT` instead of silently discarding its beginning.
With `explain: true`, `retrievalQuery`, `queryNormalized`, and `originalQueryLength` show this
preparation. Exact compound identifiers such as `ERR_INVOICE_409` or `invoices.validateDraft`
take precedence over less specific candidates. A non-empty result is still not proof that every
requested condition is documented; expand the evidence and check exceptions and missing facts.

Search results include `evidence`: a content ID, source checksum, index generation, indexing time,
and knowledge-base ID when available. Pass `evidence.id` as `expectedEvidenceId` to
`expandCitation` to reject changed indexed content with `EVIDENCE_CHANGED`. The ID stays stable
when unchanged evidence is rebuilt and changes when its source checksum or chunk identity changes.
It identifies indexed evidence, not the current file on disk. Each result whose file changed or
disappeared since indexing also carries `sourceStatus: "modified"` or `"missing"`, from one `stat`
per cited file; `doctor` checks the whole corpus by size and modification time, and `audit` by
checksum. `weakEvidence: true` marks a passage with few of the question's distinctive words and
no strong vector match; a search whose first five results are all weak returns an empty list
instead, with any provider. Compact results retain these fields.

For XLSX tables, full results attach the header as a separate `context` passage with its own cell
citation, including at `contextRadius: 0`. Expansion also includes it; compact search requires
expansion to read this context. Detection uses the first row containing at least two populated
text cells after a blank row or sheet boundary. Headers larger than one chunk are not propagated.
Check complex or multi-level tables in `preview`; Ragmir does not infer their semantics.

`charStart` and `charEnd` address the parsed indexed text. For source-preserving text, passages map
to the original character range and real lines. Extracted binary documents use native page, slide,
sheet/cell, EPUB, or named section coordinates. They are not byte offsets into a binary file.

## Indexing and diagnostics

| Export | Purpose |
| --- | --- |
| `initProject(cwd?)`, `setupProject(options?)` | Initialize config and optional agent helpers. |
| `loadConfig(cwd?)` | Resolve the nearest project config with validated limits. |
| `ingest(options?)` | Incrementally parse and index selected files; `rebuild` stages a replacement. |
| `previewChunks(options?)` | Inspect parsed chunks without writing the index. |
| `audit(cwd?, options?)` | Compare live supported sources with indexed files; report `sourceRules` and index `concentration`. |
| `doctor(cwd?, options?)` | Compare files with the index by size and mtime (`sourceFreshness`); use `deep: true` for checksums and security diagnostics. |
| `getKnowledgeBaseContext(cwd?, options?)` | Read base identity, readiness, and coverage. |
| `getKnowledgeBaseSourceCatalog(cwd?, options?)` | Read bounded source lists and complete totals. |
| `discoverKnowledgeBases(...)` | Discover root and nested project bases. |
| `securityAudit(cwd?, options?)` | Inspect permissions, Git exclusions, providers, and extractor authority. |
| `inspectUpgrade(cwd?)`, `upgradeProject(options?)` | Inspect compatibility or migrate and rebuild safely. |
| `evaluateGoldenQueries(options)` | Measure retrieval against an explicit golden-query file; `baselinePath` adds signed deltas against an earlier report and `retriever` evaluates one channel. |
| `destroyIndex(cwd?)` | Explicitly remove managed local index storage. |

The options and result types are exported, including `Config`, `IngestOptions`, `IngestResult`,
`SearchOptions`, `SearchFormulation`, `SearchResult`, `EvidenceVersion`, `ExpandedCitation`,
`AuditReport`, `DoctorReport`, and `UpgradeInspection` / `UpgradeResult`. See the published
declarations for the complete surface.

Ingestion commits bounded progress and resumes compatible interrupted runs. The default
`incrementalFailurePolicy: "preserve-last-good"` reports failed changed files as stale while keeping
their previous rows. `remove-stale` is an explicit alternative. Source deletion removes its rows.
Rebuild activation validates counts, checksums, and duplicate IDs before replacing the manifest.

`collectMetrics: true` adds local phase timings, throughput, bounded failure counters, and OCR cache
metrics. The `ragmir:ingestion` diagnostics channel publishes the same metadata when subscribed;
it excludes paths, source text, and queries. No telemetry is transmitted.

## Cancellation and concurrency

Operations accepting `OperationOptions` support `signal` and `timeoutMs`. The library returns
values or throws errors; it does not write to stdout/stderr. Use `isRagmirError(error)` to inspect
structured codes such as `TIMEOUT`, `OVERLOADED`, `INDEX_BUSY`, `INDEX_UNAVAILABLE`, and `CLIENT_CLOSED`.
A config that still holds retired fields throws `CONFIG_MIGRATION_REQUIRED`: run `rgr upgrade` to
back it up, migrate it, and rebuild the index.

Per-project process-local queues bound search, embeddings, and ingestion. A private writer lock
serializes index writers across local OS processes. Readers keep generation leases through their
operation; neither lock nor leases provide distributed coordination across machines.

## Semantic embeddings and OCR

`local-hash` requires no model runtime. Install optional `@huggingface/transformers` before selecting
`transformers`. `pullEmbeddingModel(config)` explicitly preloads the configured model;
`enableSemanticEmbeddings(cwd?)` persists the semantic configuration. Provider, model revision,
artifact digest, extraction, and chunking changes require a compatible rebuild.

`inspectPdfOcr`, `configurePdfOcr`, `extractPdfPage`, and `extractPdfPages` expose the local OCR
onboarding and extraction workflow; `rgr ocr setup --images --legacy-word` configures the built-in
image and legacy `.doc` extractors. PDF OCR runs only for blank extracted pages. External commands
use argument arrays without a shell, bounded output, timeouts, and the operator's permissions.
See [configuration](./configuration.md) for command contracts and caching.

`disposeTransformersModel` and `disposeTransformersCache` support explicit runtime cleanup.
Client ownership normally manages this lifecycle; active inference leases finish before disposal.

## MCP host

`createMcpServer(cwd?)` returns a server handle. `connectMcpServer(transport, cwd?)` connects it to an
SDK transport and returns the handle for shutdown. `serveMcp(cwd?)` runs the stdio transport.
Close the server when the host stops; it closes its lazy client too.

The server exposes six tools: `ragmir_status`, `ragmir_search`, `ragmir_expand`, `ragmir_sources`,
`ragmir_audit`, and `ragmir_ingest`; the `answer` prompt; and two resources: `ragmir://context`,
`ragmir://sources`. Search defaults to three compact results, accepts up to five `queries` sharing
one budget, remembers the passages it already returned in the connection (`seen` stubs), and
applies named `scope`s. `ragmir_ingest` refreshes the index incrementally, shares one run with the
`mcpAutoIngest` refresh, and refuses while `mcpIngest` is `false` or a security warning stands. The
server instructions and tool descriptions name the base; the server compares the client's MCP roots
(or `CLAUDE_PROJECT_DIR`, or the recorded launch directory) with the base and warns, or refuses with
`mcpAllowedRoots`, when the workspace is unrelated.
Search, expansion, sources, and audit accept `maxBytes`, capped by configuration and the 1 MiB
server limit.
`ragmir_expand` accepts `expectedEvidenceId` from a previous `ragmir_search` result for the same
checked expansion used by the TypeScript API.
`_meta["ragmir/output"]` reports compaction and truncation. Typed summaries preserve identifiers
and required scalar values when a complete payload does not fit.

A custom network-facing host owns authentication, authorization, transport security, and rate
limits. Ragmir has no built-in HTTP listener. The [integration guide](./agent-integration.md)
shows how to pass retrieved evidence to a local model without adding a chat runtime to Ragmir.
