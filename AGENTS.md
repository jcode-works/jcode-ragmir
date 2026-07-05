# Ragmir

## Working Rules

- Speak with the user in French.
- Write code, identifiers, commit messages, filenames, and technical comments in English.
- Keep this repository free of private user documents, scans, tax identifiers, API keys,
  environment files, or generated vector stores.
- Keep public branding centered on `Ragmir`. Use JCode Labs and Jean-Baptiste Thery for
  package scope, repository ownership, and copyright, not as the product name.
- Use `Ragmir Core` only for the technical core package `@jcode.labs/ragmir` and developer-facing
  package metadata. User-facing product copy remains `Ragmir`; companion packages are Ragmir add-ons.
- The package is open source under the MIT License unless the user explicitly changes it.
- This package must stay reusable across repositories. Resolve project data from the
  caller's working directory or explicit config, not from the package installation path.
- The public CLI name is `rgr`. New docs, generated agent configs, landing command examples, and
  setup guidance should use `rgr ...` commands. `ragmir` and `kb` remain deprecated compatibility
  bins only and must warn users to migrate to `rgr`. User-facing product copy remains `Ragmir`.
- `rgr init` and `rgr install-skill` must keep generated local Ragmir state ignored in target
  repositories. By default, add one `.ragmir/` entry to the target repository `.gitignore`.
- Keep confidentiality features low-friction: local-hash retrieval by default, optional
  Transformers.js embeddings with remote model loading disabled by default, redaction before
  indexing, metadata-only access logs, bounded MCP retrieval, configurable text-extension ingestion,
  and `security-audit` should work from default config.
- Keep public positioning focused on sovereign local RAG for confidential datasets and AI agents.
  Avoid claiming universal binary-file support; unsupported proprietary formats need extraction or
  dedicated parsers.
- Keep FR/EU sovereignty, GDPR, AI Act, and legal-vertical claims bounded by
  `docs/fr-eu-sovereign-positioning.md`. Do not claim blanket compliance, legal advice, or regulated
  sovereignty certification without a separate review.
- Keep first-run UX centered on `rgr setup` for full onboarding and `rgr doctor --fix` for safe
  repairs. `rgr init`, `rgr install-skill`, and `rgr ingest` remain available as explicit
  lower-level commands.
- Keep monorepo source onboarding simple: the `sources` array in `.ragmir/config.json` accepts paths,
  glob patterns, and `!` exclusions, and `rgr sources add/list` read and write that array.
- Keep product documentation canonical in the root `README.md`. Package README files under
  `packages/*/README.md` are intentionally minimal npm entrypoints and must link clearly to the
  GitHub root README because npm displays package README files separately.
- Keep long operational references in `docs/` when the root README can link to them cleanly. The
  root README stays the canonical product entrypoint, not a dumping ground for every command table.
- Keep real-corpus dogfooding, business validation, pricing tests, customer ledgers, interview notes,
  generated JSON, reports, screenshots, paths, and client details outside Git. Commit only public-safe
  aggregate findings or synthetic reproductions.
- For private retrieval dogfooding, use `rgr evaluate --fail-under <recall>` as the local recall
  gate, and keep the real corpus, golden query files, and generated evaluation JSON outside Git.
- Use `rgr usage-report --days <n>` for metadata-only dogfooding summaries; do not read or commit
  raw access logs when an aggregate report is enough.
- Keep user-facing titles and marketing surfaces branded as `Ragmir`. Use `Ragmir Core` only for the
  technical core package and developer-facing metadata.
- Keep public repository surfaces safe to publish: no active checkout URLs, fake download/update URLs
  under real Ragmir domains, private documents, generated `.pid` files, committed secrets, internal
  GTM/pricing ledgers, or wording that presents tracked MIT source as proprietary or closed source.
  `pnpm public:smoke` enforces the cheap checks.
