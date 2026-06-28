# UX/DX Audit

This audit covers Mimir as a CLI/library/MCP product. There is no browser UI; product UX is the
developer and agent workflow around installation, indexing, querying, safety, audio, and release.

## Evidence Reviewed

- Root product README: `README.md`
- npm package entrypoint READMEs: `packages/mimir/README.md`, `packages/mimir-tts/README.md`
- CLI implementation: `packages/mimir/src/cli.ts`
- TTS implementation: `packages/mimir-tts/src/index.ts`
- Agent skills: `packages/mimir/skills/**/SKILL.md`
- Security docs: `SECURITY-HARDENING.md`, `SECURITY.md`
- Release workflow: `.github/workflows/ci.yml`, `.github/workflows/npm-publish.yml`
- Runtime smoke path through a temporary repository

## UX Findings

| Area | Finding | Status |
| --- | --- | --- |
| First run | `kb init` created useful files but did not tell users what to do next. | Fixed: `kb init` now prints next steps. |
| Readiness | Users had to combine `status`, `audit`, and `security-audit` manually. | Fixed: `kb doctor` summarizes readiness and next steps. |
| Generated helper files | `private/README.md` was indexed and could pollute retrieval results. | Fixed: generated private README is skipped by source discovery. |
| Audio confidentiality | `auto` could select online Edge TTS when installed. | Fixed: default path is Transformers.js WAV; Edge MP3 requires `--engine edge`. |
| Documentation shape | The package README had too much tutorial, reference, and explanation mixed together. | Fixed: the root README is canonical; package README files are minimal npm entrypoints. |
| Agent onboarding | `install-skill` installed files but gave limited operational guidance. | Fixed: command output now prints agent next steps and Claude Code/Codex MCP snippets. |
| Ingestion visibility | Unsupported files were ignored silently, which made users overestimate coverage. | Fixed: `ingest`, `audit`, and `audit --unsupported` report skipped files by reason. |
| Report generation | Users had audio summaries but no dedicated Markdown-report workflow. | Fixed: `mimir-markdown-report` skill writes cited reports under ignored local state. |
| Stale detection | Audit compared paths but did not detect changed file content. | Fixed: audit now uses stored checksums to flag stale indexed content. |

## DX Findings

| Area | Finding | Status |
| --- | --- | --- |
| Local validation | `pnpm validate` already covers lint, typecheck, tests, build, smoke, package checks, and artifacts. | Good. |
| Release safety | npm publish is protected by CI, environment approval, provenance, and explicit version input. | Good. |
| API clarity | Core exports are small and named, but the README only shows a minimal API snippet. | Partially improved by CLI docs; deeper API docs remain future work. |
| MCP reference | Tool names and an agent demo prompt are documented, but tool schemas are not deeply documented. | Partially improved. |
| Error guidance | Common setup and audio errors were not centralized. | Fixed in the root README troubleshooting section. |
| Dist workflow | `dist/` is committed and documented in `CLAUDE.md`; this is unusual but CI-enforced. | Good for this repo, but keep documenting it. |

## Remaining Product Risks

- `local-hash` is intentionally low-friction but not semantic. The docs must continue to say this
  clearly so users do not overtrust retrieval quality.
- Transformers.js offline TTS still depends on preloaded model files. The install path is easy, but
  fully air-gapped operation requires a documented model-preload workflow.
- MCP access is read-focused but still exposes private retrieved passages to the connected agent.
  Team/RBAC support remains out of scope.
- `audit --unsupported` intentionally lists relative paths only; users still need to avoid pasting
  sensitive path names into public issue reports.
- The library API is usable, but a dedicated API reference page would help external developers.

## Recommended Next Pass

1. Add API reference docs for exported functions and result types.
2. Add MCP tool schema examples for agent developers.
3. Add a model-preload guide for semantic embeddings and offline TTS.
4. Add deeper API reference docs for external library consumers once the public API grows.
