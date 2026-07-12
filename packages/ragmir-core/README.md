# Ragmir Core

[![npm version](https://img.shields.io/npm/v/@jcode.labs/ragmir)](https://www.npmjs.com/package/@jcode.labs/ragmir)
[![npm downloads](https://img.shields.io/npm/dm/@jcode.labs/ragmir)](https://www.npmjs.com/package/@jcode.labs/ragmir)
[![Node.js](https://img.shields.io/node/v/@jcode.labs/ragmir)](https://www.npmjs.com/package/@jcode.labs/ragmir)
[![MIT](https://img.shields.io/npm/l/@jcode.labs/ragmir)](https://github.com/jcode-works/jcode-ragmir/blob/main/LICENSE)

**The CLI, TypeScript API, and local MCP server for cited project retrieval.**

`@jcode.labs/ragmir` indexes the files a project selects and returns source-backed passages without
a hosted document store. The default `local-hash` retrieval path works offline, without an account
or model download.

[Project overview](https://github.com/jcode-works/jcode-ragmir#readme) ·
[CLI reference](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/cli-reference.md) ·
[API reference](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/api-reference.md)

## Install Core when you need

| Goal | Core interface |
| --- | --- |
| Search repository documents with citations | `rgr search` |
| Audit a local knowledge base | `rgr audit`, `rgr doctor`, and `rgr security-audit` |
| Add retrieval to a Node.js application | Typed `ingest`, `search`, `ask`, and `research` exports |
| Give an AI agent bounded project context | Local stdio MCP server and generated helpers |
| Index scanned PDFs | Embedded text first, with optional page-aware local OCR |

Core retrieves evidence. It does not require a generative model and does not produce an ungrounded
answer. Add [Ragmir Chat](https://www.npmjs.com/package/@jcode.labs/ragmir-chat) only when local
GGUF synthesis is useful, or [Ragmir TTS](https://www.npmjs.com/package/@jcode.labs/ragmir-tts)
when you need audio output.

## First cited search

Requires Node.js 20 or later.

```bash
npm install --save-dev @jcode.labs/ragmir
npx rgr setup
npx rgr sources add "README.md" "docs/**/*.md"
npx rgr ingest
npx rgr search "Which decision changed the rollout?"
```

The project now owns an ignored `.ragmir/` directory containing configuration and generated local
state. Ingestion is incremental, and every result identifies the source path, chunk, line range, and
PDF page when one is available.

## CLI essentials

```bash
# Readiness and source coverage
npx rgr doctor
npx rgr audit --unsupported
npx rgr security-audit

# Retrieval
npx rgr preview --path docs --max-chunks 3
npx rgr search "deployment decision"
npx rgr search "deployment decision" --explain
npx rgr search "deployment decision" --context-path "Operations > Deployment"
npx rgr ask "What evidence supports the deployment decision?"
npx rgr research "deployment obligations" --compact

# Machine-readable output
npx rgr search "deployment decision" --json
```

`ask` returns cited retrieval context, not LLM synthesis. `research` performs an audit-backed,
multi-query retrieval pass and reports missing or weak evidence.

## TypeScript API

```ts
import { ingest, search } from "@jcode.labs/ragmir"

await ingest({ cwd: process.cwd() })

const results = await search("Which decision changed the rollout?", {
  cwd: process.cwd(),
  topK: 5,
})

for (const result of results) {
  console.log(result.citation, result.text)
}
```

Frequently used exports:

| Export | Purpose |
| --- | --- |
| `setupProject`, `addSourceEntries` | Initialize project state and select files |
| `discoverKnowledgeBases`, `knowledgeBaseIdentity` | Route root and nested monorepo bases |
| `getKnowledgeBaseContext`, `getKnowledgeBaseSourceCatalog` | Give agents bounded readiness and source context |
| `ingest`, `audit` | Build the index and compare it with files on disk |
| `previewChunks` | Inspect redacted chunks and distributions without writing storage |
| `search`, `ask`, `research`, `expandCitation` | Retrieve or expand cited passages |
| `doctor`, `securityAudit` | Inspect readiness and local privacy posture |
| `serveMcp` | Start the read-focused local MCP server |
| `configurePdfOcr`, `inspectPdfOcr` | Configure and inspect local PDF OCR |

See the [complete API reference](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/api-reference.md)
for options and result shapes.

## Connect an AI agent

```bash
npx rgr setup --agents claude,codex,kimi,opencode,cline
npx rgr doctor
```

Ragmir writes helper files for the selected clients and points them at the current project. MCP
exposes status, search, ask, research, exact citation expansion, audit, evaluation, usage, and
security tools. Retrieval responses have a global byte ceiling and expose metadata-only output
metrics. The server does not expose index deletion.

For a monorepo with root and app-specific bases, run `rgr bases --json` before retrieval when scope
is unclear. The nearest configured base is active, nested MCP helpers get unique names, and every
helper pins `RAGMIR_PROJECT_ROOT` so clients cannot drift to a sibling index.

## Retrieval modes

| Mode | Network requirement | Best for |
| --- | --- | --- |
| `local-hash` | None | Default offline retrieval, setup-free projects, and deterministic evaluation |
| `transformers` | Explicit model preload or download | Higher-quality semantic matching with local inference |

Enable semantic retrieval explicitly:

```bash
npx rgr setup --semantic
npx rgr ingest --rebuild
```

`local-hash` is lexical/hash retrieval. It should not be presented as equivalent to semantic
embeddings.

## Documents and OCR

Core parses common source, text, structured-data, Office, OpenDocument, EPUB, HTML, email, notebook,
and PDF formats. Projects can add custom text extensions. Run `rgr audit --unsupported` to see every
skipped file and recommendation.

For scanned PDFs:

```bash
npx rgr ocr setup --engine auto
npx rgr ingest --rebuild
```

Ragmir prefers embedded PDF text and invokes OCR only for blank pages. OCR runs through a configured
local executable, never a shell string or cloud OCR service.

## Local data and privacy

- Project paths resolve from `cwd` or explicit configuration, not the npm installation directory.
- Generated indexes, models, reports, audio, and access logs belong under ignored `.ragmir/` state.
- Redaction runs before indexing when configured, but it is not a compliance certification.
- External extractors and model downloads are opt-in system boundaries.
- MCP retrieval is bounded by `mcpMaxOutputBytes`; access logs contain byte metrics, not query text
  or retrieved passages.

Read [configuration and privacy](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/configuration.md)
and [security hardening](https://github.com/jcode-works/jcode-ragmir/blob/main/SECURITY-HARDENING.md)
before indexing sensitive material.

## Runnable examples

| Example | Demonstrates |
| --- | --- |
| [Sovereign RAG demo](https://github.com/jcode-works/jcode-ragmir/tree/main/packages/ragmir-core/examples/sovereign-rag-demo) | CLI ingestion, search, audit, redaction, and evaluation |
| [Library API demo](https://github.com/jcode-works/jcode-ragmir/tree/main/packages/ragmir-core/examples/library-api-demo) | The public library surface against fictional files |
| [Document evidence benchmark](https://github.com/jcode-works/jcode-ragmir/tree/main/packages/ragmir-core/examples/document-evidence-benchmark) | Recall and exact citation evaluation |

## Documentation

- [CLI reference](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/cli-reference.md)
- [TypeScript API reference](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/api-reference.md)
- [Configuration](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/configuration.md)
- [Agent integration](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/agent-integration.md)
- [Troubleshooting](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/troubleshooting.md)

Ragmir Core is open source under the [MIT License](https://github.com/jcode-works/jcode-ragmir/blob/main/LICENSE).
