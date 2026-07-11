---
name: ragmir
description: Use this skill whenever a repository uses or should use Ragmir, local-first RAG, private project knowledge, document ingestion, knowledge-base audit, or MCP access to project documents. Use it before answering from memory when the user asks about facts that may be present in private files, asks to ingest/query/audit documents, or wants Claude Code, Codex, Kimi, OpenCode, Cline, or another AI agent to use the same local knowledge base.
---

# Ragmir

Ragmir is a sovereign local RAG knowledge base for confidential project documents and datasets. It
indexes files from the current repository, stores vectors locally, and exposes both a CLI and an MCP
server.

Use this skill to help an AI agent work with a Ragmir-enabled repository without leaking private documents or relying on stale memory.

## Core Rule

Treat the repository where the user is working as the source of truth. Ragmir data belongs to that repository, not to the installed npm package.

Default project layout:

```plain text
.ragmir/config.json   # local Ragmir config
.ragmir/raw/          # raw documents to ingest
.ragmir/storage/      # generated local index
.ragmir/access.log    # metadata-only access log
.ragmir/reports/      # generated local Markdown reports
```

## Data Safety

- Do not commit raw documents, secrets, tax IDs, scans, bank documents, tokens, or generated vector stores.
- Keep `.ragmir/` ignored by Git.
- Treat `rgr search`, `rgr ask`, `rgr research`, and MCP results as sensitive because they can
  contain private source passages even when redaction is enabled.
- Prefer summaries and citations over dumping long private passages into the chat.
- If the user asks for a high-stakes answer, identify which facts came from Ragmir and which still require professional or official verification.

## First Checks

From the repository root:

```bash
pnpm exec rgr doctor
```

If Ragmir is installed but setup is incomplete or the index is stale:

```bash
pnpm exec rgr doctor --fix
```

If Ragmir is not installed:

```bash
pnpm add -D @jcode.labs/ragmir
pnpm exec rgr setup
# Optional: one-time model download for higher-quality semantic retrieval.
pnpm exec rgr setup --semantic
```

When the repository should expose only specific agent helpers or must launch MCP through a local
wrapper, generate the agent kit explicitly:

```bash
pnpm exec rgr setup --agents claude,codex --mcp-command ./scripts/serve-mcp.sh
```

If the package manager is npm:

```bash
npm install --save-dev @jcode.labs/ragmir
npx rgr setup
# Optional: one-time model download for higher-quality semantic retrieval.
npx rgr setup --semantic
```

Use `status`, `audit`, and `security-audit` for deeper checks after `doctor` explains the current
state. Use `audit --unsupported` when files exist but may not have been indexed.

## Agent Operating Loop

Prefer the smallest command that answers the user's task:

| Task | Preferred command or tool |
| --- | --- |
| Check whether Ragmir is usable | `rgr doctor` or MCP `ragmir_status` |
| Decide whether a prompt needs Ragmir | `rgr route-prompt "..." --json` or MCP `ragmir_route_prompt` |
| Repair missing setup or stale index | `rgr doctor --fix` |
| Inspect skipped, duplicate, archive-like, or mirror-like sources | `rgr audit --unsupported` |
| Find exact source passages | `rgr search "<query>" --compact` or MCP `ragmir_search` with `compact: true` |
| Prepare a broad implementation, review, or planning answer | `rgr research "<topic>" --compact` or MCP `ragmir_research` |
| Return deterministic cited context for a trusted model | `rgr ask "<question>"` or MCP `ragmir_ask` |
| Check local privacy posture | `rgr security-audit` or MCP `ragmir_security_audit` |
| Validate recall against known expected files | `rgr evaluate --golden <file>` or MCP `ragmir_evaluate` |

## Provider Modes

Default retrieval mode:

```json
{
  "embeddingProvider": "local-hash"
}
```

This supports ingestion, search, MCP retrieval, and `rgr ask` with cited passages without a model
server. It is lexical/hash retrieval, not model-semantic search. Do not present it as equivalent to
semantic embeddings.

Optional semantic embedding mode:

```json
{
  "embeddingProvider": "transformers",
  "embeddingModel": "intfloat/multilingual-e5-small",
  "embeddingModelRevision": "main",
  "embeddingModelPath": ".ragmir/models",
  "transformersAllowRemoteModels": false
}
```

This uses Transformers.js for embeddings only. Keep `transformersAllowRemoteModels` false for
air-gapped or confidential work and preload model files under `embeddingModelPath`. Use the
first-run shortcut when a one-time download is acceptable:

```bash
pnpm exec rgr setup --semantic
pnpm exec rgr ingest --rebuild
```

Or enable it later:

```bash
pnpm exec rgr models pull --enable
pnpm exec rgr ingest --rebuild
```

## Ingestion Workflow

After documents are added or changed:

