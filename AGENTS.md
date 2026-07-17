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
- Core must install and start without Chat or TTS. Keep both as optional peer integrations and load them only when their command is used.
- `packages/ragmir-landing` is a self-contained, telemetry-free Astro site. Keep it static, open-source focused, and free of vendor deployment configuration.
- Ragmir Core stays retrieval-first: `local-hash` supports offline retrieval, `transformers` is the explicit semantic option, and local chat remains a separate add-on.
- Long-running Node.js processes use one `RagmirClient` per project root and close it during shutdown. Keep the top-level API for one-shot scripts.
- Ragmir does not provide an HTTP server or fixed port. A network-facing host owns transport security, authentication, authorization, and rate limits.
- Index writers are serialized across local OS processes through a private lock under `storageDir`; do not claim a distributed or shared-network-filesystem lock.
- Public copy must lead with model-agnostic Core and the choice between the user's preferred AI or automation and a fully local consumer. Qwen and Gemma are optional Chat profiles, never Core or MCP requirements.

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

<!-- gitnexus:start -->
# GitNexus: Code Intelligence

This project is indexed by GitNexus as **jcode-ragmir** (2005 symbols, 4448 relationships, 165 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root. It auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol (callers, callees, and participating execution flows), use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace. Use `rename`, which understands the call graph.
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
