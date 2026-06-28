# Mimir

## Working Rules

- Speak with the user in French.
- Write code, identifiers, commit messages, filenames, and technical comments in English.
- Keep this repository free of private user documents, scans, tax identifiers, API keys,
  environment files, or generated vector stores.
- Keep public branding centered on `Mimir`. Use JCode Labs and Jean-Baptiste Thery for
  package scope, repository ownership, and copyright, not as the product name.
- The package is open source under the MIT License unless the user explicitly changes it.
- This package must stay reusable across repositories. Resolve project data from the
  caller's working directory or explicit config, not from the package installation path.
- `kb init` and `kb install-skill` must keep generated local Mimir state ignored in target
  repositories. By default, add `.kb/`, `.mimir/`, and private raw-document paths to the
  target repository `.gitignore`.
- Keep confidentiality features low-friction: local-hash retrieval by default, optional
  Transformers.js embeddings with remote model loading disabled by default, redaction before
  indexing, metadata-only access logs, bounded MCP retrieval, configurable text-extension ingestion,
  and `security-audit` should work from default config.
- Keep public positioning focused on sovereign local RAG for confidential datasets and AI agents.
  Avoid claiming universal binary-file support; unsupported proprietary formats need extraction or
  dedicated parsers.
- Keep optional audio summaries separate from core ingestion/query behavior. The
  `mimir-audio-summary` skill must prefer `kb audio` / `@jcode.labs/mimir-tts`, support offline
  model loading, and keep generated audio under ignored local Mimir state.
- Keep the repository as a simple pnpm workspace monorepo. Add Turbo only if multiple packages or
  apps start needing task caching/orchestration beyond `pnpm --filter`.
- Keep Mimir core free of Ollama. `embeddingProvider: "local-hash"` supports ingestion, search, MCP,
  and cited retrieval without a model server, but it must not be described as equivalent to semantic
  retrieval. `embeddingProvider: "transformers"` is the optional semantic embedding path.
- Keep `packages/mimir/examples/sovereign-rag-demo` synthetic and safe to commit. It exists for
  package/user testing only; never place real confidential documents there.
- Use Context7 before changing dependencies or public APIs that rely on external libraries.
- Run `pnpm validate` before opening a release pull request or publishing. It covers
  Biome, TypeScript, Vitest, build output, production CLI/MCP smoke tests, and npm package
  metadata.
- Do not publish from a local machine or direct push to `main`. npm releases must go through
  the protected manual `Publish npm` GitHub Actions workflow after `main` has green CI. The workflow
  publishes `@jcode.labs/mimir-tts` first, then `@jcode.labs/mimir`.

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
  defaults, and ignore constants in `packages/mimir/src/defaults.ts` rather than copying them across
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

- `packages/mimir` is the core package published as `@jcode.labs/mimir`.
- `packages/mimir/src/cli.ts` exposes the `kb` CLI.
- `packages/mimir/src/config.ts` resolves `.kb/config.json` from the target repository.
- `packages/mimir/src/defaults.ts` owns shared default paths, provider defaults, and generated-state ignore
  constants. Keep config/init/security/gitignore aligned through this module instead of copying
  literals.
- `packages/mimir/src/ingest.ts` parses supported files, chunks text, embeds chunks, and rebuilds the
  local LanceDB table.
- `packages/mimir/src/query.ts` performs vector search and returns cited retrieval context; LLM synthesis belongs
  outside Mimir core.
- `packages/mimir/src/mcp.ts` exposes Mimir as an MCP stdio server for agents.
- `packages/mimir-tts` is the standalone JS/ONNX TTS package used by `kb audio`.
- `packages/mimir/src/gitignore.ts` owns target-repository `.gitignore` entries for local generated Mimir
  state.
- `packages/mimir/src/security.ts`, `packages/mimir/src/redaction.ts`, and
  `packages/mimir/src/access-log.ts` own the
  privacy and confidentiality hardening layer.
- `packages/mimir/skills/mimir/SKILL.md` is the bundled portable agent skill.
- `packages/mimir/skills/mimir-audio-summary/SKILL.md` is the optional bundled audio-summary skill.
- `packages/mimir/examples/sovereign-rag-demo` is the tracked synthetic test workspace for manual
  and package validation.
- `.kb/`, `.mimir/`, and project `private/` folders are local user data or generated agent
  state in target repositories and must not be committed.
