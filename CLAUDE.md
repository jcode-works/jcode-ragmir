# Ragmir development notes

## Commands

```bash
pnpm bootstrap
pnpm validate
pnpm dev:landing
pnpm example
```

Use `pnpm --filter @jcode.labs/ragmir <script>` for Core-only work. The pinned Node version lives in
`mise.toml`; activate mise in your shell or run local workspace commands with that pinned version.
Published packages require Node.js 22 or later, matching their manifests and release gate.

## Workspace

- `packages/ragmir-core`: published CLI, library, MCP server, and skills.
- `packages/ragmir-chat`: optional local chat add-on.
- `packages/ragmir-tts`: optional audio add-on.
- Core must install and start without Chat or TTS. Keep both as optional peer integrations and load them only when their command is used.
- `packages/ragmir-landing`: self-contained static Astro documentation and product site.

Generated `dist/`, `.astro/`, `release-artifacts/`, and `.ragmir/` directories are ignored. Do not
commit them. The root README is the canonical documentation entrypoint; keep package READMEs short.
When code changes public behavior, commands, configuration, supported formats, architecture, or
product claims, update the relevant docs and landing in the same change. For internal-only changes,
verify both surfaces and leave them unchanged when no update is needed.
Keep the English setup prompt identical across Core, the landing, root and package READMEs,
`docs/quick-start.md`, and the wiki. The public-surface smoke test enforces repository copies.
Lead public documentation with the value proposition, a working quick start, and the strongest
guarantees. Move operational depth to focused guides instead of repeating it across READMEs.
Present team use as a positive workflow: shared sources and configuration, one local ingest per
developer, then a corpus-fingerprint check. Keep low-level safeguards in focused guides.

Every commit promoted to `main` that can trigger semantic-release must include these exact body
sections with at least one bullet each: `Release highlights:`, `Release details:`, and
`Verification:`. Highlights state user outcomes, details group meaningful work by product area,
and verification names the gates actually run. Never reduce a release to a generic subject line or
raw commit list. Keep commit body lines within Commitlint's 100-character limit. When a release
bullet wraps, indent every continuation line by at least two spaces; the release notes generator
joins those lines into one complete public bullet.

## Boundaries

Ragmir stores and retrieves local cited context. It has no hosted document store, account system,
native desktop shell, or cloud-vendor deployment configuration. Keep OCR optional and
local, remote model downloads explicit, and normal confidential retrieval offline.
Describe Core as model-agnostic: users can connect their preferred AI or automation, or keep the
consumer local. Qwen and Gemma are optional Chat profiles, never Core or MCP requirements.
For repeated retrieval in a stateful Node.js process, use one `RagmirClient` per project root and
close it during shutdown. Ragmir does not provide an HTTP server or fixed port; network-facing hosts
own transport security, authentication, authorization, and rate limits.
Team diagnostics exchange metadata-only snapshots of relative paths, checksums, readiness,
versions, and configuration. Never include source text or absolute project paths, choose an
authoritative copy, or modify peer sources during comparison.
Package upgrades preserve the last validated index until an incompatible replacement passes staged
generation validation and activates atomically. Older configs keep safe defaults; never require
deleting `.ragmir/storage/` as the first repair step.

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
