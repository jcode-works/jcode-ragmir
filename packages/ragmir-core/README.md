# @jcode.labs/ragmir

[![npm version](https://img.shields.io/npm/v/@jcode.labs/ragmir)](https://www.npmjs.com/package/@jcode.labs/ragmir)
[![npm downloads](https://img.shields.io/npm/dm/@jcode.labs/ragmir)](https://www.npmjs.com/package/@jcode.labs/ragmir)
[![Node.js](https://img.shields.io/node/v/@jcode.labs/ragmir)](https://www.npmjs.com/package/@jcode.labs/ragmir)
[![MIT](https://img.shields.io/npm/l/@jcode.labs/ragmir)](https://github.com/jcode-works/jcode-ragmir/blob/main/LICENSE)

Confidential local RAG for coding agents and Node.js applications.

*Stop sending confidential documents directly to the cloud.*

Core indexes the project files you select and retrieves bounded, cited evidence offline by default.
It does not upload the corpus, call an LLM, or open an HTTP port.

[Project overview](https://github.com/jcode-works/jcode-ragmir#readme) ·
[CLI reference](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/cli-reference.md) ·
[API reference](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/api-reference.md) ·
[Agent integration](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/agent-integration.md)

## Install and retrieve

Requires Node.js 22 or later. Releases are gated on Linux x64 and macOS ARM64 with Node.js 22.

```bash
npm install --save-dev @jcode.labs/ragmir
npx rgr setup --agents codex,claude,kimi,opencode,cline
npx rgr sources add "README.md" "docs/**/*.md"
npx rgr ingest
npx rgr search "Which decision changed the rollout?"
```

Setup keeps configuration, the index, helpers, reports, and metadata-only access logs under ignored
`.ragmir/` state. Ingestion is incremental, resumable, and serialized across local writer
processes. Source, chunk, vector, concurrency, and batch windows are bounded, with durable progress
committed per file. Completed ingestion refreshes incomplete full-text coverage and runs bounded
LanceDB maintenance when mutation or fragment thresholds are reached. Sidecar replacement flushes
before rename, synchronizes the storage directory where supported, and retains one validated
activation manifest for explicit recovery diagnostics. Inspect maintenance with
`npx rgr storage optimize --dry-run --json`. Exact vector search is retained below 100,000 rows;
larger tables use a benchmarked IVF-PQ policy only with complete coverage. Use
`npx rgr search "query" --exact-vector-search` to bypass ANN for diagnostics. Rebuild generations
use private reader leases and
bounded retention; inspect them with `npx rgr storage generations --json` before running
`npx rgr storage gc --dry-run --json`. Failed changed files keep explicitly stale
last-known-good rows by default; repair or source deletion reconciles them deterministically.
Returned citations expose only verifiable coordinates: source lines for line-preserving text, PDF
pages, PPTX slides, XLSX sheets and cells, and EPUB spine positions.
Run `npx rgr audit --unsupported` to compare the selected files with the index and see what was
skipped.
Custom redaction expressions are screened for catastrophic backtracking. `npx rgr security-audit`
also reports permissions, ignored/tracked state for every private path, and local extractor
authority.
`npx rgr status` and normal `npx rgr doctor` consume compact manifest health without opening chunk
storage. Use `npx rgr doctor --deep` or `npx rgr audit` for explicit O(corpus) live diagnostics.

## Choose an interface

| Interface | Use |
| --- | --- |
| `rgr` CLI | Setup, ingest, search, audit, and JSON automation |
| TypeScript API | Typed retrieval in a script or stateful Node.js worker |
| Local stdio MCP | Bounded context for compatible coding agents |

The default `local-hash` provider needs no model download. It is lexical/hash retrieval, not
semantic embeddings. Enable local Transformers.js embeddings explicitly with `rgr setup --semantic`
and rebuild the index. Bundled profiles use pinned model commits, and setup stores the resolved
artifact digest so persisted compatibility identifies the exact weights. `local-hash` does not
resolve Transformers.js, ONNX Runtime, or Sharp.

Hybrid retrieval has stable source-and-chunk tie-breaks, two-pass recall-safe diversification, and
provider-aware abstention. Pass `explain: true` to inspect vector and lexical contributions, FTS or
fallback activation and reason, candidate and coverage budgets, plus the active ranking-policy
fingerprint. Search, embedding, and ingestion use independent bounded queues per project root;
overload and queue deadlines return stable retryable errors, and explained searches include queue
wait.
An empty result means every candidate failed the evidence threshold.

`research` uses language-aware query expansion with deterministic cross-query ranking. It reads
manifest health by default and exposes explicit timeout, code-file, code-byte, concurrency, and
result budgets. Request `fullAudit: true` only when the report also needs a fresh source inventory.

## TypeScript API

```ts
import { createRagmirClient } from "@jcode.labs/ragmir"

const ragmir = await createRagmirClient({ cwd: process.cwd() })
try {
  await ragmir.ingest({ timeoutMs: 120_000 })
  const results = await ragmir.search("Which decision changed the rollout?", {
    topK: 5,
    timeoutMs: 10_000,
  })

  for (const result of results) {
    console.log(result.citation, result.text)
  }
} finally {
  await ragmir.close()
}
```

Reuse one client per project root in long-running processes. It caches one immutable read snapshot
until atomic generation replacement, closes retired table handles after their last active reader,
and `close()` flushes metadata-only access logs before releasing model ownership. The final owner
disposes its Transformers pipeline only after active inference finishes. Top-level
`ingest`, `search`, `ask`, and `research` functions remain available for one-shot scripts. `ask`
returns cited retrieval context, not a generated answer.

Core also exports setup, preview, audit, evaluation, source-routing, privacy, OCR, MCP, and agent
integration helpers. See the [complete API reference](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/api-reference.md)
for public options and result types.

Optional PDF OCR processes only blank pages. The generated setup batches bounded page groups and
stores private content-addressed page results, so interrupted scans resume only missing pages and
warm output remains identical without launching OCR subprocesses.

## Optional packages and boundaries

- [`@jcode.labs/ragmir-chat`](https://www.npmjs.com/package/@jcode.labs/ragmir-chat) adds local GGUF
  answer generation from retrieved passages.
- [`@jcode.labs/ragmir-tts`](https://www.npmjs.com/package/@jcode.labs/ragmir-tts) renders reviewed
  text as local audio or explicit online speech.

Core installs and starts without either add-on. A hosted agent receives only the passages your
integration gives it, under that provider's data policy. Use a local consumer when no passage may
leave the workstation. Ragmir has no hosted storage or cloud-sync layer; teams synchronize source
files separately and build one local index per developer. Keep shared directory or glob contracts
stable, align the Ragmir version, configuration, embedding provider, and model, then compare
`corpusFingerprint` from `rgr status --json` after both indexes are ready with no missing or stale
files. Matching values identify the same indexed relative paths and source bytes. Use
`sourceFingerprintMode: "strict"` when a synchronization tool can preserve metadata while replacing
content, and never share an actively written `.ragmir/storage/` directory. Older manifests expose a
`null` fingerprint until the next successful ingestion.

Read the [configuration guide](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/configuration.md),
[security hardening guide](https://github.com/jcode-works/jcode-ragmir/blob/main/SECURITY-HARDENING.md),
and [troubleshooting guide](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/troubleshooting.md)
before indexing sensitive material.

Ragmir Core is open source under the [MIT License](https://github.com/jcode-works/jcode-ragmir/blob/main/LICENSE).
