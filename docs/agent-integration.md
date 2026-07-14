# Agent integration

Ragmir indexes the selected project files locally and gives the AI or automation you choose cited
passages through CLI or one stdio MCP server. The default `local-hash` path keeps ingestion and
retrieval offline. Core is model-agnostic, never uploads the corpus, and never calls a model itself.

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

## MCP tools

The server exposes `ragmir_status`, `ragmir_route_prompt`, `ragmir_search`, `ragmir_ask`,
`ragmir_research`, `ragmir_expand`, `ragmir_audit`, `ragmir_evaluate`, `ragmir_usage_report`, and
`ragmir_security_audit`.

It also exposes two bounded resources:

| Resource | Use |
| --- | --- |
| `ragmir://context` | Active base identity, readiness, freshness, coverage, and available operations. |
| `ragmir://sources` | Source coverage, skipped-file counts, and index drift, with per-file lists capped at 50. |

Read `ragmir://context` first when the client supports resources. This gives an agent enough context
to choose the next operation without chaining status, doctor, and audit calls. Totals in
`ragmir://sources` stay complete even when detail lists are truncated.

Use compact retrieval first, then pass a returned citation to `ragmir_expand` when the agent needs
the exact chunk or a bounded neighbor window. Search, ask, research, and expansion accept `maxBytes`;
the server also enforces the configured `mcpMaxOutputBytes` ceiling. Their single JSON text result
stays parseable, while `_meta["ragmir/output"]` reports retrieved bytes, returned bytes, compacting,
and truncation. `ragmir_ask` returns cited evidence, not a model generated answer. A cloud agent can
receive returned passages, so choose that handoff only when it matches the corpus’s confidentiality
requirements.

The generated helpers cover Claude Code, Codex, Kimi, OpenCode, and Cline. Other tools can consume
the same evidence through the CLI, TypeScript API, or any compatible MCP client. Hermes, n8n
workers, CI jobs, and internal applications do not require a dedicated Ragmir model integration.

Embedding applications can call `createMcpServer(cwd)` to register a caller-owned transport, or
`connectMcpServer(transport, cwd)` to connect it and receive a closeable server handle. The standard
`serveMcp(cwd)` helper remains the simplest local stdio entry point. MCP cancellation propagates to
search, ask, research, and citation expansion. Ragmir does not open an HTTP port; applications that
expose a network transport own its authentication and authorization boundary.

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
