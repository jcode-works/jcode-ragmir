---
name: mimir
description: Use this skill whenever a repository uses or should use Mimir, local-first RAG, private project knowledge, document ingestion, knowledge-base audit, or MCP access to project documents. Use it before answering from memory when the user asks about facts that may be present in private files, asks to ingest/query/audit documents, or wants Claude Code, Codex, Kimi, OpenCode, Cline, or another AI agent to use the same local knowledge base.
---

# Mimir

Mimir is a sovereign local RAG knowledge base for confidential project documents and datasets. It
indexes files from the current repository, stores vectors locally, and exposes both a CLI and an MCP
server.

Use this skill to help an AI agent work with a Mimir-enabled repository without leaking private documents or relying on stale memory.

## Core Rule

Treat the repository where the user is working as the source of truth. Mimir data belongs to that repository, not to the installed npm package.

Default project layout:

```plain text
.mimir/config.json   # local Mimir config
.mimir/sources.txt   # optional extra source paths
.mimir/raw/          # raw documents to ingest
.mimir/storage/      # generated local index
.mimir/access.log    # metadata-only access log
.mimir/reports/      # generated local Markdown reports
```

## Data Safety

- Do not commit raw documents, secrets, tax IDs, scans, bank documents, tokens, or generated vector stores.
- Keep `.mimir/` ignored by Git. Legacy projects using `private/**` or `.kb/` must keep those paths
  ignored too.
- Treat `mimir search`, `mimir ask`, `mimir research`, and MCP results as sensitive because they can
  contain private source passages even when redaction is enabled.
- Prefer summaries and citations over dumping long private passages into the chat.
- If the user asks for a high-stakes answer, identify which facts came from Mimir and which still require professional or official verification.

## First Checks

From the repository root:

```bash
pnpm exec mimir doctor
```

If Mimir is installed but setup is incomplete or the index is stale:

```bash
pnpm exec mimir doctor --fix
```

If Mimir is not installed:

```bash
pnpm add -D @jcode.labs/mimir
pnpm exec mimir setup
```

When the repository should expose only specific agent helpers or must launch MCP through a local
wrapper, generate the agent kit explicitly:

```bash
pnpm exec mimir setup --agents claude,codex --mcp-command ./scripts/serve-mcp.sh
```

If the package manager is npm:

```bash
npm install --save-dev @jcode.labs/mimir
npx mimir setup
```

Use `status`, `audit`, and `security-audit` for deeper checks after `doctor` explains the current
state. Use `audit --unsupported` when files exist but may not have been indexed.

## Agent Operating Loop

Prefer the smallest command that answers the user's task:

| Task | Preferred command or tool |
| --- | --- |
| Check whether Mimir is usable | `mimir doctor` or MCP `mimir_status` |
| Repair missing setup or stale index | `mimir doctor --fix` |
| Inspect skipped, duplicate, archive-like, or mirror-like sources | `mimir audit --unsupported` |
| Find exact source passages | `mimir search "<query>" --compact` or MCP `mimir_search` with `compact: true` |
| Prepare a broad implementation, review, or planning answer | `mimir research "<topic>" --compact` or MCP `mimir_research` |
| Return deterministic cited context for a trusted model | `mimir ask "<question>"` or MCP `mimir_ask` |
| Check local privacy posture | `mimir security-audit` or MCP `mimir_security_audit` |
| Validate recall against known expected files | `mimir evaluate --golden <file>` or MCP `mimir_evaluate` |

## Provider Modes

Default retrieval mode:

```json
{
  "embeddingProvider": "local-hash"
}
```

This supports ingestion, search, MCP retrieval, and `mimir ask` with cited passages without a model
server. It is lexical/hash retrieval, not model-semantic search. Do not present it as equivalent to
semantic embeddings.

Optional semantic embedding mode:

```json
{
  "embeddingProvider": "transformers",
  "embeddingModel": "mixedbread-ai/mxbai-embed-xsmall-v1",
  "embeddingModelPath": ".mimir/models",
  "transformersAllowRemoteModels": false
}
```

This uses Transformers.js for embeddings only. Keep `transformersAllowRemoteModels` false for
air-gapped or confidential work and preload model files under `embeddingModelPath`:

```bash
pnpm exec mimir models pull
pnpm exec mimir ingest --rebuild
```

## Ingestion Workflow

After documents are added or changed:

```bash
pnpm exec mimir doctor --fix
pnpm exec mimir audit
pnpm exec mimir audit --unsupported
pnpm exec mimir security-audit
pnpm exec mimir status
```

`mimir doctor --fix` updates the index only when supported files are present and the privacy posture
has no warnings. Normal `mimir ingest` reuses unchanged rows; use `mimir ingest --rebuild` after changing
embedding provider/model or chunking settings. `mimir ingest --json` reports `emptyTextFiles` when
supported files, typically scanned PDFs, produce no indexable text. `mimir doctor` should show
`ready=true` before relying on the index. The audit must show no missing or stale supported files, and
the security audit should not show warnings before relying on Mimir for sensitive work.

Default retrieval is tuned for broader recall (`topK: 8`, `chunkOverlap: 200`). Keep MCP retrieval
bounded by `mcpMaxTopK`, and raise `--top-k` only when the first results are too narrow.

## Query Workflow

Use search when you need exact source passages:

```bash
pnpm exec mimir search "your query"
```

Use research when the user asks for broad context, implementation planning, review preparation, or a
cross-document audit:

```bash
pnpm exec mimir research "your topic" --compact
```

`mimir research` runs audit and security checks, generates several related retrieval queries, merges
cited evidence, reports source diagnostics, and performs a lightweight repository code scan unless
`--no-code` is used.

