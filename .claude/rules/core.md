---
paths:
  - "packages/ragmir-core/**"
---

# Ragmir Core

- Tests sit next to the code as `src/*.test.ts`. Run one file with
  `pnpm --filter @jcode.labs/ragmir test src/<name>.test.ts` (it builds first, because CLI and MCP
  tests run `dist/`), and type-check with `pnpm --filter @jcode.labs/ragmir check`.
- Validate external input at the boundary with Zod or the CLI parser. Prefer type guards to casts
  and named exports to defaults. Only `cli.ts` writes to stdout or stderr; library modules return
  values or throw `RagmirError` with a code.
- Every public export is part of the npm API: keep `tests/public-api-consumer` compiling
  (`pnpm api:check`) and `pnpm knip` clean. Remove unused exports instead of ignoring them.
- A change to parsing, chunking, or extraction output must bump `parserVersion` in
  `src/index-policy.ts`, so existing indexes stage a validated rebuild instead of mixing policies.
  Never make an upgrade depend on deleting `.ragmir/storage/`.
- A new file format touches `src/files.ts`, the parser, `src/formats.test.ts`,
  `docs/supported-formats.md`, and the landing format list: follow the `add-file-format` skill.
- MCP tools live in `src/mcp.ts`. Keep them bounded by `maxBytes`, annotate read-only tools, and
  update `scripts/mcp-smoke.mjs` in this package, the root `scripts/smoke.mjs`,
  `src/context-resources.ts`, the agent guide, and the README when a tool or argument changes.
- Behavior visible to users (commands, options, configuration, formats, MCP tools) ships with its
  documentation in the same change: see the public documentation rule.
