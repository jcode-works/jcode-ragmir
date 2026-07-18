# Agent integration

Ragmir indexes the selected project files locally and gives the AI or automation you choose cited
passages through CLI or one stdio MCP server. The default `local-hash` path keeps ingestion and
retrieval offline. Core is model-agnostic, never uploads the corpus, and never calls a model itself.

For an interactive repository-aware installation, paste the canonical prompt from the
[quick-start guide](./quick-start.md) into the coding agent. It detects the package manager and
existing Ragmir state, asks one approval batch, then configures and verifies the selected clients.

Choose the handoff that matches the corpus:

| Path | What stays local | What crosses the boundary |
| --- | --- | --- |
| Preferred hosted AI | Corpus, index, and retrieval | Only returned passages, under the AI provider's data policy |
| Local AI or automation | Corpus, index, retrieval, and the consumer | Nothing, unless that consumer uses another network service |
| Ragmir Chat | Corpus, index, retrieval, and answer generation | One explicit model download during setup, then no network |

Prepare the target repository once:

```bash
rgr setup --agents claude,codex,kimi,opencode,cline
```

The canonical files live under ignored `.ragmir/`. Setup also links the selected skills into each
agent's native project directory and generates a local `.ragmir/run.cjs` MCP runner. The runner uses
the installed project binary first, then the current package installation, with a pinned npm fallback.

## Native helpers

| Agent | Generated helper |
| --- | --- |
| Claude Code | `.ragmir/claude-mcp-server.json` |
| Codex | `.ragmir/codex-mcp.toml` |
| Kimi | `.ragmir/kimi-mcp.json` |
| OpenCode | `.ragmir/opencode.jsonc` |
| Cline | `.ragmir/cline-mcp.json` |

Setup installs project-scoped native skill discovery by default. Re-run installation when you want a
different scope or copy mode:

```bash
rgr install-agent --agents codex,claude
```

Use `--scope user` only when you intentionally want a user-wide installation. Project scope is the
default. Codex skills use `.agents/skills/` for both project and user discovery. `--mode copy` is a
fallback for filesystems that cannot follow symlinks. Ragmir refuses to overwrite an unmanaged
same-name skill unless you explicitly pass `--force` after reviewing it.

## Monorepo bases

A monorepo can run one root knowledge base plus isolated bases in individual apps. From the app or
file currently in scope, run:

```bash
rgr bases --json
```

The nearest `.ragmir/config.json` is `activeId`. Use the root base for shared architecture and
cross-app decisions; use the nearest app base for app-specific questions. Generated MCP helpers set
`RAGMIR_PROJECT_ROOT` explicitly. Nested bases also receive deterministic names such as
`ragmir-apps-web`, avoiding collisions with the root `ragmir` server. If an agent can see more than
one Ragmir server, call `ragmir_status` and verify `knowledgeBaseId` before retrieval. Keep evidence
from different bases labeled rather than silently merging citations.

## Team knowledge bases

Ragmir keeps one private local index per developer. For a Git-backed team, check out the branch the
team declared authoritative, configure its upstream once, then use one command:

```bash
rgr team sync
```

The command fetches only that upstream branch, compares Git history, and fast-forwards the checked
out branch only when the worktree is clean, the local branch has no unpublished commit, and history
has not diverged. It then runs incremental ingestion and reports `current`, `updated`, or one clear
action. It never stashes, resets, rebases, creates a merge commit, deletes the active index, or
chooses another branch.

This keeps the normal team loop small:

1. A developer pushes a branch and opens or updates the merge request.
2. The team reviews and merges it into the declared upstream branch.
3. Other developers run `rgr team sync`; safe updates and local reindexing happen together.

Use `--no-pull` to fetch and compare while keeping branch updates manual. Use `--check` to preview
without changing the worktree or index, `--no-fetch` for an explicitly offline run, `--strict` in
CI, and `--json` for automation. A dirty, ahead, diverged, detached, or untracked branch is never
rewritten. A failed fetch keeps the last valid local index available and reports that upstream
freshness is unverified. A failed ingestion keeps the previous validated index instead of deleting
it first.

The ignored `.ragmir/config.json` remains local. If every workstation needs the exact same source
contract, version a reviewed template in the repository and apply it during setup. `rgr team sync`
synchronizes tracked sources through Git; it does not commit or distribute private Ragmir state.

### Advanced drift diagnostics

Snapshots remain available for a non-Git authority such as Drive, or when the team needs an exact
configuration and per-file comparison. They are not part of the normal Git workflow. On one
authorized workstation:

```bash
rgr team snapshot --label local --output .ragmir/team/local.json
```

Share that file only with teammates authorized for the corpus. It contains relative paths,
SHA-256 checksums, readiness, version, and index settings, never source text or an absolute project
path. On another workstation:

```bash
rgr team compare .ragmir/team/local.json --local-label peer
```

The result distinguishes configuration drift, local-only files, peer-only files, and changed files.
It provides ordered commands for readiness, upgrade, ingestion, or rebuild work. Use the declared
Drive revision, team folder, or Git commit as the authority, then compare fresh snapshots until
`status=synchronized`. Operational readiness and privacy review are independent: a matching index
with local extractor or permission warnings remains synchronized, while the comparison exposes
per-side security advisory counts and recommends `rgr security-audit`. Do not rebuild a healthy
index only to clear an advisory. Existing v2.19 snapshots remain compatible.