Use ask when you need cited context for the current agent or an external LLM:

```bash
pnpm exec mimir ask "your question"
```

Ground answers in returned sources. If search results are weak, say that the current index does not
prove the point and ask for the missing document. `mimir ask` returns cited passages rather than LLM
synthesis. Use those passages as context for the current agent, or tell the user that generative
synthesis needs a trusted external LLM or model runtime.

## Deep Research Workflow

For broad summaries, audits, planning, or institutional dossiers, do not rely on one query. Build a
small retrieval plan first:

- use `mimir research` as the first pass when available;
- check `mimir audit` and `mimir security-audit`;
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
    "mimir": {
      "command": "pnpm",
      "args": ["exec", "mimir", "serve-mcp"],
      "cwd": "/absolute/path/to/the/repository"
    }
  }
}
```

Generated MCP helpers use the `mimir` server name by default. Use `mimir setup --mcp-name <name>`
or `mimir install-skill --mcp-name <name>` only when the repository needs a different stable MCP
key.

For Claude Code, run this from the target repository root after `pnpm exec mimir setup`:

```bash
claude mcp add-json --scope local mimir "$(cat .mimir/claude-mcp-server.json)"
```

For Codex, copy `.mimir/codex-mcp.toml` into `~/.codex/config.toml` or another trusted Codex config
layer. It includes both the Mimir MCP server and `skills.config` entries.

For Kimi Code CLI, run from the target repository root:

```bash
kimi --mcp-config-file .mimir/kimi-mcp.json
```

For OpenCode, merge `.mimir/opencode.jsonc` into the OpenCode config layer used by the project.

For Cline, add `.mimir/cline-mcp.json` under `mcpServers` in Cline's MCP configuration.

For other MCP clients that cannot set `cwd`, set `MIMIR_PROJECT_ROOT=/absolute/path/to/repository`
when launching `mimir serve-mcp`.

Available MCP tools:

- `mimir_status`: show config and chunk count.
- `mimir_search`: retrieve source passages; set `compact: true` when the agent context is tight.
- `mimir_ask`: return cited retrieval context.
- `mimir_research`: run audit-backed multi-query retrieval with source diagnostics and optional code matches.
- `mimir_audit`: compare source files with the current index.
- `mimir_evaluate`: measure retrieval recall against a local golden query file.
- `mimir_usage_report`: summarize metadata-only local access-log activity without query text or local paths.
- `mimir_security_audit`: inspect local privacy, provider, redaction, MCP, and gitignore posture.

Prefer MCP tools over shell commands when the agent runtime provides them. Use shell commands when MCP is unavailable.

MCP is read-focused and intentionally does not expose index deletion. Use `pnpm exec mimir
destroy-index --yes` from the shell when the user explicitly wants to remove the generated index.

## Optional Audio Summaries

If the user asks for a listenable or TTS summary, load the optional
`.mimir/skills/mimir-audio-summary/` skill installed by `pnpm exec mimir setup`.

The audio skill should:

- gather evidence through Mimir first;
- write narration text only to a temp file outside the repository;
- render generated audio under `.mimir/audio/` by default;
- prefer offline TTS engines for confidential content.

## Optional Markdown Reports

If the user asks for a Markdown report, dossier, audit memo, planning note, or decision brief, load
the optional `.mimir/skills/mimir-markdown-report/` skill installed by `pnpm exec mimir setup`.

The report skill should:

- gather evidence through multiple Mimir searches first;
- cite source paths and chunk numbers;
- separate facts, inference, uncertainty, and missing evidence;
- write reports under `.mimir/reports/` by default;
- keep generated reports uncommitted unless the user explicitly wants a sanitized tracked report.

## Installing This Skill Into A Repository

Most repositories should run the full setup command:

```bash
pnpm exec mimir setup
```

Use the lower-level skill installer only when Mimir is already initialized and you want to refresh
the local agent kit:

```bash
pnpm exec mimir install-skill
pnpm exec mimir install-skill --agents claude,codex --mcp-command ./scripts/serve-mcp.sh
```

This creates:

```plain text
.mimir/skills/mimir/SKILL.md
.mimir/skills/mimir-audio-summary/SKILL.md
.mimir/skills/mimir-markdown-report/SKILL.md
.mimir/skills/mimir-legal-dossier/SKILL.md
.mimir/mcp.json
.mimir/claude-mcp-server.json
.mimir/codex-mcp.toml
.mimir/kimi-mcp.json
.mimir/opencode.jsonc
.mimir/cline-mcp.json
.mimir/agent-setup.md
.mimir/README.md
```

When `--agents` is used, only the selected agent-specific MCP helpers are written, and stale
unselected helpers in `.mimir/` are removed.

For native discovery, install only the agent the user uses:

```bash
pnpm exec mimir install-agent --agents claude
pnpm exec mimir install-agent --agents kimi
pnpm exec mimir install-agent --agents claude,codex,kimi,opencode,cline
```

By default this writes project-scope skill folders such as `.claude/skills/`, `.kimi/skills/`,
`.opencode/skills/`, or `.cline/skills/` as links back to `.mimir/skills/`. That keeps one original
skill source. Add `--scope user` for global installs, or `--mode copy` only when an agent/runtime
cannot follow symlinked skill directories.

Agents that understand skill folders can load `.mimir/skills/mimir/` directly when native discovery
is not installed. Other agents can read `.mimir/README.md` and `.mimir/mcp.json`.

## Answer Style

When answering from Mimir:

- mention the source file paths and chunk/source labels when useful;
- distinguish facts found in documents from inference;
- keep operational/legal/financial claims conservative;
- recommend ingesting or providing missing documents when the index is incomplete.
