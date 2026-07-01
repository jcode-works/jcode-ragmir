# Mimir

[![CI](https://github.com/jcode-works/jcode-mimir/actions/workflows/ci.yml/badge.svg)](https://github.com/jcode-works/jcode-mimir/actions/workflows/ci.yml)
[![CodeQL](https://github.com/jcode-works/jcode-mimir/actions/workflows/codeql.yml/badge.svg)](https://github.com/jcode-works/jcode-mimir/actions/workflows/codeql.yml)
[![npm](https://img.shields.io/npm/v/@jcode.labs/mimir)](https://www.npmjs.com/package/@jcode.labs/mimir)
[![npm downloads](https://img.shields.io/npm/dm/@jcode.labs/mimir?label=downloads%2Fmonth)](https://www.npmjs.com/package/@jcode.labs/mimir)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/jcode-works/jcode-mimir/blob/main/LICENSE)

Open-source, sovereign local RAG for confidential datasets and AI agents.

Mimir provides a TypeScript CLI, library, MCP server, and portable agent skills that can be
installed in any Node.js repository. It indexes local files from the target repository, stores
vectors locally with LanceDB, and can use either built-in local-hash retrieval or optional
Transformers.js semantic embeddings.

Mimir Core returns cited retrieval context. Answer synthesis belongs to the AI agent, LLM, or local
model runtime you choose around it.

Created by Jean-Baptiste Thery and published under the JCode Labs npm scope.

Built by Jean-Baptiste Thery, freelance full-stack/AI tooling engineer at JCode Labs.

## Developer Use Cases

Mimir is designed for agent-assisted development when the useful context is local, private, and
spread across repositories, specifications, exports, and synced folders.

| Use case | What it enables |
| --- | --- |
| Index a repository's documentation | Ask Claude Code, Codex, Kimi Code CLI, OpenCode, Cline, or another agent to implement features from local README files, architecture notes, API contracts, ADRs, and runbooks. |
| Code from a specification or `cahier des charges` | Turn a local PRD, tender response, client brief, or engineering spec into an implementation plan, acceptance checklist, and cited change guidance. |
| Work from a downloaded Google Drive folder | Point Mimir at files synced locally through Google Drive for desktop, then let the agent retrieve context without uploading the corpus to a hosted RAG service. |
| Onboard to a legacy codebase | Ask where a flow is implemented, which modules own a responsibility, which docs explain a behavior, and what to read before changing risky code. |
| Keep multiple agents on the same evidence | Install the same project skills and MCP server for Claude Code, Codex, Kimi Code CLI, OpenCode, and Cline so each tool retrieves from the same local index. |
| Prepare implementation and review work | Generate cited task breakdowns, migration notes, release checklists, QA plans, and code-review context from the same local sources the team uses. |
| Audit local knowledge coverage | Check which supported files were indexed, which formats were skipped, whether secrets are likely present, and whether golden queries still retrieve expected evidence. |

The workflow stays simple: keep files on disk, run `mimir ingest`, connect your coding agent through
MCP or portable skills, then ask it to work from cited local passages.

## At A Glance

Mimir is the local evidence layer for AI agents: put documents in a repository, index them locally,
then let your CLI, MCP-compatible agent, or bundled skills retrieve cited passages without uploading
the corpus to a hosted RAG service.

```mermaid
flowchart TD
  subgraph Workspace["Your repository"]
    Docs["Local files<br/>docs, specs, code, PDFs"]
    Config[".mimir/config.json<br/>.mimir/raw/"]
    Index[".mimir/storage<br/>local LanceDB index"]
  end

  subgraph Mimir["Mimir Core"]
    Ingest["mimir ingest<br/>parse, redact, chunk"]
    Retrieve["mimir search / ask<br/>rank cited passages"]
    Audit["doctor, audit,<br/>security-audit, evaluate"]
  end

  subgraph Agents["Developer tools"]
    CLI["Terminal"]
    MCP["MCP server"]
    Skills["Portable agent skills"]
    LLM["Claude, Codex,<br/>or your trusted model"]
  end

  Docs --> Ingest
  Config --> Ingest
  Ingest --> Index
  Index --> Retrieve
  Index --> Audit
  Retrieve --> CLI
  Retrieve --> MCP
  Skills --> MCP
  MCP --> LLM
```

The fastest useful path is to install Mimir in the repository, wire it into the coding agent you
already use, then ask that agent questions grounded in local files:

```bash
pnpm add -D @jcode.labs/mimir
pnpm exec mimir setup
pnpm exec mimir install-agent --agents claude,codex,kimi,opencode,cline
pnpm exec mimir doctor --fix

# Claude Code
claude mcp add-json --scope local mimir "$(cat .mimir/claude-mcp-server.json)"

# Codex
cat .mimir/codex-mcp.toml

# Kimi Code CLI
kimi --mcp-config-file .mimir/kimi-mcp.json

# OpenCode
cat .mimir/opencode.jsonc

# Cline
cat .mimir/cline-mcp.json
```

Use it when an agent needs grounded context over private specs, codebases, legal dossiers, tenders,
course material, project archives, or meeting notes, but the files should remain on your machine.

## Packages

This root README is the canonical product documentation for the public npm packages.

| Package | Role |
| --- | --- |
| `@jcode.labs/mimir` | Mimir Core: CLI, library, MCP server, bundled agent skills, and synthetic examples. |
| `@jcode.labs/mimir-tts` | Mimir add-on for Edge-quality MP3 and offline Transformers.js WAV rendering through `mimir audio`. |
| `@jcode.labs/mimir-ui` | Unpublished workspace UI package adapted from the WorkoutGen design foundation for Mimir surfaces. |
| `@jcode.labs/mimir-landing` | Unpublished Astro static landing package. Product-facing titles stay `Mimir`. |
| `@jcode.labs/mimir-app` | Unpublished Tauri desktop/mobile shell package. Native builds are explicit app commands. Core integration uses a bounded native command around the `mimir` CLI, with packaged sidecar distribution still planned. |
| `@jcode.labs/mimir-license-webhook` | Unpublished, undeployed MIT-licensed Cloudflare Worker handler for future Lemon Squeezy webhooks and local `MIMIR1` license issuance. |

The package README files are intentionally short because npm displays each package README
separately. They point npm readers back to this GitHub documentation.

The product name visible to users is **Mimir**. The technical core package is **Mimir Core** and now
lives under `packages/mimir-core`; the public npm package name remains `@jcode.labs/mimir`.

The public source and commercial distribution boundary is tracked in
[`docs/source-boundary.md`](./docs/source-boundary.md) and
[`docs/commercial-distribution.md`](./docs/commercial-distribution.md). No checkout URL, production
download URL, customer data, or license secret is committed to this repository.

## Open Source

Mimir is a public open-source project under the MIT License. It is designed to be inspectable,
forkable, and usable without a JCode Labs account.

Every tracked package in this repository is visible source. Commercial Mimir app distribution can
gate official signed builds, support, updates, and hosted license delivery, but it does not make the
tracked Tauri app or webhook source proprietary.

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

## Desktop Client Preview

Mimir Core is the open-source product you can use today through the CLI, library, MCP server, and
portable agent skills.

A cross-platform Mimir desktop/mobile client is being developed in `packages/mimir-app`. Its goal is
to make local confidential workspaces easier for non-CLI workflows: register a local dossier, run
setup and ingest, ask questions with cited local passages, inspect privacy posture, and preload
embedding models explicitly. Google Drive support is implemented as an opt-in local-sync folder flow
over files already present on disk, not as a default cloud API integration.

The native client is not released, signed, or commercially distributed yet. There is no checkout,
waitlist, or hosted account flow in this repository. When released, it is planned for direct
downloads and sideloadable installers, not App Store or Play Store distribution.

The canonical landing and future direct-download release URL is
[`mimir.jcode.works`](https://mimir.jcode.works). It is prepared as a Cloudflare Workers Static Assets
site, but public deployment remains a separate release action.

## What Mimir Is For

- Build a local RAG knowledge base inside any repository.
- Analyze confidential datasets while keeping raw files and generated indexes local.
- Give Claude, Codex, Cursor, internal assistants, or other MCP-compatible tools the same private
  retrieval layer.
- Retrieve grounded local evidence through CLI, library calls, MCP tools, or bundled agent skills.
- Optionally create listenable MP3/WAV summaries or cited Markdown reports with bundled skills.
- Prepare legal-dossier summaries, chronologies, clause reviews, and professional-review handoffs
  with the optional bundled legal skill.

Mimir is not a hosted SaaS, not a remote vector database, and not a certified high-assurance system.
For regulated or state-grade environments, pair it with encrypted disks, controlled machines,
release verification, and an external security review.

## Requirements

- Node.js 20 or newer.
- pnpm, npm, yarn, or bun.
- A repository where generated local folders can be ignored by Git.
- No model runtime is required for the default `embeddingProvider: "local-hash"` mode.
- Optional semantic embeddings use Transformers.js with local model files under `.mimir/models` by
  default. Use `mimir models pull` when remote model download is acceptable, then keep
  `transformersAllowRemoteModels` false for confidential indexing.
- Generated answers are intentionally outside Mimir core. Use Claude, Codex, OpenAI, a local model
  MCP server, or another trusted model runtime to synthesize from Mimir's cited context.
- Optional audio summaries use `@jcode.labs/mimir-tts`. For highest-quality MP3, install the
  external `edge-tts` CLI and render with `--engine edge`. For confidential or air-gapped content,
  use the Transformers.js WAV path with `--engine transformers --offline`; it does not require
  Python, ffmpeg, Piper, XTTS, or a local server.
- Optional Markdown reports use the bundled `mimir-markdown-report` skill and should stay under
  ignored `.mimir/reports/` unless explicitly sanitized for sharing.

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
pnpm exec mimir setup
```

Fresh setup keeps local state under one ignored `.mimir/` folder:

```plain text
.mimir/config.json               # local config
.mimir/sources.txt               # optional extra source paths
.mimir/raw/                      # raw documents to ingest
.mimir/storage/                  # generated LanceDB index after ingest
.mimir/access.log                # metadata-only access log after use
.mimir/skills/mimir/SKILL.md     # portable agent skill
.mimir/skills/mimir-audio-summary/SKILL.md
.mimir/skills/mimir-markdown-report/SKILL.md
.mimir/skills/mimir-legal-dossier/SKILL.md
.mimir/mcp.json                  # generic MCP server config snippet
.mimir/claude-mcp-server.json    # Claude Code add-json payload
.mimir/codex-mcp.toml            # Codex config.toml snippet with MCP and skills.config
.mimir/kimi-mcp.json             # Kimi Code CLI MCP config
.mimir/opencode.jsonc            # OpenCode config snippet
.mimir/cline-mcp.json            # Cline MCP config
.mimir/agent-setup.md            # agent-specific setup guide
.gitignore                       # ignores .mimir/
```

It detects the repository package manager and writes the MCP helper files with the right command:
`pnpm exec mimir serve-mcp`, `npx mimir serve-mcp`, `yarn exec mimir serve-mcp`, or `bunx mimir serve-mcp`.

For the usual agent-first workflow, expose Mimir to the coding assistants used in the repository:

```bash
pnpm exec mimir install-agent --agents claude,codex,kimi,opencode,cline
```

Then wire the agent you use. Claude Code, Codex, and Cline follow the standard MCP shapes from their
public docs; Kimi and OpenCode use the generated helper files that Mimir writes under `.mimir/`.

```bash
# Claude Code: registers the local MCP server for this repository.
claude mcp add-json --scope local mimir "$(cat .mimir/claude-mcp-server.json)"

# Codex: review and merge the generated MCP and skills config.
cat .mimir/codex-mcp.toml

# Kimi Code CLI: launch Kimi with the generated Mimir MCP config.
kimi --mcp-config-file .mimir/kimi-mcp.json

# OpenCode: review and merge the generated OpenCode JSONC snippet.
cat .mimir/opencode.jsonc

# Cline: add the generated JSON under Cline's mcpServers configuration.
cat .mimir/cline-mcp.json
```

From the agent, ask naturally, for example: "Use Mimir to find what this repository says about
deployment." The agent calls the MCP tools and uses the bundled skills to work with cited local
context.

Check readiness at any time:

```bash
pnpm exec mimir doctor
```

If files are missing from the index, stale, or the setup is incomplete, run:

```bash
pnpm exec mimir doctor --fix
```

`doctor --fix` performs safe repairs: missing scaffolding, Git ignore entries, agent kit install, and
index rebuild when supported files are present and the privacy posture has no warnings.

Manual initialization is still available:

```plain text
.mimir/config.json   # local config
.mimir/sources.txt   # optional extra source paths
.mimir/raw/          # raw documents to ingest
.gitignore           # ignores .mimir/
```

Put supported files under `.mimir/raw/`:

```plain text
.mimir/raw/
  policy.md
  meeting-notes.pdf
  requirements.docx
```

Build the local index:

```bash
pnpm exec mimir ingest
pnpm exec mimir doctor
```

When the index is ready, `mimir doctor` prints `ready=true`. `mimir ingest` and `mimir audit` also report
files that were discovered but not indexed because the type is unsupported, the file is too large,
or the file name looks like a secret/private key.

List skipped paths explicitly:

```bash
pnpm exec mimir audit --unsupported
```

Summarize recent metadata-only usage without exposing raw queries or local paths:

```bash
pnpm exec mimir usage-report --days 7
```

Retrieve exact passages:

```bash
pnpm exec mimir search "approval for offline operation"
```

Return cited retrieval context for an agent or model:

```bash
pnpm exec mimir ask "What evidence supports offline operation?"
```

Measure recall against a golden query file:

```bash
pnpm exec mimir evaluate --golden golden-queries.json
```

For private dogfooding, keep the real corpus and golden query file outside Git or under an ignored
local path, then use a threshold that matches the evaluation phase:

```bash
pnpm exec mimir --project-root /path/to/workspace ingest
pnpm exec mimir --project-root /path/to/workspace evaluate --golden .mimir/evaluations/golden-queries.json --fail-under 0.8 --json
```

The JSON report includes the active `embeddingProvider` and `embeddingModel`, so you can compare
default local-hash recall with a private Transformers semantic run without storing the report in Git.

Mimir does not synthesize an LLM answer. It returns cited local passages; your chosen agent or model
does the writing around those passages.

With npm, use `npx` after installing the package:

```bash
npx mimir setup
npx mimir doctor
npx mimir search "approval for offline operation"
```

## Choose A Retrieval Mode

Mimir has two embedding modes.

### Default Local Hash Retrieval

Use this when you want a fully local, no-model smoke test or a dependency-light setup. Retrieval is
lexical/hash-based, not semantic.

`.mimir/config.json`:

```json
{
  "embeddingProvider": "local-hash"
}
```

Commands:

```bash
pnpm exec mimir ingest
pnpm exec mimir search "offline retrieval approval"
pnpm exec mimir ask "What evidence supports offline operation?"
```

`mimir ask` always returns cited retrieved passages instead of a generated synthesis. You can pass those
passages to any LLM or agent you trust.

### Optional Semantic Embeddings With Transformers.js

Use this when you want better semantic retrieval while keeping Mimir core free of an LLM server.

`.mimir/config.json`:

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
pnpm exec mimir models pull --enable
pnpm exec mimir ingest
pnpm exec mimir ask "Which passages support offline operation?"
```

`mimir models pull` intentionally allows a one-time download from Hugging Face into
`embeddingModelPath`. With `--enable`, it also switches `.mimir/config.json` to
`embeddingProvider: "transformers"` while keeping `transformersAllowRemoteModels` false for
confidential or air-gapped indexing. Re-run `mimir ingest --rebuild` after changing embedding
provider or model so stored vectors match the active configuration.

## Agent Skills And MCP

Mimir ships with portable agent skills and a standard MCP server.

Use `mimir setup` for the normal path, or install only the agent layer later:

```bash
pnpm exec mimir install-skill
pnpm exec mimir install-agent --agents claude,codex,kimi,opencode,cline
```

Main agent examples:

```bash
# Claude Code
claude mcp add-json --scope local mimir "$(cat .mimir/claude-mcp-server.json)"

# Codex
cat .mimir/codex-mcp.toml

# Kimi Code CLI
kimi --mcp-config-file .mimir/kimi-mcp.json

# OpenCode
cat .mimir/opencode.jsonc

# Cline
cat .mimir/cline-mcp.json
```

Start the MCP server from the repository root when a compatible agent needs tool access:

```bash
pnpm exec mimir serve-mcp
```

The MCP server exposes `mimir_status`, `mimir_search`, `mimir_ask`, `mimir_audit`,
`mimir_evaluate`, `mimir_usage_report`, and `mimir_security_audit`. The LLM does not need to know
about LanceDB or the raw file layout; it asks Mimir for ranked passages, cited context, local recall
gates, or metadata-only usage summaries and uses the returned citations.

Per-agent setup details live in [`docs/agent-integration.md`](./docs/agent-integration.md).

## Audio Summaries

Mimir includes a plug-and-play text-to-speech path for listenable summaries.

For the same quality path as the global Voice Forge skill, install `edge-tts` and render MP3:

```bash
pnpm exec mimir audio --doctor
pipx install edge-tts
pnpm exec mimir audio /tmp/MIMIR-SUMMARY-project.txt \
  --engine edge \
  --out .mimir/audio/project-summary.mp3
```

The Edge path uses the online Microsoft Edge TTS service through the `edge-tts` CLI. Use it only
when sending the narration text to that service is acceptable. MP3 output requires explicit
`--engine edge` for this reason.

By default, `mimir audio` uses the Transformers.js WAV path. For confidential or air-gapped work,
preload Transformers.js-compatible model files with non-sensitive text, then render WAV offline:

```bash
pnpm exec mimir audio /tmp/MIMIR-SUMMARY-project.txt \
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

See [`docs/offline-tts-preload.md`](./docs/offline-tts-preload.md) for the exact preload and
offline-check workflow.

## Data Boundary

The package code lives in `node_modules` or in this repository. Project data stays in the repository
where you run the CLI:

```plain text
your-project/
  .mimir/config.json   # local config
  .mimir/sources.txt   # optional extra source paths
  .mimir/raw/          # raw documents to ingest
  .mimir/storage/      # generated LanceDB index
  .mimir/access.log    # metadata-only access log
```

The package never ships project documents. `mimir setup` adds a `.mimir/` gitignore entry, so
generated indexes, agent files, raw documents, reports, models, audio, and access logs stay local to
the target repository.

Legacy projects that already have `.kb/config.json` keep working. In that mode, Mimir preserves the
old defaults (`private/`, `.kb/storage`, `.kb/sources.txt`, `.kb/access.log`) and accepts existing
`KB_*` environment variables. New setup and docs use `.mimir/` and `MIMIR_*`.

## Confidentiality Defaults

Mimir is designed for private repositories and sensitive local evidence.

- Zero telemetry: no analytics or document content is sent to JCode Labs.
- No LLM generation in core: Mimir returns cited context for the agent/runtime you choose.
- Local-hash by default: no model runtime is required for the default retrieval path.
- Transformers.js remote model loading is disabled by default.
- Redaction before indexing: common secrets and identifiers are redacted before chunks are embedded
  and stored.
- Metadata-only access logs: query hashes and action metadata are logged, not raw queries.
- Metadata-only usage reports: `mimir usage-report --days 7` summarizes recent local activity
  without exposing query text or local paths.
- MCP is read-focused and bounded by `mcpMaxTopK`.
- Generated local state is ignored by Git.

Run:

```bash
pnpm exec mimir security-audit --strict
```

Remove the generated vector index:

```bash
pnpm exec mimir destroy-index --yes
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
- EPUB: `.epub`
- PDF: `.pdf`
- Office/OpenDocument: `.docx`, `.pptx`, `.xls`, `.xlsx`, `.odt`, `.ods`, `.odp`
- Legacy Word: `.doc` only when an explicit local `legacyWordCommand` is configured
- Rich text: `.rtf`
- Notebook: `.ipynb`
- Subtitles/calendars/mail: `.vtt`, `.srt`, `.ics`, `.eml`
- Line data and logs: `.jsonl`, `.ndjson`, `.log`
- XML feeds and documents: `.xml`, `.rss`, `.atom`, `.svg`
- Config and data files: `.toml`, `.ini`, `.conf`, `.cfg`, `.properties`, `.sql`, `.example`,
  `.exemple`
- Common project metadata: `.gitignore`, `.dockerignore`, `.npmignore`, `.gitlab-ci.yml`,
  `.vscode/settings.json`, Maven wrapper `.properties`
- Source code: `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`, `.go`, `.rs`,
  `.java`, `.rb`, `.php`, `.cs`, `.c`, `.cpp`, `.h`, `.hpp`, `.css`, `.scss`, `.vue`, `.svelte`,
  `.astro`, `.sh`, `.bash`, `.bat`, `.cmd`, `.ps1`
- Common extensionless text wrappers: `mvnw`, `gradlew`, `Dockerfile`, `Makefile`, `Procfile`,
  `Gemfile`, `Rakefile`
- Documentation/code review text: `.rst`, `.adoc`, `.tex`, `.diff`, `.patch`, `.markdown`,
  `.mdown`, `.mmd`

Custom UTF-8 text extensions can be enabled without changing code:

```json
{
  "includeExtensions": [".transcript", ".evidence"]
}
```

Or through:

```bash
MIMIR_INCLUDE_EXTENSIONS=".transcript,.evidence" pnpm exec mimir ingest
```

Audio/video files and formats that are not listed are not useful to Mimir as-is. They can still be
valuable source evidence, but they should be transcribed, converted, or exported to text/PDF/HTML
first. `mimir audit --unsupported` prints per-file recommendations for these skipped formats.
Scanned PDFs can use an explicit `pdfOcrCommand` wrapper when you accept running local OCR tooling.
Standalone image files such as `.png`, `.jpg`, `.heic`, and `.tiff` stay unsupported by default, but
can be indexed through an explicit local `imageOcrCommand` wrapper. Old `.doc` Word binaries stay
unsupported by default, but can be indexed through an explicit local `legacyWordCommand` wrapper
when your workstation has a trusted extractor. If a supported file parses to no text, `mimir ingest
--json` reports it under `emptyTextFiles`. Mimir intentionally avoids pretending that every binary
format can be indexed safely without extraction logic.

Secret-like files such as `.env`, `.npmrc`, private keys, and certificates are skipped by default.
Convert safe examples to a normal text format before ingestion.

Dotfiles are discovered so useful project metadata is not silently missed. Sensitive
key/certificate-like files such as `.pem`, `.key`, `.p12`, `.pfx`, `.jks`, `.gpg`, and common secret
filenames such as `.env`, `.npmrc`, `.netrc`, and `.pgpass` are skipped by default even if they sit
under a source directory.

## Configuration Reference

Default `.mimir/config.json`:

```json
{
  "rawDir": ".mimir/raw",
  "storageDir": ".mimir/storage",
  "sourcesFile": ".mimir/sources.txt",
  "accessLogPath": ".mimir/access.log",
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
  "topK": 8,
  "chunkSize": 1200,
  "chunkOverlap": 200,
  "maxFileBytes": 50000000,
  "ingestConcurrency": 4,
  "embeddingBatchSize": 32,
  "includeExtensions": [],
  "pdfOcrCommand": [],
  "pdfOcrTimeoutMs": 120000,
  "imageOcrCommand": [],
  "imageOcrTimeoutMs": 120000,
  "legacyWordCommand": [],
  "legacyWordTimeoutMs": 120000
}
```

Environment overrides:

- `MIMIR_RAW_DIR`
- `MIMIR_STORAGE_DIR`
- `MIMIR_SOURCES_FILE`
- `MIMIR_ACCESS_LOG_PATH`
- `MIMIR_EMBEDDING_PROVIDER`
- `MIMIR_EMBEDDING_MODEL`
- `MIMIR_EMBEDDING_MODEL_PATH`
- `MIMIR_TRANSFORMERS_ALLOW_REMOTE_MODELS`
- `MIMIR_REDACTION_ENABLED`
- `MIMIR_REDACTION_BUILT_IN`
- `MIMIR_ACCESS_LOG`
- `MIMIR_MCP_MAX_TOP_K`
- `MIMIR_TOP_K`
- `MIMIR_CHUNK_SIZE`
- `MIMIR_CHUNK_OVERLAP`
- `MIMIR_MAX_FILE_BYTES`
- `MIMIR_INGEST_CONCURRENCY`
- `MIMIR_EMBEDDING_BATCH_SIZE`
- `MIMIR_INCLUDE_EXTENSIONS`
- `MIMIR_PDF_OCR_COMMAND` as a JSON array, for example `["mimir-pdf-ocr","{input}"]`
- `MIMIR_PDF_OCR_TIMEOUT_MS`
- `MIMIR_IMAGE_OCR_COMMAND` as a JSON array, for example `["mimir-image-ocr","{input}"]`
- `MIMIR_IMAGE_OCR_TIMEOUT_MS`
- `MIMIR_LEGACY_WORD_COMMAND` as a JSON array, for example `["mimir-doc-text","{input}"]`
- `MIMIR_LEGACY_WORD_TIMEOUT_MS`

Legacy `KB_*` aliases remain accepted for existing automation.

`pdfOcrCommand` is opt-in and only runs when normal PDF text extraction returns no text.
`imageOcrCommand` is also opt-in; image files are treated as supported only when it is configured.
`legacyWordCommand` is opt-in; `.doc` files are treated as supported only when it is configured.
External text commands are executed from the target project root without a shell, receive
`MIMIR_PDF_PATH`, `MIMIR_IMAGE_PATH`, or `MIMIR_LEGACY_WORD_PATH`, replace `{input}` placeholders
with the source path, and must print UTF-8 text to stdout.

## CLI Reference

Mimir ships two CLIs:

- `mimir`: the main local RAG, MCP, skills, security, and audio command. `kb` remains a legacy alias for compatibility.
- `mimir-tts`: the standalone text-to-speech renderer used by `mimir audio`.

Most users start with `mimir setup`, `mimir doctor`, `mimir ingest`, `mimir search`, `mimir ask`, and
`mimir security-audit`. Use `mimir models pull --enable` before semantic offline ingestion when
remote model download is acceptable, and `mimir ingest --rebuild` after switching embedding provider
or model.

The full command and option table lives in [`docs/cli-reference.md`](./docs/cli-reference.md).

## Library API

```ts
import { ask, ingest, search } from "@jcode.labs/mimir"

await ingest({ rebuild: true })
const results = await search("vendor invoice status")
const answer = await ask("What documents support the project timeline?")
```

The full public TypeScript API reference lives in
[`docs/api-reference.md`](./docs/api-reference.md).

## Troubleshooting

Use `mimir doctor` first. It is the shortest path to the next useful action:

```bash
pnpm exec mimir doctor
```

Use `doctor --fix` when you want Mimir to repair safe setup issues automatically:

```bash
pnpm exec mimir doctor --fix
```

Common fixes for empty indexes, weak search, strict security audit failures, and TTS setup live in
[`docs/troubleshooting.md`](./docs/troubleshooting.md).

## Dependency Footprint

Mimir can run retrieval without a model runtime. Some runtime dependencies remain because they own
core features:

| Dependency | Why it remains |
| --- | --- |
| `@huggingface/transformers` | Optional local semantic embeddings and offline TTS. |
| LanceDB | Local vector storage and nearest-neighbor retrieval. |
| MCP SDK | MCP server for compatible agents. |
| fast-glob | Safe source-file discovery. |
| unpdf, mammoth, xlsx, html-to-text, yaml, fflate | Document parsing for PDF, Office, HTML, YAML, OpenDocument, and EPUB files. |
| commander, zod, picocolors | CLI, config validation, readable terminal output. |

Removing more dependencies is possible only by dropping features or replacing them with smaller
internal implementations. The current low-friction path is dependency-light at runtime for users who
choose `local-hash`, while preserving richer parsing, MCP support, and optional semantic embeddings.

## Example Test Workspace

This repository includes a synthetic example under
[`packages/mimir-core/examples/sovereign-rag-demo`](./packages/mimir-core/examples/sovereign-rag-demo). It can
be used to test ingestion, retrieval, `security-audit`, and custom text extensions without using
private documents.

From a local checkout:

```bash
pnpm build
cd packages/mimir-core/examples/sovereign-rag-demo
node ../../dist/cli.js security-audit
node ../../dist/cli.js ingest
node ../../dist/cli.js search "offline retrieval approval"
node ../../dist/cli.js evaluate --golden golden-queries.json
node ../../dist/cli.js evaluate --golden golden-queries.json --fail-under 1
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
pnpm --filter @jcode.labs/mimir mcp:smoke
pnpm --filter @jcode.labs/mimir-tts test
pnpm --filter @jcode.labs/mimir-app build
pnpm --filter @jcode.labs/mimir-landing build
pnpm --filter @jcode.labs/mimir build
pnpm --filter @jcode.labs/mimir-tts build
```

`packages/mimir-core/dist/` and `packages/mimir-tts/dist/` are committed. `packages/mimir-app/dist/`
and `packages/mimir-landing/dist/` are ignored build artifacts. After changing TypeScript sources in
published packages, run:

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
pnpm add -D file:../jcode-mimir/packages/mimir-core
```

Create a local npm tarball:

```bash
pnpm build
pnpm --dir packages/mimir-core pack
```

## Supporting Documents

- [`SECURITY-HARDENING.md`](./SECURITY-HARDENING.md): threat model, offline operation, release
  verification, and high-assurance deployment notes.
- [`docs/api-reference.md`](./docs/api-reference.md): public TypeScript API functions, result types,
  and MCP tool inputs.
- [`docs/fr-eu-sovereign-positioning.md`](./docs/fr-eu-sovereign-positioning.md): bounded FR/EU
  sovereignty, GDPR, AI Act, and legal-vertical positioning.
- [`docs/source-boundary.md`](./docs/source-boundary.md): what the public MIT repository contains,
  and what must stay outside Git.
- [`docs/commercial-distribution.md`](./docs/commercial-distribution.md): public-safe commercial
  distribution rules for signed builds, licenses, and support.
- [`docs/offline-tts-preload.md`](./docs/offline-tts-preload.md): preload and verify the offline
  Transformers.js TTS cache before rendering confidential audio.
- [`docs/payment-webhook-architecture.md`](./docs/payment-webhook-architecture.md): direct-download
  checkout, webhook, and local-license architecture for future commercial app distribution.
- [`docs/ux-dx-audit.md`](./docs/ux-dx-audit.md): current UX/DX findings, fixes, and remaining
  product risks.

## License

MIT (c) Jean-Baptiste Thery.
