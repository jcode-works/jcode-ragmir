# UX/DX Audit

This audit covers Mimir as a CLI/library/MCP product. There is no browser UI; product UX is the
developer and agent workflow around installation, indexing, querying, safety, audio, and release.

## Evidence Reviewed

- Root product README: `README.md`
- npm package entrypoint READMEs: `packages/mimir-core/README.md`, `packages/mimir-tts/README.md`
- CLI implementation: `packages/mimir-core/src/cli.ts`
- TTS implementation: `packages/mimir-tts/src/index.ts`
- Agent skills: `packages/mimir-core/skills/**/SKILL.md`
- Security docs: `SECURITY-HARDENING.md`, `SECURITY.md`
- Release workflow: `.github/workflows/ci.yml`, `.github/workflows/npm-publish.yml`
- Runtime smoke path through a temporary repository

## UX Findings

| Area | Finding | Status |
| --- | --- | --- |
| First run | `mimir init` created useful files but did not tell users what to do next. | Fixed: `mimir init` now prints next steps. |
| Readiness | Users had to combine `status`, `audit`, and `security-audit` manually. | Fixed: `mimir doctor` summarizes readiness and next steps. |
| Local clutter | First-run setup spread user state across `private/`, `.kb/`, and `.mimir/`. | Fixed: fresh projects keep config, raw documents, storage, access logs, models, reports, audio, and agent helpers under one ignored `.mimir/` folder. |
| Generated helper files | `.mimir/raw/README.md` was indexed and could pollute retrieval results. | Fixed: generated raw README is skipped by source discovery. |
| Audio confidentiality | `auto` could select online Edge TTS when installed. | Fixed: default path is Transformers.js WAV; Edge MP3 requires `--engine edge`. |
| Documentation shape | The package README had too much tutorial, reference, and explanation mixed together. | Fixed: the root README is canonical; package README files are minimal npm entrypoints. |
| Agent onboarding | `install-skill` installed files but gave limited operational guidance. | Fixed: command output now prints agent next steps and Claude Code/Codex MCP snippets. |
| Ingestion visibility | Unsupported files were ignored silently, which made users overestimate coverage. | Fixed: `ingest`, `audit`, and `audit --unsupported` report skipped files by reason. |
| Report generation | Users had audio summaries but no dedicated Markdown-report workflow. | Fixed: `mimir-markdown-report` skill writes cited reports under ignored local state. |
| Stale detection | Audit compared paths but did not detect changed file content. | Fixed: audit now uses stored checksums to flag stale indexed content. |
| Semantic model preload | Users had to infer how to warm the Transformers.js cache. | Fixed: `mimir models pull` downloads the configured embedding model into `embeddingModelPath`. |
| TTS model preload | Users had to infer how `--offline` relates to the Transformers.js TTS cache. | Fixed: `docs/offline-tts-preload.md` documents non-sensitive preload, offline verification, and air-gapped transfer. |

## DX Findings

| Area | Finding | Status |
| --- | --- | --- |
| Local validation | `pnpm validate` already covers lint, dependency security audit, typecheck, tests, build, smoke, package checks, semantic-release wiring, and artifacts. | Good. |
| Release safety | npm publish is protected by CI, environment approval, provenance, and semantic-release versioning from Conventional Commits. | Good. |
| API clarity | Core exports are small and named, but the README only shows a minimal API snippet. | Fixed: `docs/api-reference.md` documents the public TypeScript API and result types. |
| MCP reference | Tool names and an agent demo prompt are documented, but tool schemas are not deeply documented. | Improved: `docs/api-reference.md` documents the MCP tool names and input shapes. |
| Error guidance | Common setup and audio errors were not centralized. | Fixed in the root README troubleshooting section. |
| Dist workflow | `dist/` is committed and documented in `CLAUDE.md`; this is unusual but CI-enforced. | Good for this repo, but keep documenting it. |

## Remaining Product Risks

- `local-hash` is intentionally low-friction but not semantic. The docs must continue to say this
  clearly so users do not overtrust retrieval quality.
- MCP access is read-focused but still exposes private retrieved passages to the connected agent.
  Team/RBAC support remains out of scope.
- `audit --unsupported` intentionally lists relative paths only; users still need to avoid pasting
  sensitive path names into public issue reports.
- The library API is usable and now documented, but examples should grow with real external usage.

## Recommended Next Pass

1. Add example-driven API guides once real external library usage appears.
2. Add richer MCP client examples if users integrate non-Claude/Codex agents.
