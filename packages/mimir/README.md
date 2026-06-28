# Mimir

[![CI](https://github.com/jcode-works/jcode-mimir/actions/workflows/ci.yml/badge.svg)](https://github.com/jcode-works/jcode-mimir/actions/workflows/ci.yml)
[![CodeQL](https://github.com/jcode-works/jcode-mimir/actions/workflows/codeql.yml/badge.svg)](https://github.com/jcode-works/jcode-mimir/actions/workflows/codeql.yml)
[![npm](https://img.shields.io/npm/v/@jcode.labs/mimir)](https://www.npmjs.com/package/@jcode.labs/mimir)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Open-source, sovereign local RAG for confidential datasets and AI agents.

Mimir provides a TypeScript CLI, library, MCP server, and portable agent skills that can be
installed in any Node.js repository. It indexes local files from the target repository, stores
vectors locally with LanceDB, and can use either built-in local-hash retrieval or optional
Transformers.js semantic embeddings. Mimir core returns cited retrieval context; answer synthesis
belongs to the AI agent, LLM, or local model runtime you choose around it.

The intended use case is simple: put confidential company, institutional, legal, operational, or
research documents in a private local folder, index them locally, then let any compatible AI agent or
LLM workflow retrieve grounded context for summaries, briefs, audits, and decision support without
shipping the dataset to a hosted RAG service.

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

## What Mimir Is For

- Build a local RAG knowledge base inside any repository.
- Analyze confidential datasets while keeping raw files and generated indexes local.
- Give Claude, Codex, Cursor, internal assistants, or other MCP-compatible tools the same private
  retrieval layer.
- Retrieve grounded local evidence through CLI, library calls, MCP tools, or the bundled agent
  skills so your chosen AI agent can produce cited summaries.
- Optionally create listenable WAV summaries with `kb audio`, `@jcode.labs/mimir-tts`, and the
  bundled `mimir-audio-summary` skill.

Mimir is not a hosted SaaS, not a remote vector database, and not a certified high-assurance system.
For regulated or state-grade environments, pair it with encrypted disks, controlled machines, release
verification, and an external security review.

## Use Cases

Mimir is useful whenever the source material should stay local but an AI agent still needs grounded
context.

| Use case | Example questions |
| --- | --- |
| Understand a code repository | "Where is authentication implemented?", "What depends on this module?", "Summarize the payment flow." |
| Understand architecture | "What services exist?", "What are the data boundaries?", "Which components are risky to change?" |
| Analyze specifications | "What does the technical spec require?", "Which requirements are still unclear?", "Generate an implementation checklist." |
| Work through a request for proposal or tender | "What are the mandatory constraints?", "Which documents prove compliance?", "What risks should be clarified?" |
| Study courses and training material | "Summarize chapter three.", "Create revision questions.", "Compare these two concepts." |
| Analyze a book or long report | "Extract the main thesis.", "Find recurring arguments.", "Create a chapter-by-chapter brief." |
| Build an internal knowledge base | "What is the policy for incident review?", "Who owns this process?", "Which source says that?" |
| Prepare meetings or decisions | "Give me a one-page briefing.", "What is missing before deciding?", "List action items and evidence." |
| Ask questions over offline documents | "Which files mention local-only operation?", "What evidence supports this claim?" |
| Generate audio briefings | "Create a listenable summary of the current dossier using offline TTS." |

## Requirements

- Node.js 20+
- pnpm, npm, yarn or bun
- No model runtime is required for the default `embeddingProvider: "local-hash"` mode.
- Optional semantic embeddings use Transformers.js with local model files under `.mimir/models` by
  default.
- Generated answers are intentionally outside Mimir core. Use Claude, Codex, OpenAI, a local model
  MCP server, or another trusted model runtime to synthesize from Mimir's cited context.
- Optional audio summaries use the separate `@jcode.labs/mimir-tts` workspace package. It renders
  WAV files with Transformers.js and does not require Python, ffmpeg, Piper, XTTS, or a local server.

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

## Install From Source Checkout

```bash
git clone git@github.com:jcode-works/jcode-mimir.git
cd jcode-mimir
pnpm install
pnpm build
```

For local development:

```bash
pnpm add -D file:../jcode-mimir/packages/mimir
```

Before creating an npm tarball later, run:

```bash
pnpm build
pnpm --dir packages/mimir pack
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

## Choose A Retrieval Mode

Mimir has two embedding modes.

### Default Local Hash Retrieval

Use this when you want a fully local, no-model smoke test or a dependency-light setup. Retrieval is
lexical/hash-based, not semantic.

`.kb/config.json`:

```json
{
  "embeddingProvider": "local-hash"
}
```

Commands:

```bash
pnpm exec kb ingest
pnpm exec kb search "offline retrieval approval"
pnpm exec kb ask "What evidence supports offline operation?"
```

`kb ask` always returns cited retrieved passages instead of a generated synthesis. You can pass those
passages to any LLM or agent you trust.

### Optional Semantic Embeddings With Transformers.js

Use this when you want better semantic retrieval while keeping Mimir core free of an LLM server.

`.kb/config.json`:

```json
{
  "embeddingProvider": "transformers",
  "embeddingModel": "mixedbread-ai/mxbai-embed-xsmall-v1",
  "embeddingModelPath": ".mimir/models",
  "transformersAllowRemoteModels": false
}
```

Commands:

```bash
pnpm exec kb ingest
pnpm exec kb ask "Which passages support offline operation?"
```

Keep `transformersAllowRemoteModels` false for confidential or air-gapped work and preload model
files into `embeddingModelPath`. Set it to true only when you explicitly allow Transformers.js to
download model files from Hugging Face.

## Dependency Footprint

Mimir can run retrieval without a model runtime. Some runtime dependencies remain because they own
core features:

| Dependency | Why it remains |
| --- | --- |
| @huggingface/transformers | optional local semantic embeddings |
| LanceDB | local vector storage and nearest-neighbor retrieval |
| MCP SDK | MCP server for compatible agents |
| fast-glob | safe source-file discovery |
| unpdf, html-to-text, yaml, fflate | document parsing for PDF, HTML, YAML, Office/OpenDocument ZIP files |
| commander, zod, picocolors | CLI, config validation, readable terminal output |

Removing more dependencies is possible only by dropping features or replacing them with smaller
internal implementations. The current low-friction path is dependency-light at runtime for users who
choose `local-hash`, while preserving richer parsing, MCP support, and optional semantic embeddings.

## Example Test Workspace

This repository includes a synthetic example under
[`examples/sovereign-rag-demo`](./examples/sovereign-rag-demo). It can be used to test ingestion,
retrieval, `security-audit`, and custom text extensions without using private documents.

From a local checkout:

```bash
pnpm build
cd examples/sovereign-rag-demo
node ../../dist/cli.js security-audit
node ../../dist/cli.js ingest
node ../../dist/cli.js search "offline retrieval approval"
node ../../dist/cli.js audit
```

The example uses the default local-hash retrieval mode, so it can run without downloading an
embedding or chat model.

## Typical Workflows

### Understand A Codebase

```bash
pnpm exec kb init
printf "src\nREADME.md\ndocs\n" >> .kb/sources.txt
pnpm exec kb ingest
pnpm exec kb search "authentication flow"
pnpm exec kb ask "Explain the architecture and cite the relevant files."
```

### Analyze Specifications Or A Course

```bash
pnpm exec kb ingest
pnpm exec kb ask "Summarize the requirements and list open questions."
pnpm exec kb ask "Create revision questions from the indexed course material."
```

### Work Offline

```bash
pnpm exec kb security-audit --strict
pnpm exec kb ingest
pnpm exec kb search "incident review policy"
pnpm exec kb ask "What does the local evidence prove?"
```

Use `embeddingProvider: "local-hash"` for a no-model offline workflow. Use
`embeddingProvider: "transformers"` with preloaded model files for semantic offline retrieval.
Generated answers should come from a trusted external agent or model runtime.

### Generate A Local Audio Briefing

Mimir includes a plug-and-play JS text-to-speech path for listenable summaries:

```bash
pnpm exec kb audio --doctor
pnpm exec kb audio /tmp/MIMIR-SUMMARY-project.txt --out .mimir/audio/project-summary.wav
```

The command writes WAV output locally and does not require Python or ffmpeg. The first render can
download a public Transformers.js-compatible model into `.mimir/models/tts`; the narration text is
processed locally. For confidential air-gapped work, preload model files and run:

```bash
pnpm exec kb audio /tmp/MIMIR-SUMMARY-project.txt --out .mimir/audio/project-summary.wav --offline
```

The standalone package can also be installed directly:

```bash
pnpm add -D @jcode.labs/mimir-tts
pnpm exec mimir-tts render /tmp/MIMIR-SUMMARY-project.txt --out .mimir/audio/project-summary.wav
```

## Agent Skills And MCP

Mimir ships with portable agent skills and a standard MCP server.

Install the agent kit into a repository:

```bash
pnpm exec kb install-skill
```

This creates:

```plain text
.mimir/skills/mimir/SKILL.md
.mimir/skills/mimir-audio-summary/SKILL.md
.mimir/mcp.json
.mimir/README.md
```

Agents that support skill folders can load `.mimir/skills/mimir/` for deep local RAG usage.
Load `.mimir/skills/mimir-audio-summary/` only when an optional spoken summary is needed.
Other agents can read the generated `.mimir/README.md` and use the MCP config snippet.

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

This MCP layer is the recommended way to let any compatible LLM or agent query the same local
knowledge base. The LLM does not need to know about LanceDB or the raw file layout; it asks Mimir for
ranked passages or cited context and uses the returned citations.

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
- No LLM generation in core: Mimir returns cited context for the agent/runtime you choose.
- Local-hash by default: no model runtime is required for the default retrieval path.
- Transformers.js remote model loading is disabled by default.
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

Mimir supports common text, document, data, config, log, and source-code files out of the box:

- Markdown: `.md`, `.mdx`
- Text: `.txt`, `.text`
- JSON: `.json`
- YAML: `.yaml`, `.yml`
- CSV/TSV: `.csv`, `.tsv`
- HTML: `.html`, `.htm`
- PDF: `.pdf`
- Office/OpenDocument: `.docx`, `.pptx`, `.xlsx`, `.odt`, `.ods`, `.odp`
- Rich text: `.rtf`
- Line data and logs: `.jsonl`, `.ndjson`, `.log`
- XML feeds and documents: `.xml`, `.rss`, `.atom`
- Config and data files: `.toml`, `.ini`, `.conf`, `.cfg`, `.properties`, `.sql`
- Source code: `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.go`, `.rs`, `.java`, `.rb`, `.php`,
  `.cs`, `.c`, `.cpp`, `.h`, `.css`

Custom UTF-8 text extensions can be enabled without changing code:

```json
{
  "includeExtensions": [".transcript", ".evidence"]
}
```

Or through:

```bash
KB_INCLUDE_EXTENSIONS=".transcript,.evidence" pnpm exec kb ingest
```

Images, scans, audio/video files, old proprietary Office binaries such as `.doc`, and other formats
that are not listed should be OCRed, transcribed, converted, or exported to text/PDF/HTML first.
Mimir intentionally avoids pretending that every binary format can be indexed safely without
extraction logic.

## Config

`.kb/config.json`:

```json
{
  "rawDir": "private",
  "storageDir": ".kb/storage",
  "sourcesFile": ".kb/sources.txt",
  "accessLogPath": ".kb/access.log",
  "embeddingModelPath": ".mimir/models",
  "tableName": "chunks",
  "embeddingProvider": "local-hash",
  "embeddingModel": "mixedbread-ai/mxbai-embed-xsmall-v1",
  "transformersAllowRemoteModels": false,
  "redaction": {
    "enabled": true,
    "builtIn": true,
    "patterns": []
  },
  "accessLog": true,
  "mcpMaxTopK": 10,
  "topK": 5,
  "chunkSize": 1200,
  "chunkOverlap": 150,
  "includeExtensions": []
}
```

Environment overrides:

- `KB_RAW_DIR`
- `KB_STORAGE_DIR`
- `KB_SOURCES_FILE`
- `KB_ACCESS_LOG_PATH`
- `KB_EMBEDDING_PROVIDER`
- `KB_EMBEDDING_MODEL`
- `KB_EMBEDDING_MODEL_PATH`
- `KB_TRANSFORMERS_ALLOW_REMOTE_MODELS`
- `KB_REDACTION_ENABLED`
- `KB_REDACTION_BUILT_IN`
- `KB_ACCESS_LOG`
- `KB_MCP_MAX_TOP_K`
- `KB_TOP_K`
- `KB_CHUNK_SIZE`
- `KB_CHUNK_OVERLAP`
- `KB_INCLUDE_EXTENSIONS`

## Library API

```ts
import { ingest, search, ask } from "@jcode.labs/mimir"

await ingest({ rebuild: true })
const results = await search("vendor invoice status")
const answer = await ask("What documents support the project timeline?")
```

## Privacy

- Mimir core does not generate answers or call a chat model.
- `local-hash` can run ingestion, search, and cited retrieval without a model runtime.
- Transformers.js remote model loading is disabled by default.
- Built-in redaction runs before indexing by default.
- Access logs store query hashes, not raw queries.
- The vector index is stored locally.
- Raw private documents should stay in the target repository's ignored `private/` folder.
- Do not put secrets or scans inside this package repository.

## License

MIT © Jean-Baptiste Thery.
