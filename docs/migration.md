# Migration to focused retrieval

This is a breaking surface change. Ragmir now concentrates on local indexing, search, exact
citations, OCR, and integration with developer agents.

## Upgrade an existing project

Use Node.js 22.12 or later, update `@jcode.labs/ragmir` with your package manager, then run:

```bash
rgr upgrade --check
rgr upgrade
rgr doctor --deep
rgr audit --unsupported
```

`upgrade --check` reports `config-migration-required` when the configuration contains
`privacyProfile`, `acceptedRisks`, `redaction`, `accessLog`, or `accessLogPath`. Normal operations
reject those keys instead of silently ignoring a previous masking requirement.

`rgr upgrade` saves an owner-readable backup beside the config as
`config.json.before-core-focus-<id>.json`, removes retired keys, refreshes managed helpers, and stages
a new index when its policy is incompatible. It preserves the old index until a replacement passes
validation and activates atomically. Failed or interrupted rebuilds can be resumed with the same
command. Do not delete `.ragmir/storage/` first.

Source text is preserved without masking. Old strict profiles retain explicit disabled model
downloads and external extractors plus their smaller MCP limits after migration. Enable local OCR
again deliberately if needed. The backup remains local and should not be committed.

## Removed surfaces and replacements

| Removed | Use instead |
| --- | --- |
| Ragmir Chat and `rgr chat` | Your agent/chat application and chosen model; see the Ollama integration example. |
| Ragmir TTS and `rgr audio` | A separate TTS tool receiving text from your application. |
| `ask()` / `rgr ask` | `search()` and exact citations, with synthesis in the consumer. |
| `research()` / `rgr research` | An agent-controlled loop of search and citation expansion. |
| Prompt routing | Let the consuming agent select Ragmir when local evidence is useful. |
| Team sync, snapshots, comparisons | Normal Git/file sharing, then local `rgr ingest` and `rgr audit`. |
| Portable runtime bundles | Install Ragmir on the destination, select local sources, and index there. |
| Redaction/privacy profiles | Source exclusions plus an appropriately hosted consuming model. |
| Access logs and usage reports | Host-level observability; ingestion metrics remain available. |
| Audio/report/legal skills | The single Ragmir retrieval skill plus your own task instructions. |
| `ragmir` and `kb` executable aliases | `rgr`. |
| MCP evaluation/security/usage/router tools | Four retrieval tools; evaluation and security audit stay in CLI/API. |

Remove old `@jcode.labs/ragmir-chat` and `@jcode.labs/ragmir-tts` dependencies from your application
when it no longer uses them. This repository no longer builds or publishes those packages; already
published versions are unaffected. Review and remove old specialized skill copies or links in your
agent configuration. Upgrade installs the current retrieval skill but does not delete independently
managed or user-edited skill directories. Restart MCP clients to refresh their tool lists.

## Semantic retrieval

`@huggingface/transformers` is now an optional peer dependency. Install it explicitly when using
the semantic provider:

```bash
pnpm add -D @huggingface/transformers
```

Existing cached models remain usable. `local-hash` works without Transformers, ONNX Runtime, Sharp,
or a generative model. OCR, supported document parsers, incremental ingestion, source filters,
quality evaluation, storage maintenance, and monorepo routing remain available.

This iteration changes parser/chunk policy to preserve XLSX header relationships. Existing indexes
therefore need the staged rebuild performed by `rgr upgrade`. Previous quality reports must be
rerun because the ranking policy now protects exact identifiers and rejects uninformative lexical
matches. Existing citation strings remain supported; consumers can additionally pass the returned
`evidence.id` to API/MCP expansion to detect changed indexed content.

Long search requests no longer collapse to their final question. Split requests above 20,000
UTF-16 code units into focused searches and inspect `--explain` when diagnosing retrieval.
