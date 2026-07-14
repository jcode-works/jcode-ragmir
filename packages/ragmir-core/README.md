# @jcode.labs/ragmir

[![npm version](https://img.shields.io/npm/v/@jcode.labs/ragmir)](https://www.npmjs.com/package/@jcode.labs/ragmir)
[![npm downloads](https://img.shields.io/npm/dm/@jcode.labs/ragmir)](https://www.npmjs.com/package/@jcode.labs/ragmir)
[![Node.js](https://img.shields.io/node/v/@jcode.labs/ragmir)](https://www.npmjs.com/package/@jcode.labs/ragmir)
[![MIT](https://img.shields.io/npm/l/@jcode.labs/ragmir)](https://github.com/jcode-works/jcode-ragmir/blob/main/LICENSE)

**Local RAG for your coding agents.**

`@jcode.labs/ragmir` indexes the project files you select on your machine and retrieves bounded,
cited evidence offline by default. The corpus and generated index remain local, so confidential
source files are not uploaded to a hosted RAG service. Your coding agent or local script gets the
context it needs without an account, API key, or model download.

Core is model-agnostic. Connect the coding agent or local script you already use through generated
project skills, local MCP, or the JSON CLI. Use the typed Node.js API when your application owns the
control flow.

[Project overview](https://github.com/jcode-works/jcode-ragmir#readme) ·
[Documentation](https://github.com/jcode-works/jcode-ragmir/wiki) ·
[CLI reference](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/cli-reference.md) ·
[API reference](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/api-reference.md)

## What your coding agent gains

| Goal | Core interface |
| --- | --- |
| Search repository documents with citations | `rgr search` |
| Audit a local knowledge base | `rgr audit`, `rgr doctor`, and `rgr security-audit` |
| Add retrieval to a Node.js application | Typed `ingest`, `search`, `ask`, and `research` exports |
| Give an agent bounded project context | Local stdio MCP server and generated helpers |
| Index scanned PDFs | Embedded text first, with optional page-aware local OCR |

Core retrieves cited evidence. It does not require a generative model or generate answers. Use
[Ragmir Chat](https://www.npmjs.com/package/@jcode.labs/ragmir-chat) only when local GGUF synthesis
is useful, or [Ragmir TTS](https://www.npmjs.com/package/@jcode.labs/ragmir-tts) when you need audio
output. Core declares both as optional peer integrations and does not install either add-on.

## Connect a coding agent in minutes

Requires Node.js 20 or later.

```bash
npm install --save-dev @jcode.labs/ragmir
npx rgr setup --agents codex,claude,kimi,opencode,cline
npx rgr sources add "README.md" "docs/**/*.md"
npx rgr ingest
npx rgr doctor
```

Then ask the selected agent:

```text
Use Ragmir to find the rollout decision. Cite every claim and expand the strongest citation before
you recommend a change.
```

Setup installs project-scoped native skills and writes a local stdio MCP helper for each selected
client. The generated runner pins the current project, so an agent in a monorepo does not silently
query a sibling index. No Ragmir-specific model is required.

The same setup works with any compatible MCP client. Hermes can launch `.ragmir/run.cjs`; local
scripts, CI, and internal tools can call the JSON CLI or the TypeScript API without a dedicated
connector.

## Use the same evidence from an automation

```bash
npx rgr search "Should this renewal require approval?" --compact --json
```

Use that command from a local shell script, a Node.js worker, or a CI step after mounting the project
and its local `.ragmir/` state. The process returns machine-readable cited passages; the workflow
decides whether to continue, request human approval, or stop.

For long-running agent integrations, start the local stdio server with `npx rgr serve-mcp`. For a
Node.js worker that owns the control flow, use `createRagmirClient()` and reuse one client per project
root. Ragmir does not open an HTTP port or define an authentication layer.

## Search directly from the CLI

```bash
npx rgr search "Which decision changed the rollout?"
```

The project owns an ignored `.ragmir/` directory containing configuration and generated local
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

The persistent client reuses one local database connection, supports cooperative cancellation, and
waits for active work before shutdown. The top-level functions remain the smallest API for one-shot
scripts.

Frequently used exports:

| Export | Purpose |
| --- | --- |
| `setupProject`, `addSourceEntries` | Initialize project state and select files |
| `discoverKnowledgeBases`, `knowledgeBaseIdentity` | Route root and nested monorepo bases |
| `getKnowledgeBaseContext`, `getKnowledgeBaseSourceCatalog` | Give agents bounded readiness and source context |
| `createRagmirClient`, `RagmirClient` | Reuse local retrieval safely in a stateful Node.js process |
| `ingest`, `audit` | Build the index and compare it with files on disk |
| `previewChunks` | Inspect redacted chunks and distributions without writing storage |
| `search`, `ask`, `research`, `expandCitation` | Retrieve or expand cited passages |
| `doctor`, `securityAudit` | Inspect readiness and local privacy posture |
| `createMcpServer`, `connectMcpServer`, `serveMcp` | Construct, connect, or start the read-focused local MCP server |
| `configurePdfOcr`, `inspectPdfOcr` | Configure and inspect local PDF OCR |

See the [complete API reference](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/api-reference.md)
for options and result shapes.

Any compatible CLI, TypeScript, or MCP client can consume the same cited results. A hosted AI
receives returned passages under its provider's data policy. OpenCode or another local consumer can
keep the handoff on the workstation. Optional Ragmir Chat adds local answer generation, but Qwen,
Gemma, and every other generative model remain outside Core.

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

- [Project documentation](https://github.com/jcode-works/jcode-ragmir/wiki)
- [CLI reference](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/cli-reference.md)
- [TypeScript API reference](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/api-reference.md)
- [Configuration](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/configuration.md)
- [Agent integration](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/agent-integration.md)
- [Troubleshooting](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/troubleshooting.md)

Ragmir Core is open source under the [MIT License](https://github.com/jcode-works/jcode-ragmir/blob/main/LICENSE).
