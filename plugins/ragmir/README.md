# Ragmir for Claude Code

This plugin gives Claude Code cited answers from your own project: code, specifications, PDFs,
and Office files. Each search returns passages cited to lines, PDF pages, slides, or spreadsheet
cells, and returns nothing when the sources hold no evidence. The index stays on your machine,
with no account, API key, or hosted store.

## Install

```text
/plugin install ragmir --marketplace jcode-works/ragmir
```

Then, in each project, run the indexing command once and confirm the sources Claude may read:

```text
/ragmir:index docs/**/*.md specs/**/*.pdf src/**/*.ts
```

Without arguments, Claude proposes the sources and asks before indexing. The plugin adds this
command, the Ragmir retrieval skill (`/ragmir:ragmir`), and an MCP server with five read-only
tools (`ragmir_search`, `ragmir_expand`, `ragmir_sources`, `ragmir_status`, and `ragmir_audit`),
`ragmir_ingest`, which refreshes the index after files change, and an `answer` prompt
(`/mcp__plugin_ragmir_ragmir__answer`) for a fully cited answer. The server runs a pinned Ragmir
release from npm and reads the project Claude Code has open. Run `/ragmir:index` again after
adding sources. Skip `rgr setup --agents claude` in projects that use this plugin: it
registers a second, project-level server.

The plugin works in Claude Code, where the project files live on your machine. The Claude web,
desktop chat, and mobile apps cannot reach local files, so they cannot use it.

The same folder also installs in OpenAI Codex (`codex plugin marketplace add
jcode-works/ragmir`, then `codex plugin add ragmir@ragmir`), Cursor (copy it to
`~/.cursor/plugins/local/ragmir`), Gemini CLI, and Qwen Code; the
[agent integration guide](https://github.com/jcode-works/ragmir/blob/main/docs/agent-integration.md#plugins-and-extensions-for-coding-agents)
lists every command.

Ragmir is open source under AGPL-3.0, with a commercial license available. Documentation:
<https://github.com/jcode-works/ragmir>.