```bash
pnpm exec rgr doctor --fix
pnpm exec rgr audit
pnpm exec rgr audit --unsupported
pnpm exec rgr security-audit
pnpm exec rgr status
```

`rgr doctor --fix` updates the index only when supported files are present and the privacy posture
has no warnings. Normal `rgr ingest` reuses unchanged rows; use `rgr ingest --rebuild` after changing
embedding provider/model or chunking settings. `rgr ingest --json` reports `emptyTextFiles` when
supported files, typically scanned PDFs, produce no indexable text. `rgr doctor` should show
`ready=true` before relying on the index. Empty-text, oversized, missing, or stale coverage keeps it
false. Run `rgr limits` to inspect the active per-file and parser bounds. There is no fixed file-count
or total-corpus-byte ceiling, so benchmark large corpora on their target machine. The audit must show
no missing or stale supported files, and the security audit should not show warnings before relying
on Ragmir for sensitive work.

Default retrieval is tuned for broader recall (`topK: 8`, `chunkOverlap: 200`). Keep MCP retrieval
bounded by `mcpMaxTopK`, and raise `--top-k` only when the first results are too narrow.

For monorepos, keep raw confidential files local and list useful repo docs through the `sources`
array in `.ragmir/config.json`. Entries can be paths or glob patterns relative to the Ragmir project
root, with `!` exclusions:

```plain text
../apps/*/README.md
../apps/*/docs/**/*.md
!../apps/**/node_modules/**
```

Use the CLI when you want agents or setup scripts to update the file without manual editing:

```bash
pnpm exec rgr sources add "../apps/*/README.md" "../apps/*/docs/**/*.md"
pnpm exec rgr sources add "!../apps/**/node_modules/**"
pnpm exec rgr sources list
```

## Query Workflow

Use search when you need exact source passages:

```bash
pnpm exec rgr search "your query"
```

Use repeatable `--include-path` and `--exclude-path` filters when primary evidence, research notes,
or mirror/archive directories must be evaluated separately. The same `includePaths` and
`excludePaths` arrays are available through MCP and per query in golden evaluation files.

Use research when the user asks for broad context, implementation planning, review preparation, or a
cross-document audit:

```bash
pnpm exec rgr research "your topic" --compact
```

`rgr research` runs audit and security checks, generates several related retrieval queries, merges
cited evidence, reports source diagnostics, and performs a lightweight repository code scan unless
`--no-code` is used.

Use ask when you need cited context for the current agent or an external LLM:

```bash
pnpm exec rgr ask "your question"
```

Ground answers in returned sources. If search results are weak, say that the current index does not
prove the point and ask for the missing document. `rgr ask` returns cited passages rather than LLM
synthesis. Use those passages as context for the current agent, or tell the user that generative
synthesis needs a trusted external LLM or model runtime.

## Prompt Routing

When the user did not explicitly mention Ragmir, use local judgment first. If the prompt asks about
the current repository, local documents, private specs, architecture, previous decisions, citations,
release readiness, audits, or implementation planning, prefer Ragmir before answering from memory.

When the runtime supports MCP and you are unsure, call `ragmir_route_prompt` with the prompt text. If
MCP is unavailable, use:

```bash
pnpm exec rgr route-prompt "the user prompt" --json
```

If the decision returns `shouldUseRagmir: true`, call the suggested `tool` with the returned `query`.
If it returns `false`, answer normally. The router is deterministic and local: it does not store
prompt text, call an LLM, read the vector index, or retrieve passages.

## Deep Research Workflow

For broad summaries, audits, planning, or institutional dossiers, do not rely on one query. Build a
small retrieval plan first:

- use `rgr research` as the first pass when available;
- check `rgr audit` and `rgr security-audit`;
- query the main topic;
- query names, dates, amounts, obligations, risks, decisions, and missing evidence separately;
- compare the strongest passages across files;
- ask a synthesis question only after search has found enough grounded context;
- cite source paths and chunk numbers in the answer when useful;
- explicitly say when the index does not prove a claim.

For sensitive work, prefer the smallest useful `topK`; raise it only when the first results are too
thin. Do not dump large raw passages into the chat unless the user explicitly asks for extracts.

## MCP Usage

If the agent supports MCP, configure a server for the repository:

```json
{
  "mcpServers": {
    "ragmir": {
      "command": "pnpm",
      "args": ["exec", "rgr", "serve-mcp"],
      "cwd": "/absolute/path/to/the/repository"
    }
  }
}
```

Generated MCP helpers use the `ragmir` server name by default. Use `rgr setup --mcp-name <name>`
or `rgr install-skill --mcp-name <name>` only when the repository needs a different stable MCP
key.

For Claude Code, run this from the target repository root after `pnpm exec rgr setup`:

```bash
claude mcp add-json --scope local ragmir "$(cat .ragmir/claude-mcp-server.json)"
```

