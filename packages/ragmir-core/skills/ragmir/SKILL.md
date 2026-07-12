---
name: ragmir
description: Use Ragmir for local-first retrieval from private project documents, document ingestion, knowledge-base audits, or MCP access to a repository corpus. Prefer it to memory when the answer may be in local documents.
---

# Ragmir

Ragmir indexes a repository's documents locally and returns cited passages through a CLI and MCP
server. Treat the target repository and its index as the source of truth.

## Safety

- Do not commit `.ragmir/`, raw documents, generated vectors, or access logs.
- Treat retrieval output as sensitive. Summarize it with citations instead of pasting long passages.
- Separate document-backed facts from inference. Ask for missing documents when the index is weak.

## Start here

From the target repository root:

```sh
pnpm exec rgr doctor
```

If setup or indexing is incomplete:

```sh
pnpm exec rgr doctor --fix
```

For a new installation:

```sh
pnpm add -D @jcode.labs/ragmir
pnpm exec rgr setup
pnpm exec rgr ingest
```

Use `pnpm exec rgr setup --semantic` only when a one-time local embedding-model download is
acceptable. Normal confidential indexing keeps remote model loading disabled.

## Choose the smallest operation

| Need | Command or MCP tool |
| --- | --- |
| Readiness | `rgr doctor` or `ragmir_status` |
| Repair setup or stale data | `rgr doctor --fix` |
| Check unindexed or unsupported files | `rgr audit --unsupported` |
| Check privacy posture | `rgr security-audit` |
| Retrieve exact passages | `rgr search "query" --compact` or `ragmir_search` |
| Expand one returned citation | `ragmir_expand` |
| Gather broad cited evidence | `rgr research "topic" --compact` or `ragmir_research` |
| Return deterministic context | `rgr ask "question"` or `ragmir_ask` |
| Measure retrieval recall | `rgr evaluate --golden <file>` or `ragmir_evaluate` |

Use `rgr route-prompt "..." --json` or `ragmir_route_prompt` only when it is unclear whether the
current request needs the local corpus. The router is deterministic and does not retrieve or store
the prompt.

## Indexing

Use `.ragmir/config.json` for sources, with paths, globs, and `!` exclusions:

```sh
pnpm exec rgr sources add "docs/**/*.md" "specs/**/*.md"
pnpm exec rgr sources add "!**/node_modules/**"
pnpm exec rgr ingest
```

Normal ingestion is incremental. Rebuild only after changing the embedding provider, embedding
model, or chunking settings:

```sh
pnpm exec rgr ingest --rebuild
```

For scanned PDFs, first run `rgr ocr doctor`, then configure a local OCR tool with `rgr ocr setup`.
OCR stays opt-in and never calls a remote service by default.

`local-hash` is the default retrieval provider. It supports cited local retrieval but is not
semantic embeddings. Use the Transformers provider only after an explicit model preload.

## MCP

`rgr setup` writes local MCP helpers under `.ragmir/` for Claude Code, Codex, Kimi, OpenCode, and
Cline. A generic server configuration is:

```json
{
  "mcpServers": {
    "ragmir": {
      "command": "pnpm",
      "args": ["exec", "rgr", "serve-mcp"],
      "cwd": "/absolute/path/to/repository"
    }
  }
}
```

When a client cannot set `cwd`, set `RAGMIR_PROJECT_ROOT` for the server process. Prefer MCP tools
when available. Use CLI commands when they are not.

Prefer compact search, ask, or research output first. Call `ragmir_expand` with a returned citation
only when the exact chunk or neighboring context is needed. Retrieval tools accept `maxBytes`, but
the configured `mcpMaxOutputBytes` remains the hard ceiling. Inspect `_meta["ragmir/output"]` to see
whether the response was compacted or truncated.

MCP is read-focused. Only remove an index with the explicit shell command:

```sh
pnpm exec rgr destroy-index --yes
```

## Optional outputs

For audio narration, load the installed `ragmir-audio-summary` skill. For a cited Markdown memo,
load `ragmir-markdown-report`. Both should write generated output under ignored `.ragmir/` state.

## Answer standard

- Cite file paths and source labels when useful.
- State uncertainty when retrieval does not prove a claim.
- Keep legal, security, and financial conclusions conservative and recommend appropriate review.
