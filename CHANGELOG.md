# Changelog

> Historical note: earlier 0.x releases used the `kb` binary name and `.kb/` state
> directory. `kb` remains a legacy alias for `ragmir`, and `.kb/` is still recognized
> for backward compatibility. The entries below are rewritten with the current
> `ragmir` command name for clarity.

## 0.4.2 - 2026-06-29

- Add `ragmir doctor` to diagnose initialization, index freshness, security posture, and next steps.
- Make `ragmir audio` and `ragmir-tts` default to the offline/confidential Transformers.js WAV path;
  Edge MP3 now requires an explicit `--engine edge` command.
- Stop indexing the generated `private/README.md` helper file created by `ragmir init`.
- Improve onboarding output from `ragmir init` and `ragmir install-skill`.

## 0.4.1 - 2026-06-29

- Add an Edge-compatible Ragmir TTS engine so `ragmir audio` can match the global Voice Forge quality
  path with `edge-tts`, `fr-FR-DeniseNeural`, and MP3 output.
- Keep Transformers.js WAV rendering as the explicit offline/confidential path.
- Remove duplicated governance documents from package directories; root project docs are the single
  source of truth.

## 0.4.0 - 2026-06-28

- Reposition Ragmir as sovereign local RAG for confidential datasets and AI agents.
- Expand default ingestion to common text, Office/OpenDocument, data, config, log, and source-code
  file types.
- Add `includeExtensions` / `RAGMIR_INCLUDE_EXTENSIONS` (legacy alias `KB_INCLUDE_EXTENSIONS`) for custom UTF-8 text file extensions.
- Add the optional `ragmir-audio-summary` bundled skill for confidential audio summaries.
- Install both the main Ragmir skill and optional audio-summary skill with `ragmir install-skill`.
- Improve agent guidance for deep multi-query retrieval before synthesis.
- Make Ragmir core retrieval-only: `ragmir ask` now returns cited context for external agents or LLMs
  instead of generating answers internally.
- Add optional Transformers.js semantic embeddings through `embeddingProvider: "transformers"`.
- Remove Ollama providers and keep `embeddingProvider: "local-hash"` as the no-model default.
- Move the repository to a simple pnpm workspace monorepo without adding Turbo.
- Move the core `@jcode.labs/ragmir` package into `packages/ragmir-core`.
- Add `@jcode.labs/ragmir-tts` for plug-and-play JS/ONNX WAV rendering without Python or ffmpeg.
- Add `ragmir audio` and update the audio-summary skill to use Ragmir TTS before advanced fallback
  engines.

## 0.3.0 - 2026-06-28

- Add confidentiality hardening defaults: built-in redaction before indexing, metadata-only access
  logs, and bounded MCP retrieval.
- Add `ragmir security-audit` for zero-telemetry, provider, redaction, gitignore, storage, and
  MCP posture checks.
- Add `ragmir destroy-index --yes` to remove generated vector indexes.
- Add release verification artifacts: npm tarball, SHA256 checksums, SBOM, and manifest.
- Document air-gapped operation, threat model, MCP hardening, and secure deletion limits.

## 0.2.1 - 2026-06-28

- Add GitHub Sponsors funding metadata and document suggested sponsor tiers.
- Add maintainer positioning for Jean-Baptiste Thery and JCode Labs in the README.
- Make `ragmir init` and `ragmir install-skill` automatically keep `.ragmir/` (and legacy `.kb/`)
  ignored by Git.

## 0.2.0 - 2026-06-28

- Rename public product branding to Ragmir while keeping the JCode Labs npm scope.
- Add the bundled portable `ragmir` agent skill.
- Add the MCP stdio server with `ragmir_status`, `ragmir_search`, `ragmir_ask`, and
  `ragmir_audit`.
- Add production smoke coverage for the built CLI and MCP server.
- Add Biome, commitlint, publint, CodeQL, Dependabot grouping, protected npm publishing,
  and open-source contribution/security documentation.
