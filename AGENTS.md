# Mimir

## Working Rules

- Speak with the user in French.
- Write code, identifiers, commit messages, filenames, and technical comments in English.
- Keep this repository free of private user documents, scans, tax identifiers, API keys,
  environment files, or generated vector stores.
- Keep public branding centered on `Mimir`. Use JCode Labs and Jean-Baptiste Thery for
  package scope, repository ownership, and copyright, not as the product name.
- Use `Mimir Core` only for the technical core package `@jcode.labs/mimir` and developer-facing
  package metadata. User-facing product copy remains `Mimir`; companion packages are Mimir add-ons.
- The package is open source under the MIT License unless the user explicitly changes it.
- This package must stay reusable across repositories. Resolve project data from the
  caller's working directory or explicit config, not from the package installation path.
- The public CLI name is `mimir`; keep `kb` only as a legacy compatibility alias. New docs,
  generated agent configs, landing copy, and setup guidance should use `mimir ...` commands.
- `mimir init` and `mimir install-skill` must keep generated local Mimir state ignored in target
  repositories. By default, add one `.mimir/` entry to the target repository `.gitignore`; `.kb/`
  and `private/**` are legacy-only compatibility paths.
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
- Keep first-run UX centered on `mimir setup` for full onboarding and `mimir doctor --fix` for safe
  repairs. `mimir init`, `mimir install-skill`, and `mimir ingest` remain available as explicit
  lower-level commands.
- Keep product documentation canonical in the root `README.md`. Package README files under
  `packages/*/README.md` are intentionally minimal npm entrypoints and must link clearly to the
  GitHub root README because npm displays package README files separately.
- Keep long operational references in `docs/` when the root README can link to them cleanly. The
  root README stays the canonical product entrypoint, not a dumping ground for every command table.
- Keep real-corpus dogfooding, business validation, pricing tests, customer ledgers, interview notes,
  generated JSON, reports, screenshots, paths, and client details outside Git. Commit only public-safe
  aggregate findings or synthetic reproductions.
- For private retrieval dogfooding, use `mimir evaluate --fail-under <recall>` as the local recall
  gate, and keep the real corpus, golden query files, and generated evaluation JSON outside Git.
- Use `mimir usage-report --days <n>` for metadata-only dogfooding summaries; do not read or commit
  raw access logs when an aggregate report is enough.
- Keep user-facing titles and marketing surfaces branded as `Mimir`. Use `Mimir Core` only for the
  technical core package and developer-facing metadata.
- Keep public repository surfaces safe to publish: no active checkout URLs, fake download/update URLs
  under real Mimir domains, private documents, generated `.pid` files, committed secrets, internal
  GTM/pricing ledgers, or wording that presents tracked MIT source as proprietary or closed source.
  `pnpm public:smoke` enforces the cheap checks.
- `packages/mimir-ui` is the shared UI/style foundation adapted from the WorkoutGen landing/UI
  approach. It provides the common Tailwind theme and React primitives for both the landing and the
  Tauri app; do not import WorkoutGen product copy, assets, analytics, or secrets.
- Prefer the shared shadcn-style primitives from `packages/mimir-ui` for landing and app surfaces.
  Tune reusable component variants or theme tokens before adding per-use raw color, typography, or
  shape overrides; primary buttons should stay rounded pill buttons.
- Keep shadcn CLI configuration explicit in `packages/mimir-ui/components.json` and
  `packages/mimir-landing/components.json`. Use `pnpm dlx shadcn@latest info -c
  packages/mimir-ui` for shared primitives and `pnpm dlx shadcn@latest info -c
  packages/mimir-landing` for the Astro landing surface; do not duplicate landing-local UI
  components when an export from `@jcode.labs/mimir-ui` fits.
- `packages/mimir-landing` is the Astro static landing package. It must stay telemetry-free by
  default; do not add PostHog. If analytics are needed later, prefer Cloudflare Web Analytics.
- The landing deploy target is Cloudflare Workers Static Assets through
  `packages/mimir-landing/wrangler.jsonc` and the canonical domain `mimir.jcode.works`. Keep
  Cloudflare account IDs, tokens, and analytics secrets out of the repository; use local dry-runs
  before any protected-branch deployment.
- Mimir landing should keep the broad WorkoutGen landing signals when content changes: Astro i18n
  routes, dark-first theme, self-hosted Inter, the shared `MimirBackground` port of WorkoutGen's
  animated particle/canvas background, rounded pill nav, and language switching. Do not flatten it
  into a generic single-language static page or replace the background with an unrelated imitation.
