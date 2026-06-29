# Open-Core Boundary

Mimir uses an open-core model without weakening the free local RAG foundation.

## Free MIT Core

The following stays MIT-licensed and usable without a paid account:

- `mimir` CLI, library, and MCP server.
- Local setup, ingest, parsing, chunking, redaction, embeddings, storage, search, and cited `ask`.
- `local-hash` retrieval and optional local Transformers.js embeddings.
- `security-audit`, generated `.gitignore` safeguards, metadata-only access logs, and bounded MCP
  retrieval.
- Bundled portable agent skills, including audio-summary and Markdown-report workflows.

The free core must not be artificially limited to force a paid upgrade. Mimir Core is the trust,
distribution, and auditability layer.

## Paid Desktop App

The paid product is Mimir Desktop: a proprietary Tauri desktop/mobile shell for users who want the
local-first workflow without living in a terminal.

Paid value can include:

- Multi-project GUI, local project registry, guided setup, and privacy posture views.
- Drag/drop folder intake, watched folders, and local-sync connectors such as Google Drive for
  desktop folders already present on disk.
- Desktop/mobile packaging, direct-download installers, signed updates, and user support.
- License activation, product polish, and future vertical packs.

Paid value must not require uploading documents to a hosted Mimir service.

## Confidentiality Guarantees

These guarantees apply to both the free core and the paid app:

- No hosted document storage.
- No analytics, PostHog, or product telemetry by default.
- Raw documents, vector stores, generated reports, generated audio, and agent configs stay under
  ignored local state such as `.kb/`, `.mimir/`, and `private/**`.
- Redaction runs before indexing.
- Remote model downloads are explicit; `transformersAllowRemoteModels` stays disabled for
  confidential indexing.
- MCP tools are read-focused and bounded by `mcpMaxTopK`.
- License checks may use metadata, but they must not upload document content, queries, retrieved
  passages, or vector data.

## Distribution Rule

Mimir Desktop is distributed through direct downloads and sideloadable installers, not App Store or
Play Store listings. The canonical landing and release surface is `mimir.jcode.works`.