- The public-surface secret scanner (`scripts/public-surface-smoke.mjs`) runs over every tracked
  file, tests included. Never write literal secret-shaped strings in source — PEM `PRIVATE KEY`
  headers, `ghp_`/`github_pat_`/`sk_live_`/`sk_test_` tokens, or real checkout URLs. When a test
  needs one to exercise redaction or skipping, build it at runtime from parts (e.g. interpolate the
  `PRIVATE KEY` label from a variable) so no scannable literal is committed.
- Root `llms.txt` (the [llms.txt](https://llmstxt.org/) convention) and `context7.json` are the
  LLM/Context7-facing doc index for this repository. Update `llms.txt` when adding or removing a
  top-level `docs/*.md` file worth surfacing to agents, and keep `context7.json`'s
  `excludeFolders`/`excludeFiles` in sync with new generated-output or private-data directories.
  Registering the repo on context7.com (so it resolves through `resolve-library-id`) is a manual
  step on their site; these files only prepare the repo for that step.
- `packages/ragmir-ui` is the shared UI/style foundation adapted from the WorkoutGen landing/UI
  approach. It provides the common Tailwind theme and React primitives for both the landing and the
  Tauri app; do not import WorkoutGen product copy, assets, analytics, or secrets.
- Prefer the shared shadcn-style primitives from `packages/ragmir-ui` for landing and app surfaces.
  Tune reusable component variants or theme tokens before adding per-use raw color, typography, or
  shape overrides; primary buttons should stay rounded pill buttons.
- Keep shadcn CLI configuration explicit in `packages/ragmir-ui/components.json` and
  `packages/ragmir-landing/components.json`. Use `pnpm dlx shadcn@latest info -c
  packages/ragmir-ui` for shared primitives and `pnpm dlx shadcn@latest info -c
  packages/ragmir-landing` for the Astro landing surface; do not duplicate landing-local UI
  components when an export from `@jcode.labs/ragmir-ui` fits.
- `packages/ragmir-landing` is the Astro static landing package. It must stay telemetry-free by
  default; do not add PostHog. Run Astro through
  `packages/ragmir-landing/scripts/astro-no-telemetry.mjs` so local dev, check, preview, and build
  commands set `ASTRO_TELEMETRY_DISABLED=1`. If analytics are needed later, prefer Cloudflare Web
  Analytics.
- Keep Ragmir landing local ports separate from WorkoutGen's Astro landing defaults: `astro dev`
  uses port `4322`, and `astro preview` uses port `4323` through `packages/ragmir-landing/astro.config.mjs`.
- The landing hero displays `@jcode.labs/ragmir` npm downloads/month under the primary CTAs. Fetch it
  at Astro build time through `packages/ragmir-landing/src/services/npm-downloads.ts`; keep the
  `RAGMIR_NPM_DOWNLOADS` environment override for offline or deterministic builds.
- Keep the landing section order library-first: hero, install/library, agent integrations, use cases,
  privacy, honest scope, desktop teaser, FAQ, closing CTA. This sells the open-source package and MCP
  integration before broader scenarios.
- In landing target-client copy, keep categories distinct: Claude, Codex, Kimi, and GLM-style tools
  are cloud agents; OpenCode is a local runner; Ollama is the local model runtime for fully local
  confidential synthesis. Do not present MCP or Cline as target-client categories in that section.
- The landing deploy target is Cloudflare Workers Static Assets through
  `packages/ragmir-landing/wrangler.jsonc` and the canonical domain `ragmir.com`. Keep
  Cloudflare account IDs, tokens, and analytics secrets out of the repository; use local dry-runs
  before any protected-branch deployment.
- Ragmir landing should keep the broad WorkoutGen landing signals when content changes: Astro i18n
  routes, dark-first theme, self-hosted Inter, the shared `RagmirBackground` port of WorkoutGen's
  animated particle/canvas background, rounded pill nav, and language switching. Do not flatten it
  into a generic single-language static page or replace the background with an unrelated imitation.
- `packages/ragmir-app` is the cross-platform Tauri desktop/mobile shell. Root `pnpm build` validates
  the frontend bundle only; native `tauri build`, `tauri ios *`, and `tauri android *` commands stay
  explicit and are not part of npm release validation.
- Distribute the Ragmir app through direct downloads and sideloadable installers, not App Store or
  Play Store flows. Desktop installers and Android APK-style distribution are first-class; iOS stays
  deferred until a compliant non-store channel is chosen.
- Keep Android release packaging on the APK/direct-sideload path with
  `pnpm --filter @jcode.labs/ragmir-app tauri:android:build`; do not add an iOS release build script
  until a compliant non-store distribution path exists.
- Keep direct-download packaging and updater rules in `docs/app-distribution.md`; do not wire the
  Tauri updater with placeholder keys or endpoints.
- Keep `packages/ragmir-app` `release:updater-guard` passing. It must fail on partial or placeholder
  Tauri updater configuration and stay part of release preflight for direct-download packaging.
- Native desktop CI artifacts may be built only through the manual `Native App Build` workflow. It
  uploads artifacts for inspection but must not create GitHub releases, deploy, publish, or bypass
  signing/checksum requirements.
- Before native app packaging, run `pnpm --filter @jcode.labs/ragmir-app release:preflight -- --target
  <macos|windows|linux|android>` on the matching release machine. The preflight may check that
  secret-bearing environment variables are present, but it must never print their values.
- Keep `packages/ragmir-app` `release:preflight:smoke` passing. It verifies supported native release
  targets, keeps iOS out of release packaging, and confirms secret-bearing preflight environment
  values are not printed.
- Generate native artifact checksums with `pnpm --filter @jcode.labs/ragmir-app release:checksums`
  after Tauri packaging and before publishing direct-download files. The manual Native App Build
  workflow uploads the generated `SHA256SUMS` with the bundle artifacts.
- Generate `ragmir-app-release.json` with
  `pnpm --filter @jcode.labs/ragmir-app release:manifest -- --target <macos|windows|linux|android>`
  after checksums. The manifest is for static direct-download metadata and must not contain fake
  checkout URLs or unsigned-artifact claims.
- App license validation is local and per-major. Keep private signing keys out of the repository;
  only inject the public JWK at build time through `VITE_RAGMIR_LICENSE_PUBLIC_KEY_JWK`, and use
  `packages/ragmir-app` `license:keypair` / `license:issue` scripts for local license operations.
- Lemon Squeezy integration stays offline until a real webhook service is intentionally deployed:
  convert exported order/subscription JSON with `license:from-lemonsqueezy`, keep the unpublished
  webhook handler in `packages/ragmir-license-webhook`, and never commit API keys or webhook secrets.
- `packages/ragmir-app/src/lib/project-registry.ts` owns the app-side local project registry. Store
  selected project roots there and derive `.ragmir/raw` plus `.ragmir/storage`; keep ingest/query/index
  truth in Ragmir Core through the sidecar/CLI surface.
- The app's watched-folder feature is an opt-in polling layer over `rgr ingest`; do not add
  background daemons unless the plan explicitly changes. The first Google Drive connector is an
  opt-in local-sync folder flow using Google Drive for desktop files already present on disk; do not
  add OAuth, Drive API calls, or cloud credentials by default.
- Keep optional audio summaries separate from core ingestion/query behavior. The
  `ragmir-audio-summary` skill must prefer `rgr audio` / `@jcode.labs/ragmir-tts`, default to the
  Transformers.js WAV path for offline/confidential rendering, use the Edge MP3 path for global
  Voice Forge quality only when online TTS is explicitly acceptable, and keep generated audio under
  ignored local Ragmir state.
- Keep offline TTS preload explicit: use non-sensitive text for the first remote-model render that
  warms `.ragmir/models/tts`, pass `--allow-remote-models` only for that preload, then use `--offline`
  for confidential narration. Remote TTS model loading must stay disabled by default. The
  operational guide lives in `docs/offline-tts-preload.md`.
- Keep report generation separate from core retrieval. The `ragmir-markdown-report` skill writes cited
  Markdown reports under ignored `.ragmir/reports/` by default and must distinguish evidence,
  inference, uncertainty, missing documents, and professional-review items.
- Keep the public source boundary in `docs/source-boundary.md`: every tracked package is MIT source.
  Commercial value can gate official signed builds, support, updates, and hosted license delivery,
  but tracked app or webhook code must not be described as proprietary.
- Keep commercial distribution rules in `docs/commercial-distribution.md` and hosted checkout/webhook
  rules in `docs/payment-webhook-architecture.md`. Do not introduce App Store, Play Store, hosted
  document storage, committed payment/license secrets, public pricing tests, or customer validation
  ledgers.
- Ingestion must be explicit about files it did not index. Preserve `rgr audit --unsupported`,
  unsupported-extension summaries, secret-like file skipping, max file size limits, and checksum-based
  stale detection.
- Source discovery should include useful dotfiles (for example `.gitignore`, `.gitlab-ci.yml`, and
  `.vscode/settings.json`) while still ignoring generated/runtime directories and skipping
  secret-like files explicitly.
- OCR and older binary extraction are opt-in only. Keep PDF OCR behind `pdfOcrCommand` /
  `RAGMIR_PDF_OCR_COMMAND`, image OCR behind `imageOcrCommand` / `RAGMIR_IMAGE_OCR_COMMAND`, and
  legacy `.doc` extraction behind `legacyWordCommand` / `RAGMIR_LEGACY_WORD_COMMAND`; execute
  commands without a shell, require stdout text, and do not add heavy OCR/conversion dependencies or
  claim universal scan/image/binary support.
- Keep the repository as a simple pnpm workspace monorepo. Add Turbo only if multiple packages or
  apps start needing task caching/orchestration beyond `pnpm --filter`.
- The Node.js and Rust versions are each pinned once, in `mise.toml` (via
  [mise](https://mise.jdx.dev/)); Rust is only used by `packages/ragmir-app`'s Tauri shell. Bump
  versions there only, not as a hardcoded `node-version` in individual workflow steps. Run `pnpm
  bootstrap` (`mise install && pnpm install`) for one-command onboarding. CI (`ci.yml`,
  `native-app-build.yml`) installs mise with the official `curl https://mise.run | sh` script in a
  plain `run:` step, not the `jdx/mise-action` marketplace action — this repo's Actions permissions
  are restricted to `actions/*`, `github/codeql-action/*`, and verified creators, and
  `jdx/mise-action` does not qualify. `npm-publish.yml` keeps `actions/setup-node` instead, because
  that step also wires the npm registry `.npmrc` for publishing; keep its `node-version` in sync
  with `mise.toml` by hand. pnpm stays pinned via Corepack through `packageManager` in
  `package.json`, not duplicated in `mise.toml`. Keep mise scoped to toolchain-version pinning —
  it is not a package manager or task runner here, so don't mirror `package.json` scripts as mise
  tasks and don't wrap launch scripts (`dev:app`, `dev:landing`, `example`) in `mise exec`; that
  would create a second source of truth and break the "plain pnpm works without mise" onboarding
  path. For local dev, contributors activate mise in their shell (`mise activate`) so the pinned
  Node/Rust land on `PATH` via shims and every `pnpm` script uses the CI toolchain automatically.
- Keep Ragmir core free of Ollama. `embeddingProvider: "local-hash"` supports ingestion, search, MCP,
  and cited retrieval without a model server, but it must not be described as equivalent to semantic
  retrieval. `embeddingProvider: "transformers"` is the optional semantic embedding path.
- Keep `packages/ragmir-core/examples/sovereign-rag-demo` synthetic and safe to commit. It exists for
  package/user testing only; never place real confidential documents there.
- `packages/ragmir-core/examples/library-api-demo` is the local library-API smoke (`pnpm example`). It
  `import`s `@jcode.labs/ragmir` via Node self-referencing so it always exercises the local
  `packages/ragmir-core/dist` build, never the npm-published package, and it reuses the
  `sovereign-rag-demo` synthetic corpus rather than adding a second one. `dist/` is a gitignored build
  output: build it first with `pnpm build` (or run `pnpm example`, which builds first), then run
  `node packages/ragmir-core/dist/cli.js`. Never use `npx rgr`, which would resolve the released npm
  version.
- Use Context7 before changing dependencies or public APIs that rely on external libraries.
- Run `pnpm validate` before opening a release pull request or publishing. It covers
  Biome, dependency security audit, TypeScript, Vitest, build output, production CLI/MCP smoke
  tests, npm package metadata, semantic-release wiring, and release artifacts.
- Do not publish from a local machine or direct push to `main`. npm releases must go through
  the protected `Release npm` GitHub Actions workflow on `main`; semantic-release derives the
  version from Conventional Commits, prepares both package tarballs, publishes
  `@jcode.labs/ragmir-tts` first, then publishes `@jcode.labs/ragmir`.
- Use Git Flow locally: `main` is production, `develop` is integration, feature work starts from
  `develop` under `feature/*`. Do not deploy or publish from feature branches.

## AI Coding Agent Guardrails

These rules are binding for every AI coding agent working in this repository (Claude Code, Codex, and
any other), because several agents may run against this repo in parallel.

- **Never create, rename, delete, switch, or reset Git branches on your own.** Ask the user for
  explicit confirmation first, and state the exact branch name and base you intend to use. A
  high-level task is not blanket permission to spawn branches — confirm the branch itself.
- **Always follow the repository Git Flow.** `main` is production and `develop` is integration; both
  are protected and only change through a pull request with green required checks (Quality gate,
  Commitlint, Analyze TypeScript). Start work from `develop` under `feature/*` (fixes `fix/*`, chores
  `chore/*`), open a PR into `develop`, and promote `develop` to `main` with a release PR. Never
  commit or push directly to `main` or `develop`, and never force-push either branch.
- **Do not open or merge pull requests, or trigger a release / npm publish, without explicit
  confirmation.** The protected `Release npm` workflow and its `npm-publish` environment approval are
  the only publish path.
- **Reuse the branch or PR the user already approved instead of creating new ones.** Do not
  proliferate short-lived branches; when a temporary branch is genuinely required (for example a
  protected-branch back-merge), name it clearly and delete it once merged.
- **Respect other agents' work.** Before editing, run `git status` and check for other running agents
  or processes; never stage, commit, or discard uncommitted changes you did not make.

## Coding Conventions

General principles (KISS, DRY, YAGNI, SOLID) as applied in this codebase. Match the surrounding style.

- One responsibility per module. The ingest pipeline is split on purpose: `files` discovers,
  `parsing` extracts, `redaction` strips, `chunking` splits, `embeddings` vectorizes, `store`
  persists, `query` retrieves. Add logic to the module that owns the concern, or a new small module.
- No duplicated logic. Reuse existing helpers (`loadConfig`, `embedText`/`embedTexts`,
  `openRowsTable`, `redactText`, `supportedExtensions`, `recordAccess`); extract instead of copying.
  `embedText` delegating to `embedTexts` is the reference pattern.
- No dead or obsolete code. Delete replaced code, unused exports, and commented-out blocks in the
  same change. `dist/` is gitignored build output: regenerate it locally with `pnpm build` before
  running CLI/MCP smoke or the library-API demo, but do not commit it.
- No magic strings or numbers. Name meaningful literals as constants, and put shared paths, provider
  defaults, and ignore constants in `packages/ragmir-core/src/defaults.ts` rather than copying them across
  modules.
- Validate at the boundary, narrow inside. Use Zod at external edges (config in `config.ts`, MCP
  inputs in `mcp.ts`) and CLI parsers (`parsePositiveInt`); trust the types past that point.
- Type-guard instead of casting. Prefer runtime guards over `as`/`!` (`hasToList`, `isNumberArray`,
  `isNumberMatrix`); LanceDB row casts at the `store`/`query` driver boundary are the only exception.
- Named exports only; keep the public surface explicit in `index.ts`. Functions stay small and pure;
  private helpers sit below the exported function in the same file.
- Comments explain why, not what; the codebase is near comment-free. Only the CLI (`cli.ts`) writes
  to stdout/stderr — library, MCP, and pipeline code return data, never log.
- YAGNI: no options, providers, or abstractions ahead of a real need.

## Architecture

- `packages/ragmir-core` is Ragmir Core, published as `@jcode.labs/ragmir`.
- `packages/ragmir-core/src/cli.ts` exposes the `rgr` CLI and keeps `ragmir`/`kb` as deprecated
  compatibility bins.
- The `rgr` CLI supports global `--project-root <path>` for sidecar/app usage. Prefer it when a
  process cannot or should not change cwd for each selected knowledge base.
- `packages/ragmir-core/src/doctor.ts` owns the user-facing readiness diagnosis behind
  `rgr doctor`.
- `packages/ragmir-core/src/config.ts` resolves `.ragmir/config.json` from the target repository.
- `packages/ragmir-core/src/defaults.ts` owns shared default paths, provider defaults, and generated-state ignore
  constants. Keep config/init/security/gitignore aligned through this module instead of copying
  literals.
- `packages/ragmir-core/src/sources.ts` owns the `sources` array management API used by
  `rgr sources add/list` (reads/writes `.ragmir/config.json`); file discovery itself remains in
  `files.ts`.
- `packages/ragmir-core/src/skill.ts` owns agent skill installation and the per-agent
  `agentHelpers`/MCP config generation (`AgentHelperFile`) behind `rgr setup` and
  `rgr install-skill`/`install-agent`. Add a new agent target through `SUPPORTED_AGENT_TARGETS`
  and its helper builder here, not by hand-listing agents in `cli.ts`.
- `packages/ragmir-core/src/ingest.ts` parses supported files, chunks text, embeds chunks, and rebuilds the
  local LanceDB table. Normal ingest is incremental and reuses rows whose checksum/provider/model
  still match; `--rebuild` forces a full re-index.
- `packages/ragmir-core/src/parsing.ts` uses proven parsers for high-risk Office formats:
  Mammoth for `.docx` and read-excel-file for `.xlsx`. Keep the lightweight XML ZIP parser for
  `.pptx`, OpenDocument, and EPUB unless tests show fidelity gaps. Legacy `.xls` workbooks are not
  supported by default; convert them to `.xlsx`, CSV, PDF, HTML, or text before ingesting.
- `packages/ragmir-core/src/query.ts` performs hybrid retrieval (vector candidates plus bounded lexical
  BM25 scoring) and returns cited retrieval context; LLM synthesis belongs outside Ragmir core.
- `packages/ragmir-core/src/research.ts` runs the audit-backed multi-query research pass behind
  `rgr research`, combining `query.ts` search results with `ingest.ts` audit coverage.
- `packages/ragmir-core/src/evaluate.ts` scores retrieval recall against a golden query file behind
  `rgr evaluate`, for the local recall gate described above.
- `packages/ragmir-core/src/mcp.ts` exposes Ragmir as an MCP stdio server for agents.
- `packages/ragmir-tts` is the standalone TTS package used by `rgr audio`; it uses `edge-tts` for
  high-quality MP3 when available and Transformers.js for offline WAV rendering.
- `packages/ragmir-ui` owns shared React UI primitives and Tailwind theme tokens used by Ragmir
  product surfaces.
- `packages/ragmir-landing` owns the static Astro landing page.
- `packages/ragmir-app` owns the Tauri app shell for desktop and mobile.
- `packages/ragmir-license-webhook` owns the unpublished MIT-licensed Cloudflare Worker handler for
  Lemon Squeezy webhook signature verification, KV-backed idempotency records, and local `RAGMIR1`
  license issuance. It must stay undeployed until real provider variants, secrets,
  storage/idempotency, and a release surface exist. Its `wrangler.jsonc` must keep placeholder KV
  namespace IDs until real Cloudflare resources are provisioned; use `cf:dry-run` only before
  protected deployment.
- The app integrates Ragmir Core through the existing `rgr` CLI/MCP surface. Keep the sidecar
  decision and command allowlist in `docs/app-sidecar-architecture.md`; the current native bridge is
  the bounded `run_ragmir_command` Tauri command, and `externalBin` stays deferred until real platform
  sidecar binaries exist.
- `packages/ragmir-core/src/gitignore.ts` owns target-repository `.gitignore` entries for local generated Ragmir
  state.
- `packages/ragmir-core/src/security.ts`, `packages/ragmir-core/src/redaction.ts`, and
  `packages/ragmir-core/src/access-log.ts` own the
  privacy and confidentiality hardening layer.
- `packages/ragmir-core/skills/ragmir/SKILL.md` is the bundled portable agent skill.
- `packages/ragmir-core/skills/ragmir-audio-summary/SKILL.md` is the optional bundled audio-summary skill.
- `packages/ragmir-core/skills/ragmir-markdown-report/SKILL.md` is the optional bundled Markdown-report
  skill.
- `rgr setup` must keep generating agent-specific MCP helpers for easy local use by default:
  `.ragmir/claude-mcp-server.json` for `claude mcp add-json`, `.ragmir/codex-mcp.toml` for Codex
  config layers, `.ragmir/kimi-mcp.json` for Kimi, `.ragmir/opencode.jsonc` for OpenCode, and
  `.ragmir/cline-mcp.json` for Cline. Keep `--agents` available on setup/install-skill so a target
  repository can generate only the helpers it uses and remove stale unselected helpers.
- `rgr setup --semantic` is the first-run opt-in path for higher-quality semantic retrieval. It
  may download the configured Transformers.js embedding model once, then must leave
  `transformersAllowRemoteModels` false for normal confidential indexing.
- Keep `--mcp-name`, `--mcp-command`, and repeatable `--mcp-arg` available on setup/install-skill
  so repositories can generate MCP helper files for a stable server name or local wrapper script
  without post-processing `.ragmir/`.
- Keep prompt routing local, deterministic, and opt-in. `rgr route-prompt` and MCP
  `ragmir_route_prompt` may help agent hooks decide when to call Ragmir, but they must not store raw
  prompts, call an LLM, or perform retrieval themselves.
- `rgr install-agent` owns native skill discovery for the main supported coding agents. Keep
  `--agents claude|codex|kimi|opencode|cline` targeted so a user can install only the agent they use,
  with project scope by default and user scope available through `--scope user`.
- Keep `.ragmir/skills/` as the canonical skill source in target repositories. Native agent folders
  created by `rgr install-agent` should link to that source by default; use copy mode only as a
  compatibility fallback for runtimes or filesystems that cannot follow symlinks.
- `packages/ragmir-core/examples/sovereign-rag-demo` is the tracked synthetic test workspace for manual
  and package validation.
- `.ragmir/`, `.claude/`, `.codex/`, and `.agents/` are local user data or generated agent state in
  target repositories and must not be committed.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **jcode-ragmir** (2829 symbols, 4724 relationships, 241 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

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
