# Ragmir

[![npm](https://img.shields.io/npm/v/@jcode.labs/ragmir)](https://www.npmjs.com/package/@jcode.labs/ragmir)
[![CI](https://github.com/jcode-works/jcode-ragmir/actions/workflows/ci.yml/badge.svg)](https://github.com/jcode-works/jcode-ragmir/actions/workflows/ci.yml)

Ragmir is a local-first RAG library, CLI, and MCP server. It indexes the files you choose on your
machine and returns cited passages to AI agents. The default path uses no account, no hosted document
store, and no model download.

## Start here

Install Ragmir in the repository that contains the documents you want to search:

```bash
pnpm add -D @jcode.labs/ragmir
pnpm exec rgr setup
pnpm exec rgr sources add "docs/**/*.md"
pnpm exec rgr ingest
pnpm exec rgr search "deployment decision"
```

`rgr setup` creates ignored local state in `.ragmir/`, prepares agent helpers, and keeps generated
indexes out of Git. Add the paths you want to index before ingesting. `rgr ingest` indexes configured
sources incrementally. Search results include a file path, page when available, chunk number, and
excerpt.

## Choose the right interface

| Need | Use |
| --- | --- |
| Search local documents in a terminal | `rgr search "query"` |
| Give an agent cited context | `rgr setup` then the generated MCP helper |
| Query from TypeScript | `ingest`, `search`, `ask`, or `research` |
| Use semantic retrieval | `rgr setup --semantic` |
| Generate with a local model | `rgr chat setup` then `rgr chat "question"` |
| Render a local audio summary | `rgr audio <file> --offline` |
| Diagnose an index | `rgr doctor`, `rgr audit`, or `rgr security-audit` |

## TypeScript API

```ts
import { ingest, search } from "@jcode.labs/ragmir"

await ingest()

const results = await search("Which decision changed the rollout?", {
  topK: 5,
})

for (const result of results) {
  console.log(result.relativePath, result.chunkIndex, result.text)
}
```

Ragmir Core retrieves evidence. `ask()` returns cited context, it does not call a hosted model or
produce an ungrounded answer. See the [API reference](./docs/api-reference.md) for every public
export.

## Connect an agent

Run setup once in the target repository:

```bash
pnpm exec rgr setup --agents claude,codex,kimi,opencode,cline
```

Ragmir writes local helper files under `.ragmir/`. Each supported agent gets a configuration snippet
for the same read-focused MCP server. Cloud agents can receive the passages you request through their
own client, so review that client’s data policy before sharing confidential excerpts.

## Retrieval modes

- `local-hash` is the default. It is local, deterministic, and needs no model.
- `transformers` is the explicit semantic option. `rgr setup --semantic` downloads the embedding
  model once; normal indexing then keeps remote model loading disabled.
- `rgr chat` is an optional local GGUF add-on. Its model is downloaded only during explicit setup;
  normal answers stay offline.

For scanned PDFs, run `rgr ocr doctor` and `rgr ocr setup`. OCR remains an opt-in local extractor and
runs only for pages without embedded text.

## Packages

| Package | Purpose |
| --- | --- |
| `@jcode.labs/ragmir` | CLI, TypeScript library, MCP server, and bundled skills. |
| `@jcode.labs/ragmir-chat` | Optional local cited chat through verified GGUF models. |
| `@jcode.labs/ragmir-tts` | Optional offline WAV and explicit online MP3 rendering. |
| `@jcode.labs/ragmir-ui` | Shared landing primitives inside this workspace. |

## Documentation

| Guide | When to read it |
| --- | --- |
| [CLI reference](./docs/cli-reference.md) | Command names, options, and output modes. |
| [API reference](./docs/api-reference.md) | Public TypeScript exports and return shapes. |
| [Configuration](./docs/configuration.md) | Sources, privacy, retrieval, limits, and extractors. |
| [Agent integration](./docs/agent-integration.md) | Claude Code, Codex, Kimi, OpenCode, and Cline. |
| [Troubleshooting](./docs/troubleshooting.md) | Empty indexes, OCR, weak retrieval, and local models. |
| [Offline chat](./docs/offline-chat-preload.md) | Prepare and verify a local GGUF model. |
| [Offline TTS](./docs/offline-tts-preload.md) | Prepare and render confidential narration. |
| [Security hardening](./SECURITY-HARDENING.md) | Local data boundaries and operational safeguards. |

## Technology

Ragmir uses [LanceDB](https://github.com/lancedb/lancedb) for local vectors,
[Transformers.js](https://github.com/huggingface/transformers.js) for optional embeddings and offline
audio, the [Model Context Protocol TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
for agent integration, and [node-llama-cpp](https://github.com/withcatai/node-llama-cpp) for optional
local chat.

## Develop

```bash
pnpm bootstrap
pnpm validate
pnpm example
```

The project uses pnpm and the Node version pinned in `mise.toml`. `pnpm validate` runs formatting,
security audit, type checks, tests, builds, CLI/MCP smoke checks, and package checks.

## MIT

Ragmir source is available under the [MIT terms](./LICENSE).
