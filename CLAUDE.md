@AGENTS.md

## Claude Code

- `.claude/settings.json` is shared. It allows the routine checks without prompts, keeps `.env`
  files and `private/` unreadable, and runs two hooks on Edit and Write. `guard-edits.mjs` blocks
  build output, lockfiles, local Ragmir state, and the exact copies listed in
  `.claude/hooks/copies.mjs`; `after-edit.mjs` refreshes those copies from their source, formats
  the file with Biome (or Ruff once `python/.venv` exists), and reports what Biome cannot fix.
- Rules in `.claude/rules/` load with the files they cover: Core, landing, Python, public
  documentation, and release automation.
- Project skills: `add-file-format` and `release-ragmir`. The skills users install live in
  `skills/`; change the retrieval skill in `packages/ragmir-core/skills/ragmir/` only.
- `.mcp.json` declares this repository's own Ragmir server. Approve it once the Core build and
  `pnpm rgr ingest` have run, then use `ragmir_search` and `ragmir_expand` on the code and docs.
- Use plan mode before changing the index layout, the MCP tool contract, or release automation.
- Keep personal settings in `.claude/settings.local.json` and notes in `CLAUDE.local.md`; Git
  ignores both. Run `/doctor prompt-audit` after editing these instruction files.
