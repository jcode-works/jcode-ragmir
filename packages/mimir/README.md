# Mimir Core Package

`@jcode.labs/mimir` is the core package for Mimir, an open-source sovereign local RAG toolkit for
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
- portable agent skills copied with `kb install-skill`.

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
pnpm exec kb init
pnpm exec kb doctor
pnpm exec kb ingest
pnpm exec kb search "your question"
pnpm exec kb ask "your question"
pnpm exec kb install-skill
```

By default, Mimir indexes documents from `private/`, stores generated state under `.kb/`, and keeps
agent integration files under `.mimir/`. `kb init` adds the matching Git ignore entries for local
generated and private data.

## Entry Points

- CLI: `kb`
- Library import: `@jcode.labs/mimir`
- MCP server: `pnpm exec kb serve-mcp`
- Bundled skills: `pnpm exec kb install-skill`

## License

MIT (c) Jean-Baptiste Thery.
