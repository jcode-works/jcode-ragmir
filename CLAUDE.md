# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` is the authoritative source for shared rules — working rules, coding conventions, and
high-level architecture. Read it first. This file adds only the Claude Code operational details and
non-obvious traps that matter when editing here, without duplicating `AGENTS.md`.

## Commands

```bash
pnpm build              # builds UI, app frontend, landing, TTS, then Mimir Core
pnpm check              # typecheck UI/app/landing/TTS/core
pnpm dev:app            # run the Vite frontend for the Tauri shell
pnpm dev:landing        # run the Astro landing locally
pnpm lint               # Biome CI (format + lint check, no writes)
pnpm lint:fix           # Biome auto-fix
pnpm format             # Biome format --write
pnpm test               # vitest run for packages/mimir-tts, then packages/mimir-core
pnpm smoke              # build production CLI + MCP smoke test (scripts/smoke.mjs)
pnpm audit:security     # dependency security audit at moderate severity and above
pnpm release:semantic:smoke # checks semantic-release config and monorepo publish scripts without publishing
pnpm validate           # full release gate: lint + audit + check + test + build + smoke + package:check + semantic release smoke + release:artifacts
```

Run a single core test file: `pnpm --filter @jcode.labs/mimir exec vitest run src/config.test.ts`
Run a single core test by name: `pnpm --filter @jcode.labs/mimir exec vitest run -t "applies env overrides"`
Run only the TTS package tests: `pnpm --filter @jcode.labs/mimir-tts test`

Tests are colocated as `packages/*/src/*.test.ts` and run on the TypeScript sources.

## Committed `dist/` — critical

`packages/mimir-core/dist/` and `packages/mimir-tts/dist/` are checked into Git. CI enforces
`git diff --exit-code -- packages/mimir-core/dist packages/mimir-tts/dist`. After any change under
`packages/mimir-core/src/` or `packages/mimir-tts/src/`, run `pnpm build` and commit the regenerated
output in the same commit, or CI fails. This is the single easiest mistake to make in this repo.
`packages/mimir-app/dist/` and `packages/mimir-landing/dist/` are build artifacts and stay ignored.

## Naming map (the package has several names on purpose)

- Product name: **Mimir** on the landing, app, README title, and user-facing copy.
- Core package: **Mimir Core**, published as `@jcode.labs/mimir` from `packages/mimir-core`.
- TTS package: **Mimir TTS**, published as `@jcode.labs/mimir-tts`.
- UI package: **Mimir UI**, unpublished workspace package `@jcode.labs/mimir-ui`.
- Landing package: unpublished workspace package `@jcode.labs/mimir-landing`.
- App package: unpublished workspace package `@jcode.labs/mimir-app`.
- CLI binary: **`mimir`** (`packages/mimir-core/bin.mimir` -> `packages/mimir-core/dist/cli.js`).
  The `kb` binary remains only as a legacy compatibility alias. Commands: `init`, `ingest`,
  `models pull`, `search`, `ask`, `audit`, `status`, `security-audit`, `destroy-index`, `audio`,
  `doctor`, `serve-mcp`, `skill-path`, `install-skill`.
- TTS CLI binary: **`mimir-tts`** (`packages/mimir-tts/dist/cli.js`). Commands: `doctor`, `render`.
- Project config/state in the target repo: **`.mimir/`** (`config.json`, `sources.txt`, `raw/`,
  `storage/`, `access.log`, `skills/`, reports, audio, and model caches). **`.kb/`** and
  **`private/`** are legacy compatibility paths only.
- Environment overrides: **`MIMIR_*`** (e.g. `MIMIR_EMBEDDING_PROVIDER`, `MIMIR_CHUNK_SIZE`).
  **`KB_*`** aliases remain only for existing automation.
- MCP tools exposed to agents: **`mimir_*`** (`mimir_status`, `mimir_search`, `mimir_ask`,
  `mimir_audit`, `mimir_security_audit`).

## Architecture and data flow

This is a pnpm workspace monorepo. `packages/mimir-core` and `packages/mimir-tts` are the published
npm packages. `packages/mimir-ui`, `packages/mimir-landing`, and `packages/mimir-app` are
unpublished workspace packages for product surfaces. Do not add Turbo unless `pnpm --filter` stops
being enough.
`@jcode.labs/mimir` depends on `@jcode.labs/mimir-tts` (`workspace:*`), so release builds still keep
TTS and core in sync.

