# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` is the authoritative source for shared rules — working rules, coding conventions, and
high-level architecture. Read it first. This file adds only the Claude Code operational details and
non-obvious traps that matter when editing here, without duplicating `AGENTS.md`.

## Branches, PRs, and releases — confirm first

Never create, rename, switch, or reset a branch, open or merge a PR, or trigger a release / npm
publish on your own. Ask for explicit confirmation (naming the exact branch and base), and follow the
Git Flow in `AGENTS.md`: `feature/*` off `develop`, PR into `develop`, release PR `develop` → `main`.
`main` and `develop` are protected (PR + green Quality gate, Commitlint, Analyze TypeScript). Reuse a
branch the user already approved instead of spawning new ones. Full rules: "AI Coding Agent
Guardrails" in `AGENTS.md`.

## Commands

```bash
pnpm bootstrap          # mise install (pinned Node/Rust) && pnpm install
pnpm build              # builds UI, app frontend, landing, TTS, chat, then Ragmir Core
pnpm check              # typecheck UI/app/landing/TTS/chat/core
pnpm dev:app            # run the Vite frontend for the Tauri shell
pnpm dev:landing        # run the Astro landing locally
pnpm example            # build core + run the library-API smoke against the local build (examples/library-api-demo)
pnpm lint               # Biome CI (format + lint check, no writes)
pnpm lint:fix           # Biome auto-fix
pnpm format             # Biome format --write
pnpm test               # vitest run for packages/ragmir-tts, packages/ragmir-chat, then packages/ragmir-core
pnpm smoke              # build production CLI + MCP smoke test (scripts/smoke.mjs)
pnpm audit:security     # dependency security audit at moderate severity and above
pnpm release:semantic:smoke # checks semantic-release config and monorepo publish scripts without publishing
pnpm validate           # full release gate: lint + audit + check + test + build + smoke + package:check + semantic release smoke + release:artifacts
```

Run a single core test file: `pnpm --filter @jcode.labs/ragmir exec vitest run src/config.test.ts`
Run a single core test by name: `pnpm --filter @jcode.labs/ragmir exec vitest run -t "applies env overrides"`
Run only the TTS package tests: `pnpm --filter @jcode.labs/ragmir-tts test`
Run only the chat package tests: `pnpm --filter @jcode.labs/ragmir-chat test`

Tests are colocated as `packages/*/src/*.test.ts` and run on the TypeScript sources.

## `dist/` is gitignored build output — critical

All `packages/*/dist/` directories (`ragmir-core`, `ragmir-tts`, `ragmir-chat`, `ragmir-app`,
`ragmir-landing`, `ragmir-license-webhook`) are gitignored build output and are NOT checked into Git.
Build them locally with `pnpm build` before running the CLI, MCP smoke, the library-API demo, or
`pnpm validate`. CI rebuilds `dist/` from source in the `Build` step before smoke tests, and the
release pipeline rebuilds the published package directories in order
(`packages/ragmir-tts`, `packages/ragmir-chat`, then `packages/ragmir-core`) before
`pnpm pack`/`publish`, so the published npm tarball always contains freshly built output. Never
commit `dist/`; a clean clone has none until `pnpm build` runs.

## Naming map (the package has several names on purpose)

- Product name: **Ragmir** on the landing, app, README title, and user-facing copy.
- Core package: **Ragmir Core**, published as `@jcode.labs/ragmir` from `packages/ragmir-core`.
- TTS package: **Ragmir TTS**, published as `@jcode.labs/ragmir-tts`.
- Chat package: **Ragmir Chat**, published as `@jcode.labs/ragmir-chat`.
- UI package: **Ragmir UI**, unpublished workspace package `@jcode.labs/ragmir-ui`.
- Landing package: unpublished workspace package `@jcode.labs/ragmir-landing`.
- App package: unpublished workspace package `@jcode.labs/ragmir-app`.
- CLI binary: **`rgr`** (`packages/ragmir-core/bin.rgr` -> `packages/ragmir-core/dist/cli.js`).
  `ragmir` and `kb` remain deprecated compatibility bins that warn users to migrate to `rgr`.
  Commands: `init`, `setup`, `ingest`, `sources add`, `sources list`, `models pull`, `search`,
  `ask`, `chat`, `research`, `route-prompt`, `evaluate`, `audit`, `usage-report`, `status`,
  `security-audit`, `destroy-index`, `audio`, `doctor`, `serve-mcp`, `skill-path`,
  `install-skill`, `install-agent`.
- TTS CLI binary: **`rgr-tts`** (`packages/ragmir-tts/bin.rgr-tts` -> `packages/ragmir-tts/dist/cli.js`).
  `ragmir-tts` remains a deprecated compatibility bin. Commands: `doctor`, `render`.
- Chat CLI binary: **`rgr-chat`** (`packages/ragmir-chat/bin.rgr-chat` ->
  `packages/ragmir-chat/dist/cli.js`). `ragmir-chat` remains a deprecated compatibility bin.
  Commands: `doctor`, `setup`, `answer`.
- Project config/state in the target repo: **`.ragmir/`** (`config.json`, `raw/`, `storage/`,
  `access.log`, `skills/`, reports, audio, and model caches).