For Codex, copy `.ragmir/codex-mcp.toml` into `~/.codex/config.toml` or another trusted Codex config
layer. It includes both the Ragmir MCP server and `skills.config` entries.

For Kimi Code CLI, run from the target repository root:

```bash
kimi --mcp-config-file .ragmir/kimi-mcp.json
```

For OpenCode, merge `.ragmir/opencode.jsonc` into the OpenCode config layer used by the project.

For Cline, add `.ragmir/cline-mcp.json` under `mcpServers` in Cline's MCP configuration.

For other MCP clients that cannot set `cwd`, set `RAGMIR_PROJECT_ROOT=/absolute/path/to/repository`
when launching `rgr serve-mcp`. `RAGMIR_PROJECT_ROOT` is the strongest signal; otherwise a
configured current working directory wins before agent-provided project environment variables.

Available MCP tools:

- `ragmir_status`: show config and chunk count.
- `ragmir_route_prompt`: classify a prompt and suggest whether local Ragmir context is needed.
- `ragmir_search`: retrieve source passages; set `compact: true` when the agent context is tight.
- `ragmir_ask`: return cited retrieval context.
- `ragmir_research`: run audit-backed multi-query retrieval with source diagnostics and optional code matches.
- `ragmir_audit`: compare source files with the current index.
- `ragmir_evaluate`: measure retrieval recall against a local golden query file.
- `ragmir_usage_report`: summarize metadata-only local access-log activity without query text or local paths.
- `ragmir_security_audit`: inspect local privacy, provider, redaction, MCP, and gitignore posture.

Prefer MCP tools over shell commands when the agent runtime provides them. Use shell commands when MCP is unavailable.

MCP is read-focused and intentionally does not expose index deletion. Use `pnpm exec rgr
destroy-index --yes` from the shell when the user explicitly wants to remove the generated index.

## Optional Audio Summaries

If the user asks for a listenable or TTS summary, load the optional
`.ragmir/skills/ragmir-audio-summary/` skill installed by `pnpm exec rgr setup`.

The audio skill should:

- gather evidence through Ragmir first;
- write narration text only to a temp file outside the repository;
- render generated audio under `.ragmir/audio/` by default;
- prefer offline TTS engines for confidential content.

## Optional Markdown Reports

If the user asks for a Markdown report, dossier, audit memo, planning note, or decision brief, load
the optional `.ragmir/skills/ragmir-markdown-report/` skill installed by `pnpm exec rgr setup`.

The report skill should:

- gather evidence through multiple Ragmir searches first;
- cite source paths and chunk numbers;
- separate facts, inference, uncertainty, and missing evidence;
- write reports under `.ragmir/reports/` by default;
- keep generated reports uncommitted unless the user explicitly wants a sanitized tracked report.

## Installing This Skill Into A Repository

Most repositories should run the full setup command:

```bash
pnpm exec rgr setup
```

Use the lower-level skill installer only when Ragmir is already initialized and you want to refresh
the local agent kit:

```bash
pnpm exec rgr install-skill
pnpm exec rgr install-skill --agents claude,codex --mcp-command ./scripts/serve-mcp.sh
```

This creates:

```plain text
.ragmir/skills/ragmir/SKILL.md
.ragmir/skills/ragmir-audio-summary/SKILL.md
.ragmir/skills/ragmir-markdown-report/SKILL.md
.ragmir/skills/ragmir-legal-dossier/SKILL.md
.ragmir/mcp.json
.ragmir/claude-mcp-server.json
.ragmir/codex-mcp.toml
.ragmir/kimi-mcp.json
.ragmir/opencode.jsonc
.ragmir/cline-mcp.json
.ragmir/agent-setup.md
.ragmir/README.md
```

When `--agents` is used, only the selected agent-specific MCP helpers are written, and stale
unselected helpers in `.ragmir/` are removed.

For native discovery, install only the agent the user uses:

```bash
pnpm exec rgr install-agent --agents claude
pnpm exec rgr install-agent --agents kimi
pnpm exec rgr install-agent --agents claude,codex,kimi,opencode,cline
```

By default this writes project-scope skill folders such as `.claude/skills/`, `.kimi/skills/`,
`.opencode/skills/`, or `.cline/skills/` as links back to `.ragmir/skills/`. That keeps one original
skill source. Add `--scope user` for global installs, or `--mode copy` only when an agent/runtime
cannot follow symlinked skill directories.

Agents that understand skill folders can load `.ragmir/skills/ragmir/` directly when native discovery
is not installed. Other agents can read `.ragmir/README.md` and `.ragmir/mcp.json`.

## Answer Style

When answering from Ragmir:

- mention the source file paths and chunk/source labels when useful;
- distinguish facts found in documents from inference;
- keep operational/legal/financial claims conservative;
- recommend ingesting or providing missing documents when the index is incomplete.