The core package is an ESM-only TypeScript library + CLI + MCP server. Same core, three entry
points: `packages/mimir-core/src/cli.ts` (commander), `packages/mimir-core/src/index.ts` (public library
exports), `packages/mimir-core/src/mcp.ts` (stdio MCP server).

The ingest pipeline (`packages/mimir-core/src/ingest.ts`) chains single-responsibility modules:
`files.ts` (discover supported files via fast-glob, with sha256 checksums) →
`parsing.ts` (extract text per format: PDF/Office/HTML/etc.) →
`redaction.ts` (strip secrets/PII *before* anything is embedded) →
`chunking.ts` (split into overlapping chunks) →
`embeddings.ts` (vectorize) → `store.ts` (LanceDB). `query.ts` embeds the query, combines vector
candidates with bounded lexical BM25 scoring, and `ask` returns cited passages only (no LLM
synthesis in core).

`packages/mimir-tts` is a separate ESM package. It defaults to Transformers.js for offline WAV
rendering without Python or ffmpeg, and uses `edge-tts` for high-quality MP3 only when explicitly
requested. Core `mimir audio` imports it dynamically.

`packages/mimir-ui` is the shared Tailwind 4 + React UI layer adapted from the WorkoutGen UI/landing
foundation, but with Mimir tokens and no WorkoutGen product copy, analytics, CDN paths, or secrets.
`packages/mimir-landing` is an Astro static site using that UI package. `packages/mimir-app` is a
Tauri v2 shell using the same UI package; root build validates its Vite frontend, while native Tauri
desktop/mobile builds are explicit `pnpm --filter @jcode.labs/mimir-app tauri:*` commands.

Key behaviors to keep in mind before editing:

- **Config resolution is caller-relative.** `loadConfig` walks up from `cwd` looking for
  `.mimir/config.json`, with fallback to legacy `.kb/config.json`. The package must resolve project
  data from the caller's working directory, never from its own install path. Zod validates config;
  `MIMIR_*` env vars override, with `KB_*` kept as legacy aliases.
- **Two embedding providers, not interchangeable at runtime.** `local-hash` (default) is a 384-dim
  sha256 lexical embedding — fully offline, no model, *not semantic*. `transformers` lazily
  `import()`s `@huggingface/transformers` with `allowRemoteModels` off by default. `mimir models pull`
  is the explicit one-time remote-download path for preloading the configured embedding model. The
  two providers produce different vectors, so **switching providers requires `mimir ingest --rebuild`**.
- **Ingest is incremental by default.** It reuses rows whose checksum, embedding provider, and model
  still match, then overwrites the LanceDB table with reused + rebuilt rows. Use `--rebuild` to force
  every supported file through parsing, redaction, chunking, and embedding again.
- **Privacy is a feature, not a side effect.** Redaction runs before embedding, the access log stores
  query hashes/metadata only (`access-log.ts`), MCP top-K is clamped to `mcpMaxTopK`, and
  `gitignore.ts` keeps `.mimir/` ignored in target repos. `security-audit` also preserves legacy
  warnings when a project still uses `.kb/` or `private/**`. Preserve these guarantees.

Coding conventions (KISS, DRY, YAGNI, SOLID as applied here) live in `AGENTS.md`.

## Toolchain constraints

- Strict TypeScript (`tsconfig.base.json`) with `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noUnusedLocals`, and `noUnusedParameters`; module mode is `NodeNext`,
  so relative imports use `.js` extensions even from `.ts` sources.
- Biome is the formatter and linter (not ESLint/Prettier): 2-space indent, width 100, double quotes,
  semicolons as-needed, trailing commas all.
- Conventional Commits are enforced by commitlint in CI.

Release policy (no local publish, no direct push to `main`, protected semantic-release workflow)
lives in `AGENTS.md`. The workflow publishes `@jcode.labs/mimir-tts` before `@jcode.labs/mimir`.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **jcode-mimir** (2559 symbols, 4274 relationships, 218 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/jcode-mimir/context` | Codebase overview, check index freshness |
| `gitnexus://repo/jcode-mimir/clusters` | All functional areas |
| `gitnexus://repo/jcode-mimir/processes` | All execution flows |
| `gitnexus://repo/jcode-mimir/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
