# Ragmir Core

`@jcode.labs/ragmir` is the main Ragmir package. It provides the `rgr` command-line interface, a
TypeScript retrieval API, a local MCP server, and portable agent helpers.

Use it when a repository needs searchable, cited context without uploading its documents to a hosted
knowledge base. It is retrieval-first: the default `local-hash` mode works offline, without an
account or model download.

## Choose this package when you need

| Need | What Core provides |
| --- | --- |
| Search project documents from a terminal | `rgr search` with source citations. |
| Give an AI agent bounded access to repository context | A local stdio MCP server and generated helpers. |
| Build retrieval into a Node.js tool | A typed TypeScript API for ingesting and searching. |
| Index PDFs, Markdown, source files, Office files, HTML, or CSV | Local extraction, redaction, chunking, and storage. |
| Work with a confidential repository offline | Ignored local `.ragmir/` state and offline-first retrieval. |

For answer generation, install the optional [Ragmir Chat](https://www.npmjs.com/package/@jcode.labs/ragmir-chat)
package. For audio summaries, install [Ragmir TTS](https://www.npmjs.com/package/@jcode.labs/ragmir-tts).

## Quick start

Install Core in the repository that owns the documents you want to search:

```bash
npm install --save-dev @jcode.labs/ragmir
npx rgr setup
npx rgr sources add "docs/**/*.md"
npx rgr ingest
npx rgr search "Which decision changed the deployment?"
```

`rgr setup` creates ignored local state. `rgr ingest` incrementally extracts text, applies configured
redaction, chunks the content, and writes the local index. Every search result identifies its source
file, excerpt, chunk, and PDF page when available.

## How it works

1. Select files with `rgr sources add` or `.ragmir/sources.txt`.
2. Ragmir extracts and redacts text locally, then writes a local index under `.ragmir/`.
3. `rgr search`, the TypeScript API, and MCP return ranked passages with citations.
4. Semantic embeddings, OCR, local chat, and audio are explicit opt-ins.

For a scanned PDF, OCR runs only on pages that have no embedded text, through a command configured on
your machine. Ragmir never sends PDF pages to a cloud OCR service.

## TypeScript API

```ts
import { ingest, search } from "@jcode.labs/ragmir"

await ingest({ cwd: process.cwd() })

const results = await search("Which decision changed the deployment?", { topK: 5 })

for (const result of results) {
  console.log(result.relativePath, result.citation, result.text)
}
```

Use `ask()` for cited retrieval context without an LLM, `research()` for audit-backed multi-query
retrieval, and `serveMcp()` to start the local MCP server from your own integration.

## Agent setup

Generate local MCP helpers for the agents used by the repository:

```bash
npx rgr setup --agents claude,codex,kimi,opencode,cline
```

The generated helper points the agent at the current project, never at Ragmir's package installation
directory. Retrieval stays bounded and read-focused.

## Technology and local data

Core is TypeScript for Node.js 20 or later. It uses LanceDB for local storage, the Model Context
Protocol TypeScript SDK for agent integration, and Transformers.js only when semantic retrieval is
explicitly enabled. Its generated `.ragmir/` state is local and should stay ignored by Git.

## Further reading

- [Ragmir overview and package comparison](https://github.com/jcode-works/jcode-ragmir#readme)
- [CLI reference](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/cli-reference.md)
- [TypeScript API reference](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/api-reference.md)
- [Configuration and privacy](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/configuration.md)
- [Agent integration](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/agent-integration.md)

Ragmir is open source under the [MIT License](https://github.com/jcode-works/jcode-ragmir/blob/main/LICENSE).