Use stable directory or glob contracts instead of rewriting local config from files found on one
machine. The lower-level `corpusFingerprint` returned by `rgr status --json`, `status()`, or
`ragmir_status` remains useful for a quick equality check. Matching values prove the same indexed
relative paths and source bytes only when both reports are ready with no missing or stale files.
Use `rgr team compare` only when values differ and the team needs the exact cause.

Use `sourceFingerprintMode: "strict"` when a synchronization tool can preserve file metadata while
replacing its content. Older manifests return a `null` fingerprint until the next successful
ingestion.

Do not synchronize `.ragmir/storage/` between active writers. A team bootstrap can call
`initProject`, `addSourceEntries`, and `syncTeamKnowledge`; each workstation still owns its index.

### Agent behavior on team drift

An agent using the bundled Ragmir skill should run `rgr team sync --json` before relying on a
Git-backed shared knowledge base. When `synchronized` is false, it should warn the user in the
user's language, present the first recommended action, and continue only with an explicit note when
the last valid local index may be older than upstream. It must never resolve Git history, stash,
reset, rebase, or overwrite source files. Snapshot comparison remains the advanced fallback for an
authorized non-Git source or exact drift investigation.

## MCP tools

The server exposes `ragmir_status`, `ragmir_route_prompt`, `ragmir_search`, `ragmir_ask`,
`ragmir_research`, `ragmir_expand`, `ragmir_audit`, `ragmir_evaluate`, `ragmir_usage_report`, and
`ragmir_security_audit`.

It also exposes two bounded resources:

| Resource | Use |
| --- | --- |
| `ragmir://context` | Active base identity, readiness, freshness, coverage, and available operations. |
| `ragmir://sources` | Manifest source coverage, skipped-file counts, and index drift, with a budget-derived file preview returned without scanning chunks. |

Read `ragmir://context` first when the client supports resources. This gives an agent enough context
to choose the next operation without chaining status, doctor, and audit calls. Totals in
`ragmir://sources` stay complete even when detail lists are truncated.
The TypeScript `sources({ offset, limit })` method can request later pages directly from the
manifest file snapshot without materializing the complete source list; its default page remains 50
files.

Use compact retrieval first, then pass a returned citation to `ragmir_expand` when the agent needs
the exact chunk or a bounded neighbor window. Search, ask, research, expansion, audit, and evaluation
accept `maxBytes`. Variable-size tool and resource JSON is bounded by `mcpMaxOutputBytes` and an
absolute 1 MiB server ceiling; every response has an explicit full or summary schema. Responses
stay parseable, while `_meta["ragmir/output"]` reports the active budget, returned bytes, and
truncation.
Budget pressure selects a typed summary with exact scalar values, previews, and omission counters;
it never shortens identifiers, paths, or warnings in place. Search always retains the best citation
when one exists. The server also applies the budget before choosing retrieval depth, source page
size, audit detail, and returned evaluation case details, while keeping aggregate metrics complete.
`ragmir_ask` returns cited evidence, not a model generated answer. A cloud agent can receive returned
passages, so choose that handoff only when it matches the corpus's confidentiality requirements.

Every tool advertises non-destructive behavior to compatible clients. Search, ask, research, and
evaluation conservatively advertise open-world behavior because explicitly enabled semantic models
may download public weights. The pure prompt router, security audit, and usage report also advertise
read-only, idempotent behavior. Other tools conservatively do not because they can initialize
ignored local state or append metadata-only access logs. `ragmir_evaluate` accepts only an existing
project-relative golden file; absolute paths, traversal, and symlinks that escape the project are
rejected. Strict mode returns that relative path, replaces evaluation failures with a generic
message, and masks configured model, storage, source, and access-log paths in diagnostic responses.

The generated helpers cover Claude Code, Codex, Kimi, OpenCode, and Cline. Other tools can consume
the same evidence through the CLI, TypeScript API, or any compatible MCP client. Hermes, n8n
workers, CI jobs, and internal applications do not require a dedicated Ragmir model integration.

Embedding applications can call `createMcpServer(cwd)` to register a caller-owned transport, or
`connectMcpServer(transport, cwd)` to connect it and receive a closeable server handle. The standard
`serveMcp(cwd)` helper remains the simplest local stdio entry point. A server lazily reuses one
`RagmirClient` per effective configuration for its pinned project root, refreshes it after
configuration changes, and closes the active client when the server or transport closes. Each MCP
request resolves configuration once. Request cancellation reaches retrieval operations and bounded
resource handlers. Native
filesystem and LanceDB calls that cannot receive an `AbortSignal` directly are checked immediately
before and after the call. Ragmir does not open an HTTP port; applications that expose a network
transport own its authentication and
authorization boundary.

## Verify

```bash
rgr doctor
rgr status --json
rgr bases --json
rgr search "known phrase" --compact
```

Doctor reports runner verification, native agents discovered, and integration warnings separately
from retrieval readiness.

If the client cannot set a working directory, launch the server with `RAGMIR_PROJECT_ROOT=/absolute/path/to/project`.
