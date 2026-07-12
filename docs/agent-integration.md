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

## MCP tools

The server exposes `ragmir_status`, `ragmir_route_prompt`, `ragmir_search`, `ragmir_ask`, `ragmir_research`, `ragmir_audit`, `ragmir_evaluate`, `ragmir_usage_report`, and `ragmir_security_audit`.

Use compact search output when context is limited. `ragmir_ask` returns cited evidence, not a model generated answer. A cloud agent can receive returned passages, so choose that handoff only when it matches the corpus’s confidentiality requirements.

## Verify

```bash
rgr doctor
rgr status --json
rgr search "known phrase" --compact
```

If the client cannot set a working directory, launch the server with `RAGMIR_PROJECT_ROOT=/absolute/path/to/project`.