- `packages/mimir-app` is the cross-platform Tauri desktop/mobile shell. Root `pnpm build` validates
  the frontend bundle only; native `tauri build`, `tauri ios *`, and `tauri android *` commands stay
  explicit and are not part of npm release validation.
- Distribute the Mimir app through direct downloads and sideloadable installers, not App Store or
  Play Store flows. Desktop installers and Android APK-style distribution are first-class; iOS stays
  deferred until a compliant non-store channel is chosen.
- Keep Android release packaging on the APK/direct-sideload path with
  `pnpm --filter @jcode.labs/mimir-app tauri:android:build`; do not add an iOS release build script
  until a compliant non-store distribution path exists.
- Keep direct-download packaging and updater rules in `docs/app-distribution.md`; do not wire the
  Tauri updater with placeholder keys or endpoints.
- Keep `packages/mimir-app` `release:updater-guard` passing. It must fail on partial or placeholder
  Tauri updater configuration and stay part of release preflight for direct-download packaging.
- Native desktop CI artifacts may be built only through the manual `Native App Build` workflow. It
  uploads artifacts for inspection but must not create GitHub releases, deploy, publish, or bypass
  signing/checksum requirements.
- Before native app packaging, run `pnpm --filter @jcode.labs/mimir-app release:preflight -- --target
  <macos|windows|linux|android>` on the matching release machine. The preflight may check that
  secret-bearing environment variables are present, but it must never print their values.
- Keep `packages/mimir-app` `release:preflight:smoke` passing. It verifies supported native release
  targets, keeps iOS out of release packaging, and confirms secret-bearing preflight environment
  values are not printed.
- Generate native artifact checksums with `pnpm --filter @jcode.labs/mimir-app release:checksums`
  after Tauri packaging and before publishing direct-download files. The manual Native App Build
  workflow uploads the generated `SHA256SUMS` with the bundle artifacts.
- Generate `mimir-app-release.json` with
  `pnpm --filter @jcode.labs/mimir-app release:manifest -- --target <macos|windows|linux|android>`
  after checksums. The manifest is for static direct-download metadata and must not contain fake
  checkout URLs or unsigned-artifact claims.
- App license validation is local and per-major. Keep private signing keys out of the repository;
  only inject the public JWK at build time through `VITE_MIMIR_LICENSE_PUBLIC_KEY_JWK`, and use
  `packages/mimir-app` `license:keypair` / `license:issue` scripts for local license operations.
- Lemon Squeezy integration stays offline until a real webhook service is intentionally deployed:
  convert exported order/subscription JSON with `license:from-lemonsqueezy`, keep the unpublished
  webhook handler in `packages/mimir-license-webhook`, and never commit API keys or webhook secrets.
- `packages/mimir-app/src/lib/project-registry.ts` owns the app-side local project registry. Store
  selected project roots there and derive `.mimir/raw` plus `.mimir/storage`; keep ingest/query/index
  truth in Mimir Core through the sidecar/CLI surface.
- The app's watched-folder feature is an opt-in polling layer over `mimir ingest`; do not add
  background daemons unless the plan explicitly changes. The first Google Drive connector is an
  opt-in local-sync folder flow using Google Drive for desktop files already present on disk; do not
  add OAuth, Drive API calls, or cloud credentials by default.
- Keep optional audio summaries separate from core ingestion/query behavior. The
  `mimir-audio-summary` skill must prefer `mimir audio` / `@jcode.labs/mimir-tts`, default to the
  Transformers.js WAV path for offline/confidential rendering, use the Edge MP3 path for global
  Voice Forge quality only when online TTS is explicitly acceptable, and keep generated audio under
  ignored local Mimir state.
- Keep offline TTS preload explicit: use non-sensitive text for the first remote-model render that
  warms `.mimir/models/tts`, then use `--offline` for confidential narration. The operational guide
  lives in `docs/offline-tts-preload.md`.
- Keep report generation separate from core retrieval. The `mimir-markdown-report` skill writes cited
  Markdown reports under ignored `.mimir/reports/` by default and must distinguish evidence,
  inference, uncertainty, missing documents, and professional-review items.
- Keep the public source boundary in `docs/source-boundary.md`: every tracked package is MIT source.
  Commercial value can gate official signed builds, support, updates, and hosted license delivery,
  but tracked app or webhook code must not be described as proprietary.
