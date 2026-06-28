# Mimir

[![CI](https://github.com/jcode-works/jcode-mimir/actions/workflows/ci.yml/badge.svg)](https://github.com/jcode-works/jcode-mimir/actions/workflows/ci.yml)
[![CodeQL](https://github.com/jcode-works/jcode-mimir/actions/workflows/codeql.yml/badge.svg)](https://github.com/jcode-works/jcode-mimir/actions/workflows/codeql.yml)
[![npm](https://img.shields.io/npm/v/@jcode.labs/mimir)](https://www.npmjs.com/package/@jcode.labs/mimir)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Open-source, local-first memory and retrieval for private project knowledge.

Mimir provides a TypeScript CLI and library that can be installed in any Node.js
repository. It indexes files from the target repository, stores vectors locally with LanceDB,
and uses Ollama for local embeddings and answers.

Created by Jean-Baptiste Thery and published under the JCode Labs npm scope.

Built by Jean-Baptiste Thery, freelance full-stack/AI tooling engineer at JCode Labs.

## Open Source

Mimir is a public open-source project under the MIT License. It is designed to be
inspectable, forkable, and usable without a JCode Labs account.

Contributions are welcome through pull requests. Start with [`CONTRIBUTING.md`](./CONTRIBUTING.md).
Security reports should stay private and follow the policy in [`SECURITY.md`](./SECURITY.md).

## Sponsors

Mimir stays MIT open source. Sponsorship helps fund maintenance, issue triage,
documentation, and practical agent-workflow improvements.

Sponsor the project through [GitHub Sponsors](https://github.com/sponsors/jb-thery).

Suggested GitHub Sponsors tiers:

- EUR 5/month: support the project.
- EUR 15/month: active sponsor.
- EUR 49/month: priority on issues and questions.
- EUR 199/month: company sponsor and light advisory support.

## Status

Early public package. APIs may evolve before `1.0.0`.

## Requirements

- Node.js 20+
- pnpm, npm, yarn or bun
- Ollama running locally
- Embedding model installed once:

```bash
ollama pull nomic-embed-text
```

Optional answer model:

```bash
ollama pull gemma4
```

## Install From npm

The package is public. Users do not need a JCode Labs account or npm token to install it.

With pnpm:

```bash
pnpm add -D @jcode.labs/mimir
```

With npm:

```bash
npm install --save-dev @jcode.labs/mimir
```

Maintainer tokens are only needed to publish new versions.

## Install From Git

```bash
pnpm add -D git+ssh://git@github.com/jcode-works/jcode-mimir.git
```

For local development:

```bash
pnpm add -D file:../jcode-mimir
```

Before creating an npm tarball later, run:

```bash
pnpm build
pnpm pack
```

## Use In Any Repository

Initialize the local project config:

```bash
pnpm exec kb init
```

Add private documents under `private/`, then run:

```bash
pnpm exec kb ingest
pnpm exec kb search "vendor invoice status"
pnpm exec kb ask "What do the documents prove?"
pnpm exec kb audit
pnpm exec kb security-audit
pnpm exec kb status
```

With npm, use `npx` after installing the package:

```bash
npx kb init
npx kb ingest
npx kb search "vendor invoice status"
npx kb ask "What do the documents prove?"
npx kb audit
npx kb security-audit
npx kb status
```

## Agent Skill And MCP

Mimir ships with a portable agent skill and a standard MCP server.

Install the agent kit into a repository:

```bash
pnpm exec kb install-skill
```

This creates:

```plain text
.mimir/skills/mimir/SKILL.md
.mimir/mcp.json
.mimir/README.md
```

Agents that support skill folders can load `.mimir/skills/mimir/`. Other agents can read the
generated `.mimir/README.md` and use the MCP config snippet.

Start the MCP server from the repository root:

```bash
pnpm exec kb serve-mcp
```

MCP tools exposed:

- `mimir_status`
- `mimir_search`
- `mimir_ask`
- `mimir_audit`
- `mimir_security_audit`

Print the bundled skill path from the installed package:

```bash
pnpm exec kb skill-path
```

## Data Boundary

The package code lives in `node_modules` or in this repository. Project data stays in the
repository where you run the CLI:

```plain text
your-project/
  private/          # raw documents to ingest
  .kb/config.json   # local config
  .kb/sources.txt   # optional extra source paths
  .kb/storage/      # generated LanceDB index
  .kb/access.log    # metadata-only access log
```

The package never ships project documents. `kb init` adds gitignore entries for `.kb/`
and `private/**`, and `kb install-skill` keeps `.mimir/` ignored as generated local agent
state.

## Confidentiality Defaults

Mimir is designed for private repositories and sensitive local evidence.

- Zero telemetry: no analytics or document content is sent to JCode Labs.
- Local-only network policy: Ollama must be on loopback by default.
- Redaction before indexing: common secrets and identifiers are redacted before chunks are
  embedded and stored.
- Metadata-only access logs: query hashes and action metadata are logged, not raw queries.
- MCP is read-focused and bounded by `mcpMaxTopK`.
- Generated local state is ignored by Git.

Run:

```bash
pnpm exec kb security-audit --strict
```

Remove the generated vector index:

```bash
pnpm exec kb destroy-index --yes
```

For air-gapped operation, release verification, secure deletion limits, and threat model details,
read [`SECURITY-HARDENING.md`](./SECURITY-HARDENING.md).

## Supported Files

- Markdown: `.md`, `.mdx`
- Text: `.txt`, `.text`
- JSON: `.json`
- YAML: `.yaml`, `.yml`
- CSV/TSV: `.csv`, `.tsv`
- HTML: `.html`, `.htm`
- PDF: `.pdf`

## Config

`.kb/config.json`:

```json
{
  "rawDir": "private",
  "storageDir": ".kb/storage",
  "sourcesFile": ".kb/sources.txt",
  "accessLogPath": ".kb/access.log",
  "tableName": "chunks",
  "ollamaHost": "http://localhost:11434",
  "networkPolicy": "local-only",
  "embedModel": "nomic-embed-text",
  "llmModel": "gemma4:latest",
  "redaction": {
    "enabled": true,
    "builtIn": true,
    "patterns": []
  },
  "accessLog": true,
  "mcpMaxTopK": 10,
  "topK": 5,
  "chunkSize": 1200,
  "chunkOverlap": 150
}
```

Environment overrides:

- `KB_RAW_DIR`
- `KB_STORAGE_DIR`
- `KB_SOURCES_FILE`
- `KB_ACCESS_LOG_PATH`
- `KB_OLLAMA_HOST`
- `KB_NETWORK_POLICY`
- `KB_EMBED_MODEL`
- `KB_LLM_MODEL`
- `KB_REDACTION_ENABLED`
- `KB_REDACTION_BUILT_IN`
- `KB_ACCESS_LOG`
- `KB_MCP_MAX_TOP_K`
- `KB_TOP_K`
- `KB_CHUNK_SIZE`
- `KB_CHUNK_OVERLAP`

## Library API

```ts
import { ingest, search, ask } from "@jcode.labs/mimir"

await ingest({ rebuild: true })
const results = await search("vendor invoice status")
const answer = await ask("What documents support the project timeline?")
```

## Privacy

- Embeddings and answers use local Ollama by default.
- Remote Ollama hosts are blocked unless `networkPolicy` explicitly allows them.
- Built-in redaction runs before indexing by default.
- Access logs store query hashes, not raw queries.
- The vector index is stored locally.
- Raw private documents should stay in the target repository's ignored `private/` folder.
- Do not put secrets or scans inside this package repository.

## License

MIT © Jean-Baptiste Thery.
