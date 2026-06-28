# Mimir Core Package

`@jcode.labs/mimir` is the core Mimir package: CLI, library, MCP server, bundled agent skills, and
synthetic examples for sovereign local RAG.

**Full documentation:** https://github.com/jcode-works/jcode-mimir#readme

This npm README is intentionally short because package READMEs are displayed separately on npm. The
GitHub root README is the canonical product documentation.

## Install

```bash
pnpm add -D @jcode.labs/mimir
```

## Quick Commands

```bash
pnpm exec kb init
pnpm exec kb doctor
pnpm exec kb ingest
pnpm exec kb search "your question"
pnpm exec kb ask "your question"
pnpm exec kb install-skill
```

## Entry Points

- CLI: `kb`
- Library import: `@jcode.labs/mimir`
- MCP server: `pnpm exec kb serve-mcp`
- Bundled skills: `pnpm exec kb install-skill`

## License

MIT (c) Jean-Baptiste Thery.