- Keep commercial distribution rules in `docs/commercial-distribution.md` and hosted checkout/webhook
  rules in `docs/payment-webhook-architecture.md`. Do not introduce App Store, Play Store, hosted
  document storage, committed payment/license secrets, public pricing tests, or customer validation
  ledgers.
- Ingestion must be explicit about files it did not index. Preserve `mimir audit --unsupported`,
  unsupported-extension summaries, secret-like file skipping, max file size limits, and checksum-based
  stale detection.
- Source discovery should include useful dotfiles (for example `.gitignore`, `.gitlab-ci.yml`, and
  `.vscode/settings.json`) while still ignoring generated/runtime directories and skipping
  secret-like files explicitly.
- OCR and legacy binary extraction are opt-in only. Keep PDF OCR behind `pdfOcrCommand` /
  `MIMIR_PDF_OCR_COMMAND`, image OCR behind `imageOcrCommand` / `MIMIR_IMAGE_OCR_COMMAND`, and
  legacy `.doc` extraction behind `legacyWordCommand` / `MIMIR_LEGACY_WORD_COMMAND`; execute
  commands without a shell, require stdout text, and do not add heavy OCR/conversion dependencies or
  claim universal scan/image/binary support.
  `KB_PDF_OCR_COMMAND` and `KB_IMAGE_OCR_COMMAND` remain legacy aliases only.
- Keep the repository as a simple pnpm workspace monorepo. Add Turbo only if multiple packages or
  apps start needing task caching/orchestration beyond `pnpm --filter`.
- Keep Mimir core free of Ollama. `embeddingProvider: "local-hash"` supports ingestion, search, MCP,
  and cited retrieval without a model server, but it must not be described as equivalent to semantic
  retrieval. `embeddingProvider: "transformers"` is the optional semantic embedding path.
- Keep `packages/mimir-core/examples/sovereign-rag-demo` synthetic and safe to commit. It exists for
  package/user testing only; never place real confidential documents there.
- Use Context7 before changing dependencies or public APIs that rely on external libraries.
- Run `pnpm validate` before opening a release pull request or publishing. It covers
  Biome, dependency security audit, TypeScript, Vitest, build output, production CLI/MCP smoke
  tests, npm package metadata, semantic-release wiring, and release artifacts.
- Do not publish from a local machine or direct push to `main`. npm releases must go through
  the protected `Release npm` GitHub Actions workflow on `main`; semantic-release derives the
  version from Conventional Commits, prepares both package tarballs, publishes
  `@jcode.labs/mimir-tts` first, then publishes `@jcode.labs/mimir`.
- Use Git Flow locally: `main` is production, `develop` is integration, feature work starts from
  `develop` under `feature/*`. Do not deploy or publish from feature branches.

## Coding Conventions

General principles (KISS, DRY, YAGNI, SOLID) as applied in this codebase. Match the surrounding style.

- One responsibility per module. The ingest pipeline is split on purpose: `files` discovers,
  `parsing` extracts, `redaction` strips, `chunking` splits, `embeddings` vectorizes, `store`
  persists, `query` retrieves. Add logic to the module that owns the concern, or a new small module.
- No duplicated logic. Reuse existing helpers (`loadConfig`, `embedText`/`embedTexts`,
  `openRowsTable`, `redactText`, `supportedExtensions`, `recordAccess`); extract instead of copying.
  `embedText` delegating to `embedTexts` is the reference pattern.
- No dead or obsolete code. Delete replaced code, unused exports, and commented-out blocks in the
  same change; a deletion must cover both source and the regenerated package `dist/`.
- No magic strings or numbers. Name meaningful literals as constants, and put shared paths, provider
  defaults, and ignore constants in `packages/mimir-core/src/defaults.ts` rather than copying them across
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

- `packages/mimir-core` is Mimir Core, published as `@jcode.labs/mimir`.
- `packages/mimir-core/src/cli.ts` exposes the `mimir` CLI and keeps `kb` as a legacy alias.
- The `mimir` CLI supports global `--project-root <path>` for sidecar/app usage. Prefer it when a
  process cannot or should not change cwd for each selected knowledge base.
- `packages/mimir-core/src/doctor.ts` owns the user-facing readiness diagnosis behind
  `mimir doctor`.
