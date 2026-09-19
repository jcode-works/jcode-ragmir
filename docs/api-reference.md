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
`excludePaths`, `contextPaths`, `explain`, and `vectorSearchMode: "exact"` for ANN comparisons.
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
It identifies indexed evidence, not the current file on disk; use `audit` or `doctor --deep` to
check source freshness. Compact results retain this identity.

For XLSX tables, full results attach the header as a separate `context` passage with its own cell
citation, including at `contextRadius: 0`. Expansion also includes it; compact search requires
expansion to read this context. Detection uses the first row containing at least two populated
text cells after a blank row or sheet boundary. Headers larger than one chunk are not propagated.
Check complex or multi-level tables in `preview`; Ragmir does not infer their semantics.

`charStart` and `charEnd` address the parsed indexed text. For source-preserving text, passages map
to the original character range and real lines. Extracted binary documents use native page, slide,
sheet/cell, or EPUB coordinates. They are not byte offsets into a binary file.

## Indexing and diagnostics

| Export | Purpose |
| --- | --- |
| `initProject(cwd?)`, `setupProject(options?)` | Initialize config and optional agent helpers. |
| `loadConfig(cwd?)` | Resolve the nearest project config with validated limits. |
| `ingest(options?)` | Incrementally parse and index selected files; `rebuild` stages a replacement. |
| `previewChunks(options?)` | Inspect parsed chunks without writing the index. |
| `audit(cwd?, options?)` | Compare live supported sources with indexed files. |
| `doctor(cwd?, options?)` | Read cached health; use `deep: true` for live inventory and diagnostics. |
| `getKnowledgeBaseContext(cwd?, options?)` | Read base identity, readiness, and coverage. |
| `getKnowledgeBaseSourceCatalog(cwd?, options?)` | Read bounded source lists and complete totals. |
| `discoverKnowledgeBases(...)` | Discover root and nested project bases. |
| `securityAudit(cwd?, options?)` | Inspect permissions, Git exclusions, providers, and extractor authority. |
| `inspectUpgrade(cwd?)`, `upgradeProject(options?)` | Inspect compatibility or migrate and rebuild safely. |
| `evaluateGoldenQueries(options)` | Measure retrieval against an explicit golden-query file. |
| `destroyIndex(cwd?)` | Explicitly remove managed local index storage. |

The options and result types are exported, including `Config`, `IngestOptions`, `IngestResult`,
`SearchOptions`, `SearchResult`, `EvidenceVersion`, `ExpandedCitation`, `AuditReport`, `DoctorReport`, and
`UpgradeInspection` / `UpgradeResult`. See the published declarations for the complete surface.

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

Per-project process-local queues bound search, embeddings, and ingestion. A private writer lock
serializes index writers across local OS processes. Readers keep generation leases through their
operation; neither lock nor leases provide distributed coordination across machines.

## Semantic embeddings and OCR

`local-hash` requires no model runtime. Install optional `@huggingface/transformers` before selecting
`transformers`. `pullEmbeddingModel(config)` explicitly preloads the configured model;
`enableSemanticEmbeddings(cwd?)` persists the semantic configuration. Provider, model revision,
artifact digest, extraction, and chunking changes require a compatible rebuild.

`inspectPdfOcr`, `configurePdfOcr`, `extractPdfPage`, and `extractPdfPages` expose the local OCR
onboarding and extraction workflow. PDF OCR runs only for blank extracted pages. External commands
use argument arrays without a shell, bounded output, timeouts, and the operator's permissions.
See [configuration](./configuration.md) for command contracts and caching.

`disposeTransformersModel` and `disposeTransformersCache` support explicit runtime cleanup.
Client ownership normally manages this lifecycle; active inference leases finish before disposal.

## MCP host

`createMcpServer(cwd?)` returns a server handle. `connectMcpServer(transport, cwd?)` connects it to an
SDK transport and returns the handle for shutdown. `serveMcp(cwd?)` runs the stdio transport.
Close the server when the host stops; it closes its lazy client too.

The server exposes four tools: `ragmir_status`, `ragmir_search`, `ragmir_expand`, `ragmir_audit`,
and two resources: `ragmir://context`, `ragmir://sources`. Search defaults to three compact results.
Search, expansion, and audit accept `maxBytes`, capped by configuration and the 1 MiB server limit.
`ragmir_expand` accepts `expectedEvidenceId` from a previous `ragmir_search` result for the same
checked expansion used by the TypeScript API.
`_meta["ragmir/output"]` reports compaction and truncation. Typed summaries preserve identifiers
and required scalar values when a complete payload does not fit.

A custom network-facing host owns authentication, authorization, transport security, and rate
limits. Ragmir has no built-in HTTP listener. The [integration guide](./agent-integration.md)
shows how to pass retrieved evidence to a local model without adding a chat runtime to Ragmir.
