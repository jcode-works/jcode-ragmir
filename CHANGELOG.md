# Changelog

## 0.3.0 - 2026-06-28

- Add confidentiality hardening defaults: local-only Ollama network policy, built-in
  redaction before indexing, metadata-only access logs, and bounded MCP retrieval.
- Add `kb security-audit` for zero-telemetry, network, redaction, gitignore, storage, and
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
