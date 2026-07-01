# Agent Integration

Mimir ships with portable agent skills and a standard MCP server.

If `mimir setup` was not used, install the agent kit into a repository:

```bash
pnpm exec mimir install-skill
```

This creates:

```plain text
.mimir/skills/mimir/SKILL.md
.mimir/skills/mimir-audio-summary/SKILL.md
.mimir/skills/mimir-markdown-report/SKILL.md
.mimir/skills/mimir-legal-dossier/SKILL.md
.mimir/mcp.json
.mimir/claude-mcp-server.json
.mimir/codex-mcp.toml
.mimir/kimi-mcp.json
.mimir/opencode.jsonc
.mimir/cline-mcp.json
.mimir/agent-setup.md
.mimir/README.md
```

Agents that support skill folders can load `.mimir/skills/mimir/` for deep local RAG usage. Load
`.mimir/skills/mimir-audio-summary/` only when an optional spoken summary is needed. Load
`.mimir/skills/mimir-markdown-report/` when the user asks for a cited Markdown report, dossier,
audit memo, or planning note. Load `.mimir/skills/mimir-legal-dossier/` when the user asks for a
legal chronology, clause review, evidence table, or professional-review handoff. Other agents can
read the generated `.mimir/README.md` and use the MCP config snippet.

For native discovery in a specific agent, install only the agent you use:

```bash
pnpm exec mimir install-agent --agents claude
pnpm exec mimir install-agent --agents kimi
pnpm exec mimir install-agent --agents claude,codex,kimi,opencode,cline
```

By default, `install-agent` writes project-scope skill folders as links back to `.mimir/skills/`.
That keeps one original version of every skill. Add `--scope user` for global installations, or
`--mode copy` only when an agent/runtime cannot follow symlinked skill directories.

| Agent | Project skill directory | Main MCP helper |
| --- | --- | --- |
| Claude Code | `.claude/skills/` | `.mimir/claude-mcp-server.json` |
| Codex | `.codex/skills/` plus `skills.config` | `.mimir/codex-mcp.toml` |
| Kimi Code CLI | `.kimi/skills/` | `.mimir/kimi-mcp.json` |
| OpenCode | `.opencode/skills/` | `.mimir/opencode.jsonc` |
| Cline | `.cline/skills/` | `.mimir/cline-mcp.json` |

Start the MCP server from the repository root:

```bash
pnpm exec mimir serve-mcp
```

For a repository-level protocol smoke test, run the synthetic demo client:

```bash
pnpm --filter @jcode.labs/mimir mcp:smoke
```

MCP tools exposed:

- `mimir_status`
- `mimir_search`
- `mimir_ask`
- `mimir_research`
- `mimir_audit`
- `mimir_evaluate`
- `mimir_usage_report`
- `mimir_security_audit`

This MCP layer is the recommended way to let any compatible LLM or agent query the same local
knowledge base. The LLM does not need to know about LanceDB or the raw file layout; it asks Mimir for
ranked passages, cited context, audit-backed research reports, local recall gates, or metadata-only
usage summaries and uses the returned citations.

## Claude Code

From the target repository root:

```bash
pnpm exec mimir setup
pnpm exec mimir install-agent --agents claude
claude mcp add-json --scope local mimir "$(cat .mimir/claude-mcp-server.json)"
```

Claude Code provides the active project path to MCP servers through `CLAUDE_PROJECT_DIR`; Mimir uses
that value when serving MCP, so the same installed npm package can work inside each repository where
`mimir setup` was run. Keep the MCP scope local unless you intentionally want to share the server
config.

## Codex

From the target repository root:

```bash
pnpm exec mimir setup
pnpm exec mimir install-agent --agents codex
cat .mimir/codex-mcp.toml
```

Copy the printed TOML into `~/.codex/config.toml` or another trusted Codex config layer. The snippet
contains the repository `cwd`, the Mimir MCP server, and `skills.config` entries for the bundled
skills.

## Kimi Code CLI

From the target repository root:

```bash
pnpm exec mimir setup
pnpm exec mimir install-agent --agents kimi
kimi --mcp-config-file .mimir/kimi-mcp.json
```

Kimi can discover project skills from `.kimi/skills/`. The MCP config can also be installed in
Kimi's global MCP file if you intentionally want a global setup. If you prefer not to create a
`.kimi/skills/` discovery folder, Kimi can also be launched directly with
`kimi --skills-dir .mimir/skills --mcp-config-file .mimir/kimi-mcp.json`.

## OpenCode

From the target repository root:

```bash
pnpm exec mimir setup
pnpm exec mimir install-agent --agents opencode
cat .mimir/opencode.jsonc
```

Copy or merge the generated snippet into the OpenCode config layer you use for the project.

## Cline

From the target repository root:

```bash
pnpm exec mimir setup
pnpm exec mimir install-agent --agents cline
cat .mimir/cline-mcp.json
```

Cline can discover project skills from `.cline/skills/`. Add the generated MCP JSON under
`mcpServers` in Cline's MCP configuration when tool access is needed.

For other MCP clients that cannot set `cwd`, set `MIMIR_PROJECT_ROOT=/absolute/path/to/repository`
when launching `mimir serve-mcp`.

## Agent Demo

From a repository that already ran `mimir setup` and has Mimir wired into the current agent, ask:

```plain text
Use Mimir to audit the local evidence. First run mimir_status and mimir_audit. Then run
mimir_research for "release readiness and risks" and produce a cited Markdown report. Do not rely on
memory if Mimir does not contain enough evidence.
```

Agents that support skill folders should also load:

```plain text
.mimir/skills/mimir/
.mimir/skills/mimir-markdown-report/
```

The Markdown report skill writes reports under `.mimir/reports/` by default, which stays ignored by
Git.

Print the bundled skill path from the installed package:

```bash
pnpm exec mimir skill-path
```
