# Agent integration

Ragmir gives agents cited local passages through one stdio MCP server. Prepare the target repository once:

```bash
rgr setup --agents claude,codex,kimi,opencode,cline
```

The generated files live under ignored `.ragmir/`. They reference `rgr serve-mcp` in the target repository, never a hosted document service.

## Native helpers

| Agent | Generated helper |
| --- | --- |
| Claude Code | `.ragmir/claude-mcp-server.json` |
| Codex | `.ragmir/codex-mcp.toml` |
| Kimi | `.ragmir/kimi-mcp.json` |
| OpenCode | `.ragmir/opencode.jsonc` |
| Cline | `.ragmir/cline-mcp.json` |

Install native skill discovery when the agent supports it:

```bash
rgr install-agent --agents codex,claude
```

Use `--scope user` only when you intentionally want a user-wide installation. Project scope is the default. `--mode copy` is a fallback for filesystems that cannot follow symlinks.

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

## Verify

```bash
rgr doctor
rgr status --json
rgr bases --json
rgr search "known phrase" --compact
```

If the client cannot set a working directory, launch the server with `RAGMIR_PROJECT_ROOT=/absolute/path/to/project`.