- Environment overrides: **`RAGMIR_*`** (e.g. `RAGMIR_EMBEDDING_PROVIDER`, `RAGMIR_CHUNK_SIZE`).
- MCP tools exposed to agents: **`ragmir_*`** (`ragmir_status`, `ragmir_search`, `ragmir_ask`,
  `ragmir_research`, `ragmir_route_prompt`, `ragmir_audit`, `ragmir_evaluate`,
  `ragmir_usage_report`, `ragmir_security_audit`).

## Architecture and data flow

This is a pnpm workspace monorepo. `packages/ragmir-core`, `packages/ragmir-tts`, and
`packages/ragmir-chat` are the published npm packages. `packages/ragmir-ui`,
`packages/ragmir-landing`, and `packages/ragmir-app` are
unpublished workspace packages for product surfaces. Do not add Turbo unless `pnpm --filter` stops
being enough.
`@jcode.labs/ragmir` depends on `@jcode.labs/ragmir-tts` and `@jcode.labs/ragmir-chat`
(`workspace:*`), so release builds still keep TTS, chat, and core in sync.

The core package is an ESM-only TypeScript library + CLI + MCP server. Same core, three entry
points: `packages/ragmir-core/src/cli.ts` (commander), `packages/ragmir-core/src/index.ts` (public library
exports), `packages/ragmir-core/src/mcp.ts` (stdio MCP server).

The ingest pipeline (`packages/ragmir-core/src/ingest.ts`) chains single-responsibility modules:
`files.ts` (discover supported files via fast-glob, with sha256 checksums) →
`parsing.ts` (extract text per format: PDF/Office/HTML/etc.) →
`redaction.ts` (strip secrets/PII *before* anything is embedded) →
`chunking.ts` (split into overlapping chunks) →
`embeddings.ts` (vectorize) → `store.ts` (LanceDB). `query.ts` embeds the query, combines vector
candidates with bounded lexical BM25 scoring, and `ask` returns cited passages only (no LLM
synthesis in core).

`packages/ragmir-tts` is a separate ESM package. It defaults to Transformers.js for offline WAV
rendering without Python or ffmpeg, and uses `edge-tts` for high-quality MP3 only when explicitly
requested. Core `rgr audio` imports it dynamically.

`packages/ragmir-chat` is a separate ESM package. It owns local Transformers.js text generation for
`rgr chat`; Ragmir Core retrieves cited passages and passes them in. Keep the core retrieval-only and
do not introduce an Ollama or hosted-model dependency for chat.

`packages/ragmir-ui` is the shared Tailwind 4 + React UI layer adapted from the WorkoutGen UI/landing
foundation, but with Ragmir tokens and no WorkoutGen product copy, analytics, CDN paths, or secrets.
`packages/ragmir-landing` is an Astro static site using that UI package. `packages/ragmir-app` is a
Tauri v2 shell using the same UI package; root build validates its Vite frontend, while native Tauri
desktop/mobile builds are explicit `pnpm --filter @jcode.labs/ragmir-app tauri:*` commands.

Key behaviors to keep in mind before editing:

- **Config resolution is caller-relative.** `loadConfig` walks up from `cwd` looking for
  `.ragmir/config.json`. The package must resolve project data from the caller's working directory,
  never from its own install path. Zod validates config; `RAGMIR_*` env vars override config.
- **Two embedding providers, not interchangeable at runtime.** `local-hash` (default) is a 384-dim
  sha256 lexical embedding — fully offline, no model, *not semantic*. `transformers` lazily
  `import()`s `@huggingface/transformers` with `allowRemoteModels` off by default. `rgr models pull`
  and `rgr setup --semantic` are the explicit one-time remote-download paths for preloading the
  configured embedding model. The two providers produce different vectors, so **switching providers
  requires `rgr ingest --rebuild`**.
- **Ingest is incremental by default.** It reuses rows whose checksum, embedding provider, and model
  still match, then overwrites the LanceDB table with reused + rebuilt rows. Use `--rebuild` to force
  every supported file through parsing, redaction, chunking, and embedding again.
- **Privacy is a feature, not a side effect.** Redaction runs before embedding, the access log stores
  query hashes/metadata only (`access-log.ts`), MCP top-K is clamped to `mcpMaxTopK`, and
  `gitignore.ts` keeps `.ragmir/` ignored in target repos. Preserve these guarantees.

Coding conventions (KISS, DRY, YAGNI, SOLID as applied here) live in `AGENTS.md`.

## Toolchain constraints

- Strict TypeScript (`tsconfig.base.json`) with `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noUnusedLocals`, and `noUnusedParameters`; module mode is `NodeNext`,
  so relative imports use `.js` extensions even from `.ts` sources.
- Biome is the formatter and linter (not ESLint/Prettier): 2-space indent, width 100, double quotes,
  semicolons as-needed, trailing commas all.
- Conventional Commits are enforced by commitlint in CI.

Release policy (no local publish, no direct push to `main`, protected semantic-release workflow)
lives in `AGENTS.md`. The workflow publishes `@jcode.labs/ragmir-tts` and
`@jcode.labs/ragmir-chat` before `@jcode.labs/ragmir`.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **jcode-ragmir** (2311 symbols, 4841 relationships, 190 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/jcode-ragmir/context` | Codebase overview, check index freshness |
| `gitnexus://repo/jcode-ragmir/clusters` | All functional areas |
| `gitnexus://repo/jcode-ragmir/processes` | All execution flows |
| `gitnexus://repo/jcode-ragmir/process/{name}` | Step-by-step execution trace |

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
