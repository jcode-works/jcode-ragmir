# Ragmir Core Package

`@jcode.labs/ragmir` is Ragmir Core, the technical core package for Ragmir, an open-source local RAG
library, CLI, and MCP server. It indexes your specs, docs, and code locally and gives your AI agents
only the useful cited passages, over MCP, without burning tokens on your whole repo.

**Full documentation:** https://github.com/jcode-works/jcode-ragmir#readme

This npm README is intentionally short because package READMEs are displayed separately on npm. The
GitHub root README is the canonical product documentation.

## What It Does

Ragmir lets a Node.js repository keep a local knowledge base next to its private documents. It indexes
supported local files, stores the generated retrieval index in the target repository, and exposes the
same evidence through:

- the `ragmir` CLI (`kb` remains a legacy alias);
- a TypeScript library API;
- a local MCP stdio server for compatible AI agents;
- portable agent skills copied by `ragmir setup`, including audio, Markdown-report, and legal-dossier
  workflows.

Ragmir does not send documents to a hosted RAG service and does not generate final LLM answers in
core. It returns cited retrieval context so the agent or model you trust can write from local
evidence.

## Use It For

- private project, legal, operational, research, or institutional dossiers;
- codebase and architecture context retrieval;
- local-first agent workflows with bounded MCP access;
- cited summaries, audits, briefs, and decision support.

## Install

```bash
npm install --save-dev @jcode.labs/ragmir
```

## Quick Start

```bash
npx ragmir setup
npx ragmir install-agent --agents claude,codex,kimi,opencode,cline
npx ragmir doctor --fix

# Claude Code
claude mcp add-json --scope local ragmir "$(cat .ragmir/claude-mcp-server.json)"

# Codex
cat .ragmir/codex-mcp.toml

# Kimi Code CLI
kimi --mcp-config-file .ragmir/kimi-mcp.json

# OpenCode
cat .ragmir/opencode.jsonc

# Cline
cat .ragmir/cline-mcp.json
```

Use `npx ragmir setup --agents claude,codex --mcp-command ./scripts/serve-mcp.sh` when a
repository should generate only selected MCP helpers or launch through a local wrapper.

By default, Ragmir keeps local config, raw documents, generated indexes, access logs, models, reports,
audio, and agent helper files under a single ignored `.ragmir/` project folder. It reports
unsupported/skipped files during ingestion and reports supported files that produced no extractable
text. `ragmir setup` adds the matching Git ignore entry for local Ragmir state.

The primary workflow is agent-first: Claude Code, Codex, Kimi, OpenCode, Cline, or another
MCP-capable assistant asks Ragmir for cited local context, then writes or reasons from those
citations. For terminal checks, use `npx ragmir search "your question"` or
`npx ragmir ask "your question"`. For broader implementation or review work, use
`npx ragmir research "your topic" --compact` before asking the agent to synthesize.

Run `npx ragmir doctor --fix` later to repair missing setup or rebuild stale indexes.
For better semantic Q&A, run `npx ragmir models pull --enable`, then run
`npx ragmir ingest --rebuild`.

## Entry Points

- CLI: `ragmir`
- Library import: `@jcode.labs/ragmir`
- MCP server: `npx ragmir serve-mcp`
- Bundled skills: `npx ragmir setup` or `npx ragmir install-skill`

The public TypeScript API reference is maintained in the root repository at
[`docs/api-reference.md`](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/api-reference.md).

## Main Agent Setup

After `npx ragmir setup`, use `npx ragmir install-agent --agents claude`, `--agents kimi`,
`--agents cline`, or a comma-separated list for native agent skill discovery. Native agent folders
link back to `.ragmir/skills/` by default so there is one original skill source. Ragmir Core also
generates MCP helpers for Claude Code, Codex, Kimi, OpenCode, and Cline under `.ragmir/`. See the
canonical GitHub README for the full agent demo.

## License

MIT (c) Jean-Baptiste Thery.
