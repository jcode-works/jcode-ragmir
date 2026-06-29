# Mimir Core Package

`@jcode.labs/mimir` is Mimir Core, the technical core package for Mimir, an open-source sovereign local RAG toolkit for
confidential datasets and AI agents.

**Full documentation:** https://github.com/jcode-works/jcode-mimir#readme

This npm README is intentionally short because package READMEs are displayed separately on npm. The
GitHub root README is the canonical product documentation.

## What It Does

Mimir lets a Node.js repository keep a local knowledge base next to its private documents. It indexes
supported local files, stores the generated retrieval index in the target repository, and exposes the
same evidence through:

- the `kb` CLI;
- a TypeScript library API;
- a local MCP stdio server for compatible AI agents;
- portable agent skills copied by `kb setup`, including audio and Markdown-report workflows.

Mimir does not send documents to a hosted RAG service and does not generate final LLM answers in
core. It returns cited retrieval context so the agent or model you trust can write from local
evidence.

## Use It For

- private project, legal, operational, research, or institutional dossiers;
- codebase and architecture context retrieval;
- local-first agent workflows with bounded MCP access;
- cited summaries, audits, briefs, and decision support.

## Install

```bash
pnpm add -D @jcode.labs/mimir
```

## Quick Start

```bash
pnpm exec kb setup
pnpm exec kb search "your question"
pnpm exec kb ask "your question"
```

By default, Mimir indexes documents from `private/`, reports unsupported/skipped files during
ingestion, stores generated state under `.kb/`, and keeps agent integration files under `.mimir/`.
`kb setup` adds the matching Git ignore entries for local generated and private data.

Run `pnpm exec kb doctor --fix` later to repair missing setup or rebuild stale indexes.

## Entry Points

- CLI: `kb`
- Library import: `@jcode.labs/mimir`
- MCP server: `pnpm exec kb serve-mcp`
- Bundled skills: `pnpm exec kb setup` or `pnpm exec kb install-skill`

## Claude Code And Codex

After `pnpm exec kb setup`, use `pnpm exec kb install-agent --agents claude`, `--agents kimi`, or a
comma-separated list for native agent skill discovery. Native agent folders link back to
`.mimir/skills/` by default so there is one original skill source. Mimir Core also generates MCP
helpers for Claude Code, Codex, Kimi, OpenCode, and Cline under `.mimir/`. See the canonical GitHub
README for the full agent demo.

## License

MIT (c) Jean-Baptiste Thery.
