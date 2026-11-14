# Ragmir for Claude Code

This plugin gives Claude Code cited answers from your own project: code, specifications, PDFs,
and Office files. Each search returns passages cited to lines, PDF pages, slides, or spreadsheet
cells, and returns nothing when the sources hold no evidence. The index stays on your machine,
with no account, API key, or hosted store.

## Install

```text
/plugin install ragmir --marketplace jcode-works/jcode-ragmir
```

Then index each project once, from its root, choosing the sources Claude may read:

```bash
npx @jcode.labs/ragmir init
npx @jcode.labs/ragmir sources add "docs/**/*.md" "specs/**/*.pdf" "src/**/*.ts"
npx @jcode.labs/ragmir ingest
```

The plugin adds the Ragmir retrieval skill (`/ragmir:ragmir`) and an MCP server with four
read-only tools: `ragmir_search`, `ragmir_expand`, `ragmir_status`, and `ragmir_audit`. The server
runs a pinned Ragmir release from npm and reads the project Claude Code has open. Run `ingest`
again after changing sources, or `npx @jcode.labs/ragmir hooks install` to refresh the index after
Git operations. Skip `rgr setup --agents claude` in projects that use this plugin: it registers a
second, project-level server.

Ragmir is open source under AGPL-3.0, with a commercial license available. Documentation:
<https://github.com/jcode-works/jcode-ragmir>.
