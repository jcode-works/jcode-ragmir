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

- the `mimir` CLI (`kb` remains a legacy alias);
- a TypeScript library API;
- a local MCP stdio server for compatible AI agents;
- portable agent skills copied by `mimir setup`, including audio, Markdown-report, and legal-dossier
  workflows.

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
pnpm exec mimir setup
pnpm exec mimir search "your question"
pnpm exec mimir ask "your question"
```

By default, Mimir keeps local config, raw documents, generated indexes, access logs, models, reports,
audio, and agent helper files under a single ignored `.mimir/` project folder. It reports
unsupported/skipped files during ingestion and reports supported files that produced no extractable
text. `mimir setup` adds the matching Git ignore entry for local Mimir state.

Run `pnpm exec mimir doctor --fix` later to repair missing setup or rebuild stale indexes.
For better semantic Q&A, run `pnpm exec mimir models pull --enable`, then run
`pnpm exec mimir ingest --rebuild`.

## Entry Points

- CLI: `mimir`
- Library import: `@jcode.labs/mimir`
- MCP server: `pnpm exec mimir serve-mcp`
- Bundled skills: `pnpm exec mimir setup` or `pnpm exec mimir install-skill`

The public TypeScript API reference is maintained in the root repository at
[`docs/api-reference.md`](https://github.com/jcode-works/jcode-mimir/blob/main/docs/api-reference.md).

## Claude Code And Codex

After `pnpm exec mimir setup`, use `pnpm exec mimir install-agent --agents claude`, `--agents kimi`, or a
comma-separated list for native agent skill discovery. Native agent folders link back to
`.mimir/skills/` by default so there is one original skill source. Mimir Core also generates MCP
helpers for Claude Code, Codex, Kimi, OpenCode, and Cline under `.mimir/`. See the canonical GitHub
README for the full agent demo.

## License

MIT (c) Jean-Baptiste Thery.
