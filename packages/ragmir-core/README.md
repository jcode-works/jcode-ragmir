# @jcode.labs/ragmir

[![npm version](https://img.shields.io/npm/v/@jcode.labs/ragmir)](https://www.npmjs.com/package/@jcode.labs/ragmir)
[![npm downloads](https://img.shields.io/npm/dm/@jcode.labs/ragmir)](https://www.npmjs.com/package/@jcode.labs/ragmir)
[![Node.js](https://img.shields.io/node/v/@jcode.labs/ragmir)](https://www.npmjs.com/package/@jcode.labs/ragmir)
[![MIT](https://img.shields.io/npm/l/@jcode.labs/ragmir)](https://github.com/jcode-works/jcode-ragmir/blob/main/LICENSE)

Confidential local RAG for coding agents and Node.js applications. Core indexes the project files
you choose and retrieves bounded, cited evidence offline by default. It uploads no corpus, calls no
LLM, and opens no HTTP port.

[Project overview](https://github.com/jcode-works/jcode-ragmir#readme) ·
[CLI](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/cli-reference.md) ·
[API](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/api-reference.md) ·
[Agent integration](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/agent-integration.md)

## Install and retrieve

Requires Node.js 22 or later.

```bash
npm install --save-dev @jcode.labs/ragmir
npx rgr setup --agents codex,claude,kimi,opencode,cline
npx rgr sources add "README.md" "docs/**/*.md"
npx rgr ingest
npx rgr search "Which decision changed the rollout?"
```

Generated configuration, indexes, helpers, reports, and metadata-only logs stay under ignored
`.ragmir/` state. Ingestion is incremental, resumable, bounded by source, chunk, vector, file, batch,
and concurrency windows, and serialized across local writer processes.

## Choose an interface

| Interface | Use it for |
| --- | --- |
| `rgr` CLI | Setup, ingest, search, audit, maintenance, and JSON automation |
| TypeScript API | Typed retrieval in scripts and long-running Node.js workers |
| Local stdio MCP | Bounded, read-focused context for compatible agents |

The default `local-hash` provider works offline with no model download. Enable semantic
Transformers.js embeddings explicitly with `rgr setup --semantic`, then rebuild. Core remains
retrieval-only in both modes. Use `explain: true` or `--explain` to inspect lexical and vector
contributions, fallback decisions, budgets, queue wait, and the active ranking policy.

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

  for (const result of results) console.log(result.citation, result.text)
} finally {
  await ragmir.close()
}
```

Reuse one client per project root in a long-running process. It owns the local connection, read
snapshot, active operation lifecycle, metadata-only log flush, and optional embedding-model lease.
Top-level `ingest`, `search`, `ask`, and `research` functions remain available for one-shot scripts.
`ask` returns cited context, not generated prose.

## Guarantees and boundaries

- Citations use source lines only for line-preserving text, plus PDF pages, PPTX slides, XLSX
  sheets and cells, and EPUB spine positions.
- Rebuilds activate only after row and manifest validation. Interrupted rebuilds leave the previous
  searchable generation active.
- Exact vector search remains the policy below 100,000 rows. Larger tables use quality-gated IVF-PQ
  with complete coverage and an exact diagnostic mode.
- Search, embedding, and ingestion use independent bounded queues. Overload and queue deadlines are
  stable retryable errors.
- Optional OCR processes only blank PDF pages through a configured local executable and private
  resumable cache.
- `rgr status` and normal `rgr doctor` read compact manifest health. Use `rgr doctor --deep` or
  `rgr audit` for a live source inventory.
- `rgr security-audit` checks permissions, Git ignore coverage, tracked private paths, redaction,
  and local extractor authority.
- `rgr team snapshot` and `rgr team compare` explain configuration and per-file drift without
  sharing source text or guessing which copy is authoritative.
- After a package update, `rgr upgrade --check` previews compatibility; `rgr upgrade` safely stages
  any required rebuild without deleting the active index first. Privacy warnings remain visible as
  non-blocking advisories and can be handled separately with `rgr security-audit`.

The [CLI reference](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/cli-reference.md),
[API reference](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/api-reference.md), and
[configuration guide](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/configuration.md)
hold the complete options and operational detail.

## Optional packages

- [`@jcode.labs/ragmir-chat`](https://www.npmjs.com/package/@jcode.labs/ragmir-chat) adds cited
  answer generation with a verified local GGUF profile.
- [`@jcode.labs/ragmir-tts`](https://www.npmjs.com/package/@jcode.labs/ragmir-tts) renders reviewed
  text as local audio or explicit online speech.

Core installs and starts without either add-on. A hosted agent receives only passages your
integration sends under that provider's data policy; use a local consumer when no passage may leave
the workstation. Teams synchronize their source folder and tracked configuration, then build one
local index per developer. Exchange an authorized metadata-only snapshot and run `rgr team compare`
to resolve exact drift. See the [team workflow](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/agent-integration.md#team-knowledge-bases).

Ragmir Core is open source under the [MIT License](https://github.com/jcode-works/jcode-ragmir/blob/main/LICENSE).
