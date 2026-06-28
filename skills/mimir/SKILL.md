---
name: mimir
description: Use this skill whenever a repository uses or should use Mimir, local-first RAG, private project knowledge, document ingestion, knowledge-base audit, or MCP access to project documents. Use it before answering from memory when the user asks about facts that may be present in private files, asks to ingest/query/audit documents, or wants Claude, Codex, Cursor, or another AI agent to use the same local knowledge base.
---

# Mimir

Mimir is a local-first knowledge base for project documents. It indexes files from the current repository, stores vectors locally, and exposes both a CLI and an MCP server.

Use this skill to help an AI agent work with a Mimir-enabled repository without leaking private documents or relying on stale memory.

## Core Rule

Treat the repository where the user is working as the source of truth. Mimir data belongs to that repository, not to the installed npm package.

Default project layout:

```plain text
private/          # raw documents to ingest
.kb/config.json   # local Mimir config
.kb/sources.txt   # optional extra source paths
.kb/storage/      # generated local index
.kb/access.log    # metadata-only access log
```

## Data Safety

- Do not commit raw documents, secrets, tax IDs, scans, bank documents, tokens, or generated vector stores.
- Keep `private/**`, `.kb/`, and `.mimir/` ignored by Git.
- Treat `kb search`, `kb ask`, and MCP results as sensitive because they can contain private
  source passages even when redaction is enabled.
- Prefer summaries and citations over dumping long private passages into the chat.
- If the user asks for a high-stakes answer, identify which facts came from Mimir and which still require professional or official verification.

## First Checks

From the repository root:

```bash
pnpm exec kb status
pnpm exec kb security-audit
```

If Mimir is not installed:

```bash
pnpm add -D @jcode.labs/mimir
pnpm exec kb init
```

If the package manager is npm:

```bash
npm install --save-dev @jcode.labs/mimir
npx kb init
```

## Ingestion Workflow

After documents are added or changed:

```bash
pnpm exec kb ingest
pnpm exec kb audit
pnpm exec kb security-audit
pnpm exec kb status
```

The audit must show no missing or stale supported files before relying on the index. The security
audit should not show warnings before relying on Mimir for sensitive work.

## Query Workflow

Use search when you need exact source passages:

```bash
pnpm exec kb search "your query"
```

Use ask when you need a synthesized answer with citations:

```bash
pnpm exec kb ask "your question"
```

Ground answers in returned sources. If search results are weak, say that the current index does not prove the point and ask for the missing document.

## MCP Usage

If the agent supports MCP, configure a server for the repository:

```json
{
  "mcpServers": {
    "mimir": {
      "command": "pnpm",
      "args": ["exec", "kb", "serve-mcp"],
      "cwd": "/absolute/path/to/the/repository"
    }
  }
}
```

Available MCP tools:

- `mimir_status`: show config and chunk count.
- `mimir_search`: retrieve source passages.
- `mimir_ask`: synthesize an answer with local citations.
- `mimir_audit`: compare source files with the current index.
- `mimir_security_audit`: inspect local privacy, network, redaction, MCP, and gitignore posture.

Prefer MCP tools over shell commands when the agent runtime provides them. Use shell commands when MCP is unavailable.

MCP is read-focused and intentionally does not expose index deletion. Use `pnpm exec kb
destroy-index --yes` from the shell when the user explicitly wants to remove the generated index.

## Installing This Skill Into A Repository

Run:

```bash
pnpm exec kb install-skill
```

This creates:

```plain text
.mimir/skills/mimir/SKILL.md
.mimir/mcp.json
.mimir/README.md
```

Agents that understand skill folders can load `.mimir/skills/mimir/`. Other agents can read `.mimir/README.md` and `.mimir/mcp.json`.

## Answer Style

When answering from Mimir:

- mention the source file paths and chunk/source labels when useful;
- distinguish facts found in documents from inference;
- keep operational/legal/financial claims conservative;
- recommend ingesting or providing missing documents when the index is incomplete.
