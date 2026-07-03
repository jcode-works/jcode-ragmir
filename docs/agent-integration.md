# Agent Integration

Ragmir ships with portable agent skills and a standard MCP server.

If `ragmir setup` was not used, install the agent kit into a repository:

```bash
npx ragmir install-skill
```

By default this writes helper files for every supported agent. To keep a repository focused on only
the agents it uses, pass a comma-separated target list:

```bash
npx ragmir setup --agents claude,codex
npx ragmir install-skill --agents claude,codex
```

If an agent must launch Ragmir through a repository wrapper, generate the MCP helpers with that
command:

```bash
npx ragmir setup --agents claude,codex --mcp-name project-docs --mcp-command ./scripts/serve-mcp.sh
```

This creates:

```plain text
.ragmir/skills/ragmir/SKILL.md
.ragmir/skills/ragmir-audio-summary/SKILL.md
.ragmir/skills/ragmir-markdown-report/SKILL.md
.ragmir/skills/ragmir-legal-dossier/SKILL.md
.ragmir/mcp.json
.ragmir/claude-mcp-server.json
.ragmir/codex-mcp.toml
.ragmir/kimi-mcp.json
.ragmir/opencode.jsonc
.ragmir/cline-mcp.json
.ragmir/agent-setup.md
.ragmir/README.md
```

When `--agents` is used, Ragmir keeps `.ragmir/mcp.json`, the skill folders, and the shared guides, but
only writes the selected agent helper files. Previously generated unselected helper files are
removed from `.ragmir/`.

Agents that support skill folders can load `.ragmir/skills/ragmir/` for deep local RAG usage. Load
`.ragmir/skills/ragmir-audio-summary/` only when an optional spoken summary is needed. Load
`.ragmir/skills/ragmir-markdown-report/` when the user asks for a cited Markdown report, dossier,
audit memo, or planning note. Load `.ragmir/skills/ragmir-legal-dossier/` when the user asks for a
legal chronology, clause review, evidence table, or professional-review handoff. Other agents can
read the generated `.ragmir/README.md` and use the MCP config snippet.

For native discovery in a specific agent, install only the agent you use:

```bash
npx ragmir install-agent --agents claude
npx ragmir install-agent --agents kimi
npx ragmir install-agent --agents claude,codex,kimi,opencode,cline
```

By default, `install-agent` writes project-scope skill folders as links back to `.ragmir/skills/`.
That keeps one original version of every skill. Add `--scope user` for global installations, or
`--mode copy` only when an agent/runtime cannot follow symlinked skill directories.

| Agent | Project skill directory | Main MCP helper |
| --- | --- | --- |
| Claude Code | `.claude/skills/` | `.ragmir/claude-mcp-server.json` |
| Codex | `.codex/skills/` plus `skills.config` | `.ragmir/codex-mcp.toml` |
| Kimi Code CLI | `.kimi/skills/` | `.ragmir/kimi-mcp.json` |
| OpenCode | `.opencode/skills/` | `.ragmir/opencode.jsonc` |
| Cline | `.cline/skills/` | `.ragmir/cline-mcp.json` |

Start the MCP server from the repository root:

```bash
npx ragmir serve-mcp
```

For a repository-level protocol smoke test, run the synthetic demo client:

```bash
pnpm --filter @jcode.labs/ragmir mcp:smoke
```

MCP tools exposed:

- `ragmir_status`
- `ragmir_search`
- `ragmir_ask`
- `ragmir_research`
- `ragmir_audit`
- `ragmir_evaluate`
- `ragmir_usage_report`
- `ragmir_security_audit`

This MCP layer is the recommended way to let any compatible LLM or agent query the same local
knowledge base. The LLM does not need to know about LanceDB or the raw file layout; it asks Ragmir for
ranked passages, cited context, audit-backed research reports, local recall gates, or metadata-only
usage summaries and uses the returned citations.

## Claude Code

From the target repository root:

```bash
npx ragmir setup --agents claude
npx ragmir install-agent --agents claude
claude mcp add-json --scope local ragmir "$(cat .ragmir/claude-mcp-server.json)"
```

Claude Code provides the active project path to MCP servers through `CLAUDE_PROJECT_DIR`. Ragmir uses
that value only when the server working directory does not already point at a configured Ragmir
project. This keeps subfolder knowledge bases inside larger workspaces from being overridden by the
umbrella repository path. Keep the MCP scope local unless you intentionally want to share the server
config.

## Codex

From the target repository root:

```bash
npx ragmir setup --agents codex
npx ragmir install-agent --agents codex
cat .ragmir/codex-mcp.toml
```

Copy the printed TOML into `~/.codex/config.toml` or another trusted Codex config layer. The snippet
contains the repository `cwd`, the Ragmir MCP server, and `skills.config` entries for the bundled
skills.

## Kimi Code CLI

From the target repository root:

```bash
npx ragmir setup --agents kimi
npx ragmir install-agent --agents kimi
kimi --mcp-config-file .ragmir/kimi-mcp.json
```

Kimi can discover project skills from `.kimi/skills/`. The MCP config can also be installed in
Kimi's global MCP file if you intentionally want a global setup. If you prefer not to create a
`.kimi/skills/` discovery folder, Kimi can also be launched directly with
`kimi --skills-dir .ragmir/skills --mcp-config-file .ragmir/kimi-mcp.json`.

## OpenCode

From the target repository root:

```bash
npx ragmir setup --agents opencode
npx ragmir install-agent --agents opencode
cat .ragmir/opencode.jsonc
```

Copy or merge the generated snippet into the OpenCode config layer you use for the project.

## Cline

From the target repository root:

```bash
npx ragmir setup --agents cline
npx ragmir install-agent --agents cline
cat .ragmir/cline-mcp.json
```

Cline can discover project skills from `.cline/skills/`. Add the generated MCP JSON under
`mcpServers` in Cline's MCP configuration when tool access is needed.

For other MCP clients that cannot set `cwd`, set `RAGMIR_PROJECT_ROOT=/absolute/path/to/repository`
when launching `ragmir serve-mcp`. `RAGMIR_PROJECT_ROOT` always wins over `cwd` and agent-provided
project environment variables.

## Agent Demo

From a repository that already ran `ragmir setup` and has Ragmir wired into the current agent, ask:

```plain text
Use Ragmir to audit the local evidence. First run ragmir_status and ragmir_audit. Then run
ragmir_research for "release readiness and risks" and produce a cited Markdown report. Do not rely on
memory if Ragmir does not contain enough evidence.
```

Agents that support skill folders should also load:

```plain text
.ragmir/skills/ragmir/
.ragmir/skills/ragmir-markdown-report/
```

The Markdown report skill writes reports under `.ragmir/reports/` by default, which stays ignored by
Git.

Print the bundled skill path from the installed package:

```bash
npx ragmir skill-path
```
