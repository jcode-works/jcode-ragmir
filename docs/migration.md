# Migration to focused retrieval

This is a breaking surface change. Ragmir now concentrates on local indexing, search, exact
citations, OCR, and integration with developer agents.

## Canonical paths, live freshness, and calibrated evidence (6.2)

Existing indexes stay searchable after the update; nothing needs deleting.

- **Canonical paths.** Ragmir now stores and cites paths with forward slashes and in Unicode NFC on
  every platform. Files whose names were stored decomposed (common for accented names copied from
  archives, sync clients, or older Mac volumes) and every file of a Windows index are re-indexed
  once by the next `rgr ingest`, which only re-embeds those files. Until then, path filters and
  citations match both forms. `rgr doctor` counts the remaining `noncanonicalPaths`.
- **Exclusions that work.** An exclusion typed in composed form now also excludes a decomposed file,
  and case-variant names on case-insensitive volumes. Run `rgr audit` after the update: files that
  your rules meant to exclude may leave the index on the next ingest, and `sourceRules` lists rules
  that still match nothing.
- **Default exclusions.** Tool state (`.claude`, `.codex`, ...), dependency caches, lockfiles, and
  minified bundles are skipped unless a source names them. Set `defaultExcludes: false` to keep the
  previous selection.
- **Freshness.** `rgr doctor`, `ragmir_status`, and `ragmir://context` compare files by size and
  modification time instead of repeating the ingest-time snapshot (`cost` becomes `O(files)`), so
  `coverageComplete` and `ready` turn false when sources changed since the last ingest.
- **Ranking policy version 7.** Model-calibrated abstention, IDF-weighted keyword evidence,
  `weakEvidence`, path priors, code-definition boosts, translation collapsing, and crowding-aware
  candidates change rankings. Rerun `rgr evaluate`: stored quality reports no longer verify the
  active policy. Set `pathPriors: false` or `collapseLocaleVariants: false` to compare.
- **MCP output.** `ragmir_status` no longer returns ingestion limits and extractor commands
  (`rgr limits` keeps them); it adds `knowledgeBase`, `coverage`, `scopes`, and `workspace`.
  `ragmir_audit` returns a summary unless `detail: true`. Repeated passages in one MCP session come
  back as `seen` stubs; set `mcpSeenResults: "include"` to keep the previous behavior. Unknown
  arguments are reported instead of rejected.
- **Runner.** `rgr setup` and `rgr install-skill` regenerate `.ragmir/run.cjs`, which now finds the
  project's package without a version-specific path. Rerun one of them in projects whose runner
  still names a removed install.

## Code-aware keyword index

This release adds relative source paths and identifier parts to the full-text index, lets BM25 lead
the default `local-hash` fusion, and shrinks candidate pools to the fusion bound. Existing indexes
stay searchable after the package update: `rgr doctor` reports
`readiness.lexicalIndexCurrent: false`, and the next `rgr ingest` or `rgr upgrade` stages a full
rebuild with the new keyword terms, then activates it only after validation. Embedded text is
unchanged, but the rebuild still recomputes vectors; plan for a normal ingestion time with a
semantic model. Rerun `rgr evaluate`: the ranking policy fingerprint changed, so previous quality
reports no longer verify the active policy.

## Accent-folded keyword index

The full-text index now stores keyword text folded like queries, so accented and unaccented
spellings match: "refraction" and "réfraction" both reach a passage that prints "Réfraction".
Indexes built before this change stay searchable, `rgr doctor` reports
`readiness.lexicalIndexCurrent: false`, and the next `rgr ingest` or `rgr upgrade` stages the same
validated full rebuild as above.

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
| Ragmir Chat and `rgr chat` | Your coding agent or a local/self-hosted chat; see the [four integration workflows](./agent-integration.md). |
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
