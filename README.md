# Ragmir

[![npm](https://img.shields.io/npm/v/@jcode.labs/ragmir)](https://www.npmjs.com/package/@jcode.labs/ragmir)
[![CI](https://github.com/jcode-works/jcode-ragmir/actions/workflows/ci.yml/badge.svg)](https://github.com/jcode-works/jcode-ragmir/actions/workflows/ci.yml)

Ragmir is a local-first RAG library, CLI, and MCP server for projects that need useful, cited context
without a hosted document store. Choose the files to index on your machine, then search them from a
terminal, TypeScript, or an AI agent. The default retrieval path needs no account, cloud service, or
model download.

## How it works

1. Choose repository files with `.ragmir/sources.txt` or `rgr sources add`.
2. Ragmir extracts text, redacts configured sensitive values, splits it into chunks, and stores the
   index locally under ignored `.ragmir/` state.
3. `rgr search`, the TypeScript API, and the MCP server return ranked passages with their source path,
   page when available, and chunk number.
4. `local-hash` is the default offline retrieval mode. Semantic embeddings, local chat, local audio,
   and OCR are explicit optional add-ons.

Scanned PDFs are supported through an opt-in local OCR command. OCR is used only for PDF pages without
embedded text, never through a cloud service.

## Getting started

Install Ragmir in the repository that owns the documents you want to search:

```bash
pnpm add -D @jcode.labs/ragmir
pnpm exec rgr setup
pnpm exec rgr sources add "docs/**/*.md"
pnpm exec rgr ingest
pnpm exec rgr search "deployment decision"
```

`rgr setup` prepares ignored local state and agent helpers. `rgr ingest` is incremental. A search
result includes the source file, excerpt, chunk number, and PDF page when one is known.

To give the same cited context to an agent, generate its local MCP helper:

```bash
pnpm exec rgr setup --agents claude,codex,kimi,opencode,cline
```

## Use cases

| Need | What Ragmir provides |
| --- | --- |
| Find a technical decision in project documentation | Local search with source citations. |
| Give an AI agent trusted repository context | A read-focused MCP server with bounded retrieval. |
| Audit policies, runbooks, or knowledge bases | Search, `research`, diagnostics, and explicit evidence. |
| Index scanned operational PDFs | Page-aware text extraction with optional local OCR. |
| Work offline on a confidential repository | Local index, local-hash retrieval, and optional local models. |
| Prepare an audio or chat companion | Optional local GGUF chat and local/offline TTS add-ons. |

## Interfaces

| Need | Use |
| --- | --- |
| Search documents from a terminal | `rgr search "query"` |
| Inspect setup, sources, and privacy posture | `rgr doctor`, `rgr audit`, `rgr security-audit` |
| Retrieve from TypeScript | `ingest`, `search`, `ask`, or `research` |
| Connect an agent | `rgr setup` and the generated MCP helper |
| Use semantic retrieval | `rgr setup --semantic` |
| Answer with a local GGUF model | `rgr chat setup`, then `rgr chat "question"` |
| Render a local audio summary | `rgr audio <file> --offline` |

## TypeScript API

```ts
import { ingest, search } from "@jcode.labs/ragmir"

await ingest()

const results = await search("Which decision changed the rollout?", { topK: 5 })

for (const result of results) {
  console.log(result.relativePath, result.chunkIndex, result.text)
}
```

Ragmir Core retrieves evidence. `ask()` returns cited context and does not call a hosted model or
generate an ungrounded answer.

## Technology

- **TypeScript, Node.js 22, and pnpm** for the portable CLI, library, MCP server, and workspace.
- **LanceDB** for local vector storage and retrieval.
- **Transformers.js** for explicit optional semantic embeddings and offline audio models.
- **Model Context Protocol TypeScript SDK** for integrations with coding agents.
- **node-llama-cpp** for the optional local GGUF chat add-on.
- **Astro and React** for the static project site only, with no analytics or vendor deployment config.

## Packages

| Package | Purpose |
| --- | --- |
| `@jcode.labs/ragmir` | CLI, TypeScript library, MCP server, and portable skills. |
| `@jcode.labs/ragmir-chat` | Optional cited local chat through verified GGUF models. |
| `@jcode.labs/ragmir-tts` | Optional local/offline WAV and explicit online MP3 rendering. |

## Documentation

| Guide | When to read it |
| --- | --- |
| [CLI reference](./docs/cli-reference.md) | Commands, options, and output modes. |
| [API reference](./docs/api-reference.md) | Public TypeScript exports and return shapes. |
| [Configuration](./docs/configuration.md) | Sources, privacy, retrieval, limits, and extractors. |
| [Agent integration](./docs/agent-integration.md) | Claude Code, Codex, Kimi, OpenCode, and Cline. |
| [Troubleshooting](./docs/troubleshooting.md) | Empty indexes, OCR, weak retrieval, and local models. |
| [Offline chat](./docs/offline-chat-preload.md) | Prepare and verify a local GGUF model. |
| [Offline TTS](./docs/offline-tts-preload.md) | Prepare and render confidential narration. |
| [Security hardening](./SECURITY-HARDENING.md) | Local data boundaries and operational safeguards. |

## Develop

```bash
pnpm bootstrap
pnpm validate
pnpm example
```

The project uses the Node version pinned in `mise.toml`. `pnpm validate` runs formatting, a dependency
security audit, types, tests, builds, CLI and MCP smoke checks, and npm package checks.

## MIT

Ragmir source is available under the [MIT terms](./LICENSE).
