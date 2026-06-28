# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` is the authoritative source for shared rules — working rules, coding conventions, and
high-level architecture. Read it first. This file adds only the Claude Code operational details and
non-obvious traps that matter when editing here, without duplicating `AGENTS.md`.

## Commands

```bash
pnpm build              # builds packages/mimir-tts, then packages/mimir; package dist is committed
pnpm check              # typecheck only (tsc --noEmit)
pnpm lint               # Biome CI (format + lint check, no writes)
pnpm lint:fix           # Biome auto-fix
pnpm format             # Biome format --write
pnpm test               # vitest run for packages/mimir-tts, then packages/mimir
pnpm smoke              # build production CLI + MCP smoke test (scripts/smoke.mjs)
pnpm validate           # full release gate: lint + check + test + build + smoke + package:check + release:artifacts
```

Run a single core test file: `pnpm --filter @jcode.labs/mimir exec vitest run src/config.test.ts`
Run a single core test by name: `pnpm --filter @jcode.labs/mimir exec vitest run -t "applies env overrides"`
Run only the TTS package tests: `pnpm --filter @jcode.labs/mimir-tts test`

Tests are colocated as `packages/*/src/*.test.ts` and run on the TypeScript sources.

## Committed `dist/` — critical

`packages/mimir/dist/` and `packages/mimir-tts/dist/` are checked into Git. CI enforces
`git diff --exit-code -- packages/mimir/dist packages/mimir-tts/dist`. After any change under
`packages/mimir/src/` or `packages/mimir-tts/src/`, run `pnpm build` and commit the regenerated
output in the same commit, or CI fails. This is the single easiest mistake to make in this repo.

## Naming map (the package has several names on purpose)

- Product / core package: **Mimir**, published as `@jcode.labs/mimir` from `packages/mimir`.
- TTS package: **Mimir TTS**, published as `@jcode.labs/mimir-tts`.
- CLI binary: **`kb`** (`packages/mimir/bin.kb` -> `packages/mimir/dist/cli.js`). Commands: `init`,
  `ingest`, `search`, `ask`, `audit`, `status`, `security-audit`, `destroy-index`, `audio`,
  `serve-mcp`, `skill-path`, `install-skill`.
- TTS CLI binary: **`mimir-tts`** (`packages/mimir-tts/dist/cli.js`). Commands: `doctor`, `render`.
- Project config/state in the target repo: **`.kb/`** (`config.json`, `sources.txt`, `access.log`,
  `storage/`), raw documents in **`private/`**, agent kit in **`.mimir/`**.
- Environment overrides: **`KB_*`** (e.g. `KB_EMBEDDING_PROVIDER`, `KB_CHUNK_SIZE`).
- MCP tools exposed to agents: **`mimir_*`** (`mimir_status`, `mimir_search`, `mimir_ask`,
  `mimir_audit`, `mimir_security_audit`).

## Architecture and data flow

This is a pnpm workspace monorepo with the core package in `packages/mimir` and TTS in
`packages/mimir-tts`. Do not add Turbo unless `pnpm --filter` stops being enough.

The core package is an ESM-only TypeScript library + CLI + MCP server. Same core, three entry
points: `packages/mimir/src/cli.ts` (commander), `packages/mimir/src/index.ts` (public library
exports), `packages/mimir/src/mcp.ts` (stdio MCP server).

The ingest pipeline (`packages/mimir/src/ingest.ts`) chains single-responsibility modules:
`files.ts` (discover supported files via fast-glob, with sha256 checksums) →
`parsing.ts` (extract text per format: PDF/Office/HTML/etc.) →
`redaction.ts` (strip secrets/PII *before* anything is embedded) →
`chunking.ts` (split into overlapping chunks) →
`embeddings.ts` (vectorize) → `store.ts` (LanceDB). `query.ts` embeds the query and runs vector
search; `ask` returns cited passages only (no LLM synthesis in core).

`packages/mimir-tts` is a separate ESM package that uses Transformers.js text-to-speech to render
WAV files without Python or ffmpeg. Core `kb audio` imports it dynamically.

Key behaviors to keep in mind before editing:

- **Config resolution is caller-relative.** `loadConfig` walks up from `cwd` looking for
  `.kb/config.json` (`findProjectRoot`). The package must resolve project data from the caller's
  working directory, never from its own install path. Zod validates config; `KB_*` env vars override.
- **Two embedding providers, not interchangeable at runtime.** `local-hash` (default) is a 384-dim
  sha256 lexical embedding — fully offline, no model, *not semantic*. `transformers` lazily
  `import()`s `@huggingface/transformers` with `allowRemoteModels` off by default. The two produce
  different vectors, so **switching providers requires a full re-ingest**.
- **Ingest always full-rebuilds** the LanceDB table (`mode: "overwrite"`). The `--rebuild` flag is a
  no-op kept for compatibility. There is no incremental indexing; `audit` only *reports* missing/stale
  files against the current index.
- **Privacy is a feature, not a side effect.** Redaction runs before embedding, the access log stores
  query hashes/metadata only (`access-log.ts`), MCP top-K is clamped to `mcpMaxTopK`, and
  `gitignore.ts` keeps `.kb/`, `.mimir/`, `private/**` ignored in target repos. `security-audit`
  reports this posture and `--strict` exits non-zero on warnings. Preserve these guarantees.

Coding conventions (KISS, DRY, YAGNI, SOLID as applied here) live in `AGENTS.md`.

## Toolchain constraints

- Strict TypeScript with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`; module mode is
  `NodeNext`, so relative imports use `.js` extensions even from `.ts` sources.
- Biome is the formatter and linter (not ESLint/Prettier): 2-space indent, width 100, double quotes,
  semicolons as-needed, trailing commas all.
- Conventional Commits are enforced by commitlint in CI.

Release policy (no local publish, no direct push to `main`, protected `Publish npm` workflow) lives
in `AGENTS.md`. The workflow publishes `@jcode.labs/mimir-tts` before `@jcode.labs/mimir`.
