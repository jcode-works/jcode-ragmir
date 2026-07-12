# Ragmir

## Working rules

- Speak with users in French. Keep code, identifiers, comments, file names, and commit messages in English.
- Keep the repository free of private documents, generated `.ragmir/` state, credentials, and environment files.
- Ragmir is a fully open-source MIT project. Do not add activation, account, hosted-storage, native-shell, or cloud-vendor integrations.
- The repository is a pnpm workspace. Use the pinned Node version from `mise.toml`; Rust is not part of this project.
- Start feature work from `develop` on `feature/*`, use pull requests into `develop`, and never publish or deploy without explicit confirmation.

## Product boundary

- `packages/ragmir-core` provides `@jcode.labs/ragmir`: the `rgr` CLI, TypeScript library, MCP server, and portable skills.
- `packages/ragmir-chat` is the optional local GGUF synthesis add-on used by `rgr chat`.
- `packages/ragmir-tts` is the optional local/offline audio add-on used by `rgr audio`.
- `packages/ragmir-landing` is a self-contained, telemetry-free Astro site. Keep it static, open-source focused, and free of vendor deployment configuration.
- Ragmir Core stays retrieval-first: `local-hash` supports offline retrieval, `transformers` is the explicit semantic option, and local chat remains a separate add-on.

## Privacy and ingestion

- Resolve project data from the caller’s working directory or explicit configuration, never from the package installation path.
- Keep `.ragmir/` ignored. Use local-hash retrieval by default, redact before indexing, keep access logs metadata-only, and bound MCP retrieval.
- External extraction remains opt-in. OCR only runs for blank PDF pages through a configured local command, never a shell or cloud service.
- Do not claim universal binary support, blanket compliance, legal advice, or certification.

## Documentation

- The root `README.md` is the short canonical entrypoint: what Ragmir is, installation, first use, library API, MCP, and links to focused docs.
- Keep `docs/` concise and task-oriented: CLI, API, configuration, agent integration, troubleshooting, local chat, and local TTS. Remove future plans and obsolete surfaces rather than documenting them.
- Package READMEs are brief npm entrypoints that link to the root README.
- Keep `llms.txt` and `context7.json` aligned with public documentation and generated-output exclusions.
- When code changes public behavior, commands, configuration, supported formats, architecture, or product claims, update the relevant docs and landing in the same change. For internal-only changes, verify both surfaces and leave them unchanged when no update is needed.

## Validation

- Run the smallest relevant check while editing and `pnpm validate` before a release pull request.
- Reconcile `git status` with the intended scope before staging. Never stage secrets or generated local state.
- Use Conventional Commits. Commit and push only when the user authorizes them.

## Code conventions

- Keep responsibilities small and reuse the existing Core modules for discovery, parsing, redaction, chunking, embeddings, storage, and retrieval.
- Validate external inputs at boundaries with Zod or CLI parsers. Prefer type guards over casts and named exports over defaults.
- Only the CLI writes to stdout or stderr. Pipeline and library modules return values.

## GitNexus

The repository is indexed as `jcode-ragmir`.

- Before editing a function, class, or method, run upstream impact analysis and report HIGH or CRITICAL risk before continuing.
- Run `gitnexus_detect_changes()` before committing and refresh the index once after the final commit.
- Use `gitnexus_rename` for symbol renames. If the index is stale, run `npx gitnexus analyze` before relying on it.
