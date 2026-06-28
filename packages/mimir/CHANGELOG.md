# Changelog

## 0.4.0 - 2026-06-28

- Reposition Mimir as sovereign local RAG for confidential datasets and AI agents.
- Expand default ingestion to common text, Office/OpenDocument, data, config, log, and source-code
  file types.
- Add `includeExtensions` / `KB_INCLUDE_EXTENSIONS` for custom UTF-8 text file extensions.
- Add the optional `mimir-audio-summary` bundled skill for confidential audio summaries.
- Install both the main Mimir skill and optional audio-summary skill with `kb install-skill`.
- Improve agent guidance for deep multi-query retrieval before synthesis.
- Make Mimir core retrieval-only: `kb ask` now returns cited context for external agents or LLMs
  instead of generating answers internally.
- Add optional Transformers.js semantic embeddings through `embeddingProvider: "transformers"`.
- Remove Ollama providers and keep `embeddingProvider: "local-hash"` as the no-model default.
- Move the repository to a simple pnpm workspace monorepo without adding Turbo.
- Move the core `@jcode.labs/mimir` package into `packages/mimir`.
- Add `@jcode.labs/mimir-tts` for plug-and-play JS/ONNX WAV rendering without Python or ffmpeg.
- Add `kb audio` and update the audio-summary skill to use Mimir TTS before advanced fallback
  engines.

## 0.3.0 - 2026-06-28

- Add confidentiality hardening defaults: built-in redaction before indexing, metadata-only access
  logs, and bounded MCP retrieval.
- Add `kb security-audit` for zero-telemetry, provider, redaction, gitignore, storage, and
  MCP posture checks.
- Add `kb destroy-index --yes` to remove generated vector indexes.
- Add release verification artifacts: npm tarball, SHA256 checksums, SBOM, and manifest.
- Document air-gapped operation, threat model, MCP hardening, and secure deletion limits.

## 0.2.1 - 2026-06-28

- Add GitHub Sponsors funding metadata and document suggested sponsor tiers.
- Add maintainer positioning for Jean-Baptiste Thery and JCode Labs in the README.
- Make `kb init` and `kb install-skill` automatically keep `.kb/` and `.mimir/`
  ignored by Git.

## 0.2.0 - 2026-06-28

- Rename public product branding to Mimir while keeping the JCode Labs npm scope.
- Add the bundled portable `mimir` agent skill.
- Add the MCP stdio server with `mimir_status`, `mimir_search`, `mimir_ask`, and
  `mimir_audit`.
- Add production smoke coverage for the built CLI and MCP server.
- Add Biome, commitlint, publint, CodeQL, Dependabot grouping, protected npm publishing,
  and open-source contribution/security documentation.
