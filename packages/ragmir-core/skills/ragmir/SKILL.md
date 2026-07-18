---
name: ragmir
description: Use Ragmir for local-first retrieval from private project documents, document ingestion, knowledge-base audits, or MCP access to a repository corpus. Prefer it to memory when the answer may be in local documents.
---

# Ragmir

Ragmir indexes a repository's documents locally and returns cited passages through a CLI and MCP
server. Treat the target repository and its index as the source of truth.

## Safety

- Do not commit `.ragmir/`, raw documents, generated vectors, or access logs.
- Treat retrieval output as sensitive. Summarize it with citations instead of pasting long passages.
- Separate document-backed facts from inference. Ask for missing documents when the index is weak.

## Start here

From the target repository root:

```sh
pnpm exec rgr doctor
```

If setup or indexing is incomplete:

```sh
pnpm exec rgr doctor --fix
```

For a new installation:

```sh
pnpm add -D @jcode.labs/ragmir
pnpm exec rgr setup
pnpm exec rgr ingest
```

Use `pnpm exec rgr setup --semantic` only when a one-time local embedding-model download is
acceptable. Normal confidential indexing keeps remote model loading disabled.

## Choose the smallest operation

| Need | Command or MCP tool |
| --- | --- |
| Active base, readiness, and capabilities | Read `ragmir://context` or run `rgr status --json` |
| Bounded source coverage and index drift | Read `ragmir://sources` or run `rgr audit` |
| Readiness | `rgr doctor` or `ragmir_status` |
| Repair setup or stale data | `rgr doctor --fix` |
| Check upgrade compatibility | `rgr upgrade --check`; run `rgr upgrade` when action is required |
| Sync Git-backed team knowledge | `rgr team sync --json` |
| Diagnose exact or non-Git team drift | `rgr team snapshot` and `rgr team compare` |
| Check unindexed or unsupported files | `rgr audit --unsupported` |
| Preview redacted chunks before indexing | `rgr preview --path <prefix> --json` |
| Check privacy posture | `rgr security-audit` |
| Retrieve exact passages | `rgr search "query" --compact` or `ragmir_search` |
| Explain hybrid ranking | `rgr search "query" --explain` or `ragmir_search` with `explain: true` |
| Expand one returned citation | `ragmir_expand` |
| Gather broad cited evidence | `rgr research "topic" --compact` or `ragmir_research` |
| Return deterministic context | `rgr ask "question"` or `ragmir_ask` |
| Measure retrieval recall | `rgr evaluate --golden <file>` or `ragmir_evaluate` |

Use `rgr route-prompt "..." --json` or `ragmir_route_prompt` only when it is unclear whether the
current request needs the local corpus. The router is deterministic and does not retrieve or store
the prompt.

## Monorepo routing

When a monorepo has a root Ragmir base and nested app bases, select the base before retrieval:

1. Run `rgr bases --json` from the directory in scope. The nearest configured ancestor is
   `activeId`.
2. Use the root base for shared architecture or cross-app questions. Use the nested base for an
   app-specific question.
3. If the shell working directory is not inside the intended base, pass
   `--project-root /absolute/path/to/base` before the command.
4. For MCP, call `ragmir_status` when the active base is uncertain and verify `knowledgeBaseId`.
   Generated helpers pin `RAGMIR_PROJECT_ROOT`; nested bases receive distinct server names.
5. Never silently combine citations from different bases. Label each base when a task genuinely
   requires evidence from more than one.

## Team synchronization

When the task involves a Git-backed team knowledge base, run the single high-level flow before
relying on retrieval:

```sh
pnpm exec rgr team sync --json
```

The current branch upstream is the declared authority. Ragmir fetches it, fast-forwards only when
the worktree is clean and history has not diverged, then refreshes the local index incrementally.
It never stashes, resets, rebases, creates a merge commit, or deletes the active index. Use
`--no-pull` when the user wants remote inspection and local ingestion without an automatic branch
update. Use `--no-fetch` only for an explicitly offline run.

If `synchronized` is false, warn the user in the language they are using and present the first
`recommendedActions` item. Dirty, ahead, diverged, detached, and no-upstream states require a normal
Git or merge-request decision. A fetch or ingestion failure must leave the last valid local index
available when one exists; describe it as local evidence whose upstream freshness is unverified.
Never resolve Git history or overwrite source files on the user's behalf.

