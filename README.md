# Mimir

[![CI](https://github.com/jcode-works/jcode-mimir/actions/workflows/ci.yml/badge.svg)](https://github.com/jcode-works/jcode-mimir/actions/workflows/ci.yml)
[![CodeQL](https://github.com/jcode-works/jcode-mimir/actions/workflows/codeql.yml/badge.svg)](https://github.com/jcode-works/jcode-mimir/actions/workflows/codeql.yml)
[![npm](https://img.shields.io/npm/v/@jcode.labs/mimir)](https://www.npmjs.com/package/@jcode.labs/mimir)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/jcode-works/jcode-mimir/blob/main/LICENSE)

Open-source, sovereign local RAG for confidential datasets and AI agents.

Mimir provides a TypeScript CLI, library, MCP server, and portable agent skills that can be
installed in any Node.js repository. It indexes local files from the target repository, stores
vectors locally with LanceDB, and can use either built-in local-hash retrieval or optional
Transformers.js semantic embeddings.

Mimir core returns cited retrieval context. Answer synthesis belongs to the AI agent, LLM, or local
model runtime you choose around it.

Created by Jean-Baptiste Thery and published under the JCode Labs npm scope.

Built by Jean-Baptiste Thery, freelance full-stack/AI tooling engineer at JCode Labs.

## Packages

This root README is the canonical product documentation for the public npm packages.

| Package | Role |
| --- | --- |
| `@jcode.labs/mimir` | Core CLI, library, MCP server, bundled agent skills, and synthetic examples. |
| `@jcode.labs/mimir-tts` | Plug-and-play Edge-quality MP3 and offline Transformers.js WAV renderer used by `kb audio`. |

The package README files are intentionally short because npm displays each package README
separately. They point npm readers back to this GitHub documentation.

## Open Source

Mimir is a public open-source project under the MIT License. It is designed to be inspectable,
forkable, and usable without a JCode Labs account.

Contributions are welcome through pull requests. Start with [`CONTRIBUTING.md`](./CONTRIBUTING.md).
Security reports should stay private and follow [`SECURITY.md`](./SECURITY.md).

## Sponsors

Mimir stays MIT open source. Sponsorship helps fund maintenance, issue triage, documentation, and
practical agent-workflow improvements.

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
- Retrieve grounded local evidence through CLI, library calls, MCP tools, or bundled agent skills.
- Optionally create listenable MP3 or WAV summaries with `kb audio`, `@jcode.labs/mimir-tts`, and
  the bundled `mimir-audio-summary` skill.

Mimir is not a hosted SaaS, not a remote vector database, and not a certified high-assurance system.
For regulated or state-grade environments, pair it with encrypted disks, controlled machines,
release verification, and an external security review.

## Use Cases

Mimir is useful whenever source material should stay local but an AI agent still needs grounded
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
| Generate audio briefings | "Create a listenable high-quality or offline summary of the current dossier." |

## Requirements

- Node.js 20 or newer.
- pnpm, npm, yarn, or bun.
- A repository where generated local folders can be ignored by Git.
- No model runtime is required for the default `embeddingProvider: "local-hash"` mode.
- Optional semantic embeddings use Transformers.js with local model files under `.mimir/models` by
  default.
- Generated answers are intentionally outside Mimir core. Use Claude, Codex, OpenAI, a local model
  MCP server, or another trusted model runtime to synthesize from Mimir's cited context.
- Optional audio summaries use `@jcode.labs/mimir-tts`. For highest-quality MP3, install the
  external `edge-tts` CLI and render with `--engine edge`. For confidential or air-gapped content,
  use the Transformers.js WAV path with `--engine transformers --offline`; it does not require
  Python, ffmpeg, Piper, XTTS, or a local server.

## Install

The package is public. Users do not need a JCode Labs account or npm token to install it.

With pnpm:

```bash
pnpm add -D @jcode.labs/mimir
```

With npm:

```bash
npm install --save-dev @jcode.labs/mimir
```

Install the standalone TTS package only when you want to use it directly:

```bash
pnpm add -D @jcode.labs/mimir-tts
```

Maintainer tokens are only needed to publish new versions.

## Quick Start

Initialize a repository, install the portable agent kit, run readiness checks, and ingest documents
when supported files are already present:

```bash
pnpm exec kb setup
```

`kb setup` creates or updates:

```plain text
private/                         # raw documents to ingest
.kb/config.json                  # local config
.kb/sources.txt                  # optional extra source paths
.mimir/skills/mimir/SKILL.md     # portable agent skill
.mimir/skills/mimir-audio-summary/SKILL.md
.mimir/mcp.json                  # MCP server config snippet
.gitignore                       # ignores private/**, .kb/, and .mimir/
```

It detects the repository package manager and writes `.mimir/mcp.json` with the right command, such
as `pnpm exec kb serve-mcp`, `npx kb serve-mcp`, `yarn exec kb serve-mcp`, or `bunx kb serve-mcp`.

Check readiness at any time:

```bash
pnpm exec kb doctor
```

If files are missing from the index, stale, or the setup is incomplete, run:

```bash
pnpm exec kb doctor --fix
```

`doctor --fix` performs safe repairs: missing scaffolding, Git ignore entries, agent kit install, and
index rebuild when supported files are present and the privacy posture has no warnings.

Manual initialization is still available:

```plain text
private/          # raw documents to ingest
.kb/config.json   # local config
.kb/sources.txt   # optional extra source paths
.gitignore        # ignores private/**, .kb/, and .mimir/
```

Put supported files under `private/`:

```plain text
private/
  policy.md
  meeting-notes.pdf
  requirements.docx
```

Build the local index:

```bash
pnpm exec kb ingest
pnpm exec kb doctor
```

When the index is ready, `kb doctor` prints `ready=true`.

Retrieve exact passages:

```bash
pnpm exec kb search "approval for offline operation"
```

Return cited retrieval context for an agent or model:

```bash
pnpm exec kb ask "What evidence supports offline operation?"
```

Mimir does not synthesize an LLM answer. It returns cited local passages; your chosen agent or model
does the writing around those passages.

With npm, use `npx` after installing the package:

```bash
npx kb setup
npx kb doctor
npx kb search "approval for offline operation"
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

## Agent Skills And MCP

Mimir ships with portable agent skills and a standard MCP server.

If `kb setup` was not used, install the agent kit into a repository:

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

Agents that support skill folders can load `.mimir/skills/mimir/` for deep local RAG usage. Load
`.mimir/skills/mimir-audio-summary/` only when an optional spoken summary is needed. Other agents can
read the generated `.mimir/README.md` and use the MCP config snippet.

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

## Audio Summaries

Mimir includes a plug-and-play text-to-speech path for listenable summaries.

For the same quality path as the global Voice Forge skill, install `edge-tts` and render MP3:

```bash
pnpm exec kb audio --doctor
pipx install edge-tts
pnpm exec kb audio /tmp/MIMIR-SUMMARY-project.txt \
  --engine edge \
  --out .mimir/audio/project-summary.mp3
```

The Edge path uses the online Microsoft Edge TTS service through the `edge-tts` CLI. Use it only
when sending the narration text to that service is acceptable. MP3 output requires explicit
`--engine edge` for this reason.

By default, `kb audio` uses the Transformers.js WAV path. For confidential or air-gapped work,
preload Transformers.js-compatible model files and render WAV offline:

```bash
pnpm exec kb audio /tmp/MIMIR-SUMMARY-project.txt \
  --engine transformers \
  --offline \
  --model-path .mimir/models/tts \
  --out .mimir/audio/project-summary.wav
```

Use the standalone package directly:

```bash
pnpm exec mimir-tts doctor --json
pnpm exec mimir-tts render /tmp/MIMIR-SUMMARY-project.txt \
  --engine edge \
  --out .mimir/audio/project-summary.mp3
```

The default standalone engine is `transformers`. The default Transformers.js model is
`Xenova/mms-tts-fra`. Override it with `--model` or `MIMIR_TTS_MODEL`.

## Data Boundary

The package code lives in `node_modules` or in this repository. Project data stays in the repository
where you run the CLI:

```plain text
your-project/
  private/          # raw documents to ingest
  .kb/config.json   # local config
  .kb/sources.txt   # optional extra source paths
  .kb/storage/      # generated LanceDB index
  .kb/access.log    # metadata-only access log
```

The package never ships project documents. `kb setup` adds gitignore entries for `.kb/`,
`.mimir/`, and `private/**`. Generated indexes, agent files, and raw documents stay local to the
target repository.

## Confidentiality Defaults

Mimir is designed for private repositories and sensitive local evidence.

- Zero telemetry: no analytics or document content is sent to JCode Labs.
- No LLM generation in core: Mimir returns cited context for the agent/runtime you choose.
- Local-hash by default: no model runtime is required for the default retrieval path.
- Transformers.js remote model loading is disabled by default.
- Redaction before indexing: common secrets and identifiers are redacted before chunks are embedded
  and stored.
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

`destroy-index` does not securely erase SSD or copy-on-write storage. For strong deletion
guarantees, use encrypted storage and destroy the encryption key.

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
- Source code: `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.go`, `.rs`, `.java`, `.rb`, `.php`, `.cs`,
  `.c`, `.cpp`, `.h`, `.css`

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

## Configuration Reference

Default `.kb/config.json`:

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

## CLI Reference

Mimir ships two CLIs:

- `kb`: the main local RAG, MCP, skills, security, and audio command.
- `mimir-tts`: the standalone text-to-speech renderer used by `kb audio`.

### Main Workflow

| Command | Use it when |
| --- | --- |
| `kb setup` | Initialize Mimir, install the agent kit, run doctor, and ingest when safe. |
| `kb init` | Create `.kb/config.json`, `.kb/sources.txt`, `private/`, and Git ignore rules. |
| `kb doctor` | Diagnose setup, index freshness, security warnings, and the next command to run. |
| `kb doctor --fix` | Create missing scaffolding, install skills/MCP config, and rebuild stale indexes when safe. |
| `kb ingest` | Parse source files, redact, chunk, embed, and rebuild the local LanceDB index. |
| `kb audit` | Check whether supported source files are missing from or stale in the index. |
| `kb search "<query>"` | Retrieve ranked passages without asking an LLM to write an answer. |
| `kb ask "<question>"` | Return cited retrieval context for an agent or trusted model runtime. |
| `kb security-audit` | Inspect privacy posture: telemetry, providers, redaction, Git ignore, MCP. |
| `kb status` | Print raw config paths, provider settings, and indexed chunk count. |

### Agent Integration

| Command | Use it when |
| --- | --- |
| `kb install-skill` | Copy portable agent skills and an MCP config snippet into `.mimir/`. |
| `kb skill-path` | Print the package-bundled skill path for agents that load installed package skills. |
| `kb serve-mcp` | Start the MCP stdio server for compatible agents. |

### Maintenance And Safety

| Command | Use it when |
| --- | --- |
| `kb destroy-index --yes` | Delete generated `.kb/storage` index files. |
| `kb security-audit --strict` | Fail the command when privacy warnings are present. |

### Audio

| Command | Use it when |
| --- | --- |
| `kb audio --doctor` | Check TTS runtime readiness. |
| `kb audio <file> --engine transformers --offline --out .mimir/audio/name.wav` | Render a confidential/offline WAV. |
| `kb audio <file> --engine edge --out .mimir/audio/name.mp3` | Render a higher-quality online Edge MP3. |
| `mimir-tts doctor --json` | Inspect the standalone TTS package. |
| `mimir-tts render <file> --offline --out .mimir/audio/name.wav` | Render directly through the TTS package. |

### Important Options

| Option | Applies to | Meaning |
| --- | --- | --- |
| `--top-k <number>` | `search`, `ask` | Number of passages to return. |
| `--json` | `doctor`, `security-audit`, `audio --doctor`, `mimir-tts doctor` | Print machine-readable JSON. |
| `--strict` | `security-audit` | Exit non-zero when warnings exist. |
| `--offline` | `audio`, `mimir-tts render` | Disable remote model downloads and force the local Transformers.js path. |
| `--allow-remote-models` | `audio`, `mimir-tts render` | Explicitly allow model downloads for Transformers.js. |
| `--engine edge` | `audio`, `mimir-tts render` | Use online Edge TTS for MP3 output. |

## Library API

```ts
import { ask, ingest, search } from "@jcode.labs/mimir"

await ingest({ rebuild: true })
const results = await search("vendor invoice status")
const answer = await ask("What documents support the project timeline?")
```

## Troubleshooting

Use `kb doctor` first. It is the shortest path to the next useful action:

```bash
pnpm exec kb doctor
```

Use `doctor --fix` when you want Mimir to repair safe setup issues automatically:

```bash
pnpm exec kb doctor --fix
```

### `kb doctor` Says The Project Is Not Initialized

Run:

```bash
pnpm exec kb setup
pnpm exec kb doctor
```

Commit only safe scaffolding if this is a real repository. Do not commit private documents,
`.kb/storage`, `.mimir/`, env files, or credentials.

### No Files Are Indexed

Check that supported files exist under `private/`:

```bash
find private -maxdepth 2 -type f
pnpm exec kb ingest
pnpm exec kb doctor
```

If documents live elsewhere, add one path per line to `.kb/sources.txt`. Relative paths resolve from
the project root.

### Search Returns Weak Results

The default `local-hash` provider is dependency-light and offline, but it is lexical/hash retrieval,
not semantic retrieval.

For better semantic retrieval, configure Transformers.js embeddings and preload the model when
working offline:

```json
{
  "embeddingProvider": "transformers",
  "embeddingModel": "mixedbread-ai/mxbai-embed-xsmall-v1",
  "embeddingModelPath": ".mimir/models",
  "transformersAllowRemoteModels": false
}
```

Switching providers requires a full re-ingest:

```bash
pnpm exec kb ingest
pnpm exec kb doctor
```

### `kb audit` Reports Missing Or Stale Files

Run:

```bash
pnpm exec kb ingest
pnpm exec kb audit
```

Or let doctor perform the safe rebuild:

```bash
pnpm exec kb doctor --fix
```

Mimir rebuilds the index on each ingest. The `--rebuild` flag is accepted for compatibility, but
ingest already rebuilds.

### `security-audit --strict` Fails

Read the warning lines. Common causes:

- `.kb/`, `.mimir/`, or `private/**` are not ignored by Git.
- Redaction was disabled.
- Transformers.js remote model loading was enabled.

Run the safe repair command if Git ignore entries are missing:

```bash
pnpm exec kb doctor --fix
pnpm exec kb security-audit --strict
```

### MP3 Audio Fails Without `--engine edge`

This is intentional. MP3 output uses online Edge TTS and requires explicit consent:

```bash
pnpm exec kb audio /tmp/summary.txt \
  --engine edge \
  --out .mimir/audio/summary.mp3
```

For confidential or offline work, use WAV:

```bash
pnpm exec kb audio /tmp/summary.txt \
  --engine transformers \
  --offline \
  --out .mimir/audio/summary.wav
```

### Edge TTS Is Not Installed

Install the external CLI:

```bash
pipx install edge-tts
pnpm exec kb audio --doctor
```

Only use Edge TTS when sending narration text to the online service is acceptable.

### `mimir-tts --offline` Cannot Render

Offline rendering requires model files to already exist under `.mimir/models/tts` or the path passed
with `--model-path`.

For a first online setup on non-sensitive text:

```bash
pnpm exec mimir-tts render /tmp/test.txt --out .mimir/audio/test.wav
```

Then reuse the cached files with:

```bash
pnpm exec mimir-tts render /tmp/test.txt --offline --out .mimir/audio/test.wav
```

## Dependency Footprint

Mimir can run retrieval without a model runtime. Some runtime dependencies remain because they own
core features:

| Dependency | Why it remains |
| --- | --- |
| `@huggingface/transformers` | Optional local semantic embeddings and offline TTS. |
| LanceDB | Local vector storage and nearest-neighbor retrieval. |
| MCP SDK | MCP server for compatible agents. |
| fast-glob | Safe source-file discovery. |
| unpdf, html-to-text, yaml, fflate | Document parsing for PDF, HTML, YAML, Office/OpenDocument ZIP files. |
| commander, zod, picocolors | CLI, config validation, readable terminal output. |

Removing more dependencies is possible only by dropping features or replacing them with smaller
internal implementations. The current low-friction path is dependency-light at runtime for users who
choose `local-hash`, while preserving richer parsing, MCP support, and optional semantic embeddings.

## Example Test Workspace

This repository includes a synthetic example under
[`packages/mimir/examples/sovereign-rag-demo`](./packages/mimir/examples/sovereign-rag-demo). It can
be used to test ingestion, retrieval, `security-audit`, and custom text extensions without using
private documents.

From a local checkout:

```bash
pnpm build
cd packages/mimir/examples/sovereign-rag-demo
node ../../dist/cli.js security-audit
node ../../dist/cli.js ingest
node ../../dist/cli.js search "offline retrieval approval"
node ../../dist/cli.js audit
```

The example uses the default local-hash retrieval mode, so it can run without downloading an
embedding or chat model.

## Development

Install and validate the monorepo:

```bash
pnpm install
pnpm validate
```

Useful filtered commands:

```bash
pnpm --filter @jcode.labs/mimir test
pnpm --filter @jcode.labs/mimir-tts test
pnpm --filter @jcode.labs/mimir build
pnpm --filter @jcode.labs/mimir-tts build
```

`packages/mimir/dist/` and `packages/mimir-tts/dist/` are committed. After changing TypeScript
sources, run:

```bash
pnpm build
pnpm validate
```

CI checks that generated `dist/` files match the source.

The root package is private and only orchestrates workspace tasks. npm publishing is handled by the
protected `Publish npm` GitHub Actions workflow, which publishes `@jcode.labs/mimir-tts` before
`@jcode.labs/mimir`.

Build from source:

```bash
git clone git@github.com:jcode-works/jcode-mimir.git
cd jcode-mimir
pnpm install
pnpm build
```

Use a local checkout in another repository:

```bash
pnpm add -D file:../jcode-mimir/packages/mimir
```

Create a local npm tarball:

```bash
pnpm build
pnpm --dir packages/mimir pack
```

## Supporting Documents

- [`SECURITY-HARDENING.md`](./SECURITY-HARDENING.md): threat model, offline operation, release
  verification, and high-assurance deployment notes.
- [`docs/ux-dx-audit.md`](./docs/ux-dx-audit.md): current UX/DX findings, fixes, and remaining
  product risks.

## License

MIT (c) Jean-Baptiste Thery.
