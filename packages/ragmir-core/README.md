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

Requires Node.js 20 or later.

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
committed per file. Failed changed files keep explicitly stale last-known-good rows by default; repair or
source deletion reconciles them deterministically.
Returned citations expose only verifiable coordinates: source lines for line-preserving text, PDF
pages, PPTX slides, XLSX sheets and cells, and EPUB spine positions.
Run `npx rgr audit --unsupported` to compare the selected files with the index and see what was
skipped.

## Choose an interface

| Interface | Use |
| --- | --- |
| `rgr` CLI | Setup, ingest, search, audit, and JSON automation |
| TypeScript API | Typed retrieval in a script or stateful Node.js worker |
| Local stdio MCP | Bounded context for compatible coding agents |

The default `local-hash` provider needs no model download. It is lexical/hash retrieval, not
semantic embeddings. Enable local Transformers.js embeddings explicitly with `rgr setup --semantic`
and rebuild the index.

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

Reuse one client per project root in long-running processes and close it during shutdown. Top-level
`ingest`, `search`, `ask`, and `research` functions remain available for one-shot scripts. `ask`
returns cited retrieval context, not a generated answer.

Core also exports setup, preview, audit, evaluation, source-routing, privacy, OCR, MCP, and agent
integration helpers. See the [complete API reference](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/api-reference.md)
for public options and result types.

## Optional packages and boundaries

- [`@jcode.labs/ragmir-chat`](https://www.npmjs.com/package/@jcode.labs/ragmir-chat) adds local GGUF
  answer generation from retrieved passages.
- [`@jcode.labs/ragmir-tts`](https://www.npmjs.com/package/@jcode.labs/ragmir-tts) renders reviewed
  text as local audio or explicit online speech.

Core installs and starts without either add-on. A hosted agent receives only the passages your
integration gives it, under that provider's data policy. Use a local consumer when no passage may
leave the workstation. Ragmir has no hosted storage or cloud-sync layer; teams synchronize source
files separately and build one local index per developer.

Read the [configuration guide](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/configuration.md),
[security hardening guide](https://github.com/jcode-works/jcode-ragmir/blob/main/SECURITY-HARDENING.md),
and [troubleshooting guide](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/troubleshooting.md)
before indexing sensitive material.

Ragmir Core is open source under the [MIT License](https://github.com/jcode-works/jcode-ragmir/blob/main/LICENSE).