Snapshots are an advanced fallback for a non-Git authority or an authorized exact configuration
and per-file diagnosis. If a teammate provided one, run:

```sh
pnpm exec rgr team compare .ragmir/team/peer.json --local-label local --json
```

Summarize configuration drift plus local-only, peer-only, and changed files. Never ingest an
unreviewed peer copy. The declared Drive revision or team folder remains authoritative.

To create a shareable diagnostic without source text or absolute project paths:

```sh
pnpm exec rgr team snapshot --label <name> --output .ragmir/team/<name>.json
```

Treat the snapshot as sensitive metadata because it contains relative paths and checksums. Keep it
under ignored `.ragmir/` state and share it only with authorized teammates.

After updating the package and before retrieval with the new runtime, run `rgr upgrade --check`. If
action is required, explain it before running `rgr upgrade`. A safe rebuild keeps the previous
validated index until atomic activation; never delete `.ragmir/storage/` as the first upgrade step.
For a long-running host, keep the already loaded runtime serving and cut over only after the upgrade
reports `status=current` and `ready=true`.

## Indexing

Use `.ragmir/config.json` for sources, with paths, globs, and `!` exclusions:

```sh
pnpm exec rgr sources add "docs/**/*.md" "specs/**/*.md"
pnpm exec rgr sources add "!**/node_modules/**"
pnpm exec rgr ingest
```

Normal ingestion is incremental. Rebuild only after changing the embedding provider, embedding
model, or chunking settings:

```sh
pnpm exec rgr ingest --rebuild
```

For scanned PDFs, first run `rgr ocr doctor`, then configure a local OCR tool with `rgr ocr setup`.
OCR stays opt-in and never calls a remote service by default.

`local-hash` is the default retrieval provider. It supports cited local retrieval but is not
semantic embeddings. Use the Transformers provider only after an explicit model preload.

Before a costly ingest or after changing chunk settings, run `rgr preview --json`. Review redaction
counts, citations, `contextPath`, omitted chunks, and p50/p95 sizes. Search, ask, research, MCP
retrieval, and golden queries can restrict retrieval with source paths and structural context paths.
Use explanations to inspect RRF ranks and contributions, not as an independent relevance score.

## MCP

`rgr setup` writes local MCP helpers under `.ragmir/` for Claude Code, Codex, Kimi, OpenCode, and
Cline. A generic server configuration is:

```json
{
  "mcpServers": {
    "ragmir": {
      "command": "pnpm",
      "args": ["exec", "rgr", "serve-mcp"],
      "cwd": "/absolute/path/to/repository"
    }
  }
}
```

When a client cannot set `cwd`, set `RAGMIR_PROJECT_ROOT` for the server process. Prefer MCP tools
when available. Use CLI commands when they are not.

Prefer compact search, ask, or research output first. Call `ragmir_expand` with a returned citation
only when the exact chunk or neighboring context is needed. Search, ask, research, expansion, audit,
and evaluation accept `maxBytes`. Variable-size tool and resource JSON is bounded by the configured
`mcpMaxOutputBytes` and an absolute 1 MiB server ceiling. Inspect `_meta["ragmir/output"]` to see
whether the response was compacted or truncated. Pass `ragmir_evaluate` an existing
project-relative golden file; absolute paths and paths outside the base are rejected.

When MCP resources are supported, read `ragmir://context` first for a bounded identity, readiness,
freshness, coverage, and capability overview. Read `ragmir://sources` only when source coverage or
index drift matters; its per-file lists are capped while totals remain complete.

MCP is read-focused. Only remove an index with the explicit shell command:

```sh
pnpm exec rgr destroy-index --yes
```

## Optional outputs

For audio narration, load the installed `ragmir-audio-summary` skill. For a cited Markdown memo,
load `ragmir-markdown-report`. Both should write generated output under ignored `.ragmir/` state.

## Answer standard

- Reply in the language used by the user unless they request another language.
- Cite file paths and source labels when useful.
- State uncertainty when retrieval does not prove a claim.
- Keep legal, security, and financial conclusions conservative and recommend appropriate review.