- `packages/mimir-core/src/config.ts` resolves `.mimir/config.json` from the target repository and
  falls back to legacy `.kb/config.json` when present.
- `packages/mimir-core/src/defaults.ts` owns shared default paths, provider defaults, and generated-state ignore
  constants. Keep config/init/security/gitignore aligned through this module instead of copying
  literals.
- `packages/mimir-core/src/ingest.ts` parses supported files, chunks text, embeds chunks, and rebuilds the
  local LanceDB table. Normal ingest is incremental and reuses rows whose checksum/provider/model
  still match; `--rebuild` forces a full re-index.
- `packages/mimir-core/src/parsing.ts` uses proven parsers for high-risk Office formats:
  Mammoth for `.docx` and read-excel-file for `.xlsx`. Keep the lightweight XML ZIP parser for
  `.pptx`, OpenDocument, and EPUB unless tests show fidelity gaps. Legacy `.xls` workbooks are not
  supported by default; convert them to `.xlsx`, CSV, PDF, HTML, or text before ingesting.
- `packages/mimir-core/src/query.ts` performs hybrid retrieval (vector candidates plus bounded lexical
  BM25 scoring) and returns cited retrieval context; LLM synthesis belongs outside Mimir core.
- `packages/mimir-core/src/mcp.ts` exposes Mimir as an MCP stdio server for agents.
- `packages/mimir-tts` is the standalone TTS package used by `mimir audio`; it uses `edge-tts` for
  high-quality MP3 when available and Transformers.js for offline WAV rendering.
- `packages/mimir-ui` owns shared React UI primitives and Tailwind theme tokens used by Mimir
  product surfaces.
- `packages/mimir-landing` owns the static Astro landing page.
- `packages/mimir-app` owns the Tauri app shell for desktop and mobile.
- `packages/mimir-license-webhook` owns the unpublished MIT-licensed Cloudflare Worker handler for
  Lemon Squeezy webhook signature verification, KV-backed idempotency records, and local `MIMIR1`
  license issuance. It must stay undeployed until real provider variants, secrets,
  storage/idempotency, and a release surface exist. Its `wrangler.jsonc` must keep placeholder KV
  namespace IDs until real Cloudflare resources are provisioned; use `cf:dry-run` only before
  protected deployment.
- The app integrates Mimir Core through the existing `mimir` CLI/MCP surface. Keep the sidecar
  decision and command allowlist in `docs/app-sidecar-architecture.md`; the current native bridge is
  the bounded `run_mimir_command` Tauri command, and `externalBin` stays deferred until real platform
  sidecar binaries exist.
- `packages/mimir-core/src/gitignore.ts` owns target-repository `.gitignore` entries for local generated Mimir
  state.
- `packages/mimir-core/src/security.ts`, `packages/mimir-core/src/redaction.ts`, and
  `packages/mimir-core/src/access-log.ts` own the
  privacy and confidentiality hardening layer.
- `packages/mimir-core/skills/mimir/SKILL.md` is the bundled portable agent skill.
- `packages/mimir-core/skills/mimir-audio-summary/SKILL.md` is the optional bundled audio-summary skill.
- `packages/mimir-core/skills/mimir-markdown-report/SKILL.md` is the optional bundled Markdown-report
  skill.
- `mimir setup` must keep generating agent-specific MCP helpers for easy local use:
  `.mimir/claude-mcp-server.json` for `claude mcp add-json`, `.mimir/codex-mcp.toml` for Codex
  config layers, `.mimir/kimi-mcp.json` for Kimi, `.mimir/opencode.jsonc` for OpenCode, and
  `.mimir/cline-mcp.json` for Cline.
- `mimir install-agent` owns native skill discovery for the main supported coding agents. Keep
  `--agents claude|codex|kimi|opencode|cline` targeted so a user can install only the agent they use,
  with project scope by default and user scope available through `--scope user`.
- Keep `.mimir/skills/` as the canonical skill source in target repositories. Native agent folders
  created by `mimir install-agent` should link to that source by default; use copy mode only as a
  compatibility fallback for runtimes or filesystems that cannot follow symlinks.
- `packages/mimir-core/examples/sovereign-rag-demo` is the tracked synthetic test workspace for manual
  and package validation.
- `.mimir/`, `.claude/`, `.codex/`, and `.agents/` are local user data or generated agent state in
  target repositories and must not be committed. Legacy `.kb/` and project `private/` folders must
  also stay uncommitted when encountered.

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
