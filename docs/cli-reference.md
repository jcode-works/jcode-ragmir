# CLI reference

Use `rgr` in the repository that owns the knowledge base. `rgr --help` and `rgr <command> --help`
are the source of truth for option details.

## First use

Use the [agent-guided quick start](./quick-start.md) when the setup should adapt to the repository,
package manager, existing installation, selected sources, and optional semantic embeddings or OCR.

```bash
rgr setup --no-ingest
rgr sources add "docs/**/*.md" "src/**/*.ts"
rgr ingest
rgr search "release decision"
```

| Command | Purpose |
| --- | --- |
| `setup [--semantic]` | Initialize `.ragmir/`, agent helpers, and optionally preload embeddings. |
| `init` | Create basic local configuration only. |
| `doctor [--fix]` | Check setup, index freshness, and safe repairs. |
| `preview` | Parse and chunk selected sources without writing the index. |
| `ingest [--rebuild] [--batch-size N] [--incremental-failure-policy POLICY] [--metrics] [--json]` | Index configured sources through bounded windows with per-file durable progress; optionally return privacy-safe phase and throughput metrics. |
| `search <query>` | Return ranked cited passages. |
| `audit [--unsupported]` | Compare sources with the index and list skipped files. |
| `bases` | List root and nested monorepo bases and mark the active one. |
| `status` | Show configuration, indexed chunk count, and the latest ingestion progress. |
| `upgrade [--check]` | Inspect compatibility or safely rebuild and refresh managed helpers. |
| `security-audit [--strict]` | Check local privacy and Git-ignore posture. |

## Sources and retrieval

```bash
rgr sources add "docs/**/*.md" "!docs/archive/**"
rgr sources list
rgr preview --path docs --max-files 5 --max-chunks 3
rgr search "migration" --top-k 5 --context-radius 1
rgr search "migration" --top-k 5 --max-chunks-per-document 2
rgr search "migration" --include-path docs --exclude-path docs/archive
rgr search "migration" --context-path "Guide > Migration" --explain
rgr search "migration" --exact-vector-search
```

`sources add` accepts paths, globs, and `!` exclusions. Search accepts `--top-k`,
`--include-path`, `--exclude-path`, and repeatable `--context-path`. Search accepts
`--max-chunks-per-document` and `--explain`. The document cap defaults to one, applies after scoring,
and over-retrieves internally before final truncation. Ranked backfill keeps the requested result
count when the corpus has too few distinct documents. The optional score object reports RRF
contributions, retriever ranks, raw backend scores, document-cap and backfill state, FTS or
complete-fallback activation and reason, fallback scan batches, candidate and index coverage, queue
wait, and matched query terms without changing ranking. Use `--compact` on search when
agent context is limited. This remains explicit for CLI automation; MCP search
is compact by default. Search accepts `--exact-vector-search` to bypass an active ANN index
for diagnostics against exhaustive vector search. `--top-k` and `--max-chunks-per-document` are
limited to 100, and `--context-radius` is clamped to three chunks.

The explanation also contains a ranking-policy fingerprint so a stored quality report can be tied
to the exact provider, profile, document cap, fusion, and abstention settings. Equal backend scores
have a stable source-and-chunk tie-break. Search returns no result when all candidates fail the
provider-aware evidence threshold; it does not force a low-confidence passage into the response.

Queries retain all their constraints up to 20,000 UTF-16 code units; longer input is rejected.
`--explain` includes the actual retrieval query, normalization flag, and original length. Exact
identifiers are prioritized before RRF scores. If FTS is unavailable, two complete passes compute
BM25 while keeping only a bounded batch and the best candidates in memory; fallback latency still
grows with the corpus. The batch counter includes both passes.

Full JSON results include evidence identity and separately cited XLSX header context. Compact
results keep the identity but require API/MCP expansion for complete context. Retrieved passages
can be incomplete for the question, especially semantic matches: the consumer must verify that the
required facts, exceptions, and current decisions are actually present.

`preview` uses the active extraction and chunking configuration without changing the search index.
It can populate the local OCR cache and returns extracted chunk text. `audit` reports min, mean,
p50, p95, and max chunk sizes plus structural-context coverage.

## Safe upgrades

```bash
rgr upgrade --check
rgr upgrade
```

`upgrade --check` reports `current`, `index-required`, `rebuild-required`, `repair-required`, or `config-migration-required`,
including the version that wrote the active index. Run it after updating the package and before the
first retrieval with the new runtime. Incompatible retrieval is refused with a direct `rgr upgrade`
instruction instead of reading an untrusted layout. `ready` describes upgrade and retrieval
continuity. Repeated `advisory` lines report separate security follow-ups;
they do not turn a compatible operational index into `repair-required`.

`upgrade` refreshes managed agent helpers and performs any required ingest or rebuild. Schema,
embedding, chunking, extraction, and index-policy changes use the staged-generation flow: Ragmir
never deletes the active index first, and only a replacement that passes row-count, checksum, and
duplicate-ID validation activates. Failed or interrupted rebuilds never activate a partial table
and can resume. Older configs that omit newer optional fields receive current safe defaults.
`rgr doctor --fix` repairs setup and index state for current configurations. Use `rgr upgrade`
to migrate retired configuration fields. A long-running host can keep its already loaded
runtime on the previous generation, then restart or cut over after the upgrade reports
`status=current` and `ready=true`. Address any advisory with `rgr security-audit` or
`rgr security-audit --strict`; deleting and rebuilding a healthy index is not required.

## Resumable ingestion

```bash
rgr ingest
rgr status --json
rgr ingest --batch-size 10
rgr ingest --metrics --json
```

The default file window contains up to 25 files, within stricter source-byte and estimated-chunk
budgets. After each file commit, Ragmir appends private durable state under `.ragmir/storage/`.
The compact activation manifest changes only after final validation. Starting `rgr ingest` again resumes a compatible
interrupted run and processes only pending, failed, or changed files. Files already committed to
the index are not parsed or embedded again.

Fast inventory reuses a private SHA-256 only while file identity and high-resolution metadata still
match, with periodic full verification. `sourceFingerprintMode: "strict"` recalculates every hash.
A committed file atomically replaces that changed source's chunks. Run `rgr limits` for the active
50-MB parse window, chunk, vector, concurrency, embedding-batch and file-batch ceilings.

Maintainers can reproduce the 25-file, 50-MB-per-file memory gate with
`pnpm bench:ingest-memory -- --stress` from the repository root.
The metadata gate for 100,000 files and one million chunks is
`pnpm bench:ingestion-metadata -- --stress`; it enforces a 256-MiB peak RSS budget.
The 100,000-file fast-fingerprint gate is `pnpm bench:discovery -- --stress`.
The privacy-safe phase-attribution and disabled-overhead gate is `pnpm bench:observability`.
The LanceDB maintenance gate is `pnpm bench:storage`; it verifies full
FTS coverage, stable citations, bounded fragment/version growth, and at most 10% search p95
regression after 24 mutation batches.
The generation-retention scorecard is `pnpm bench:generations`; ten generations must converge to
three with active and rollback generations preserved and disk amplification at or below 3.5x.
The adaptive-index scorecard is `pnpm bench:vector-index -- --sizes S,M,L`. It compares exact,
IVF-PQ, HNSW-SQ, and `relativePath` BTree lookup with 10 warm-ups, 100 samples, and five measured
repetitions. A production ANN candidate must improve p95 with less than 0.01 absolute Recall@10
loss against exhaustive search.

`--metrics` adds queue and write-lock wait, discovery, hashing, parsing, chunking,
embedding, Lance payload write, maintenance, throughput, cache-state, RSS, OCR subprocess, fallback,
error, timeout, and bound-activation counters to the result. The local `ragmir:ingestion`
diagnostics channel emits the same bounded summary when subscribed. It never includes a project
root, source path, source text, or raw query. Without the flag or a subscriber, phase timers and RSS
sampling stay disabled.

Citation coordinates are emitted only when they are verifiable: `:L10-L12` for source-preserving
text, `:p3` for PDF pages, `:slide12` for PPTX, `:sheet=Finance%20Ops:cells=A7-D7` for XLSX, and
`:spine2` for EPUB. Character offsets refer to parsed indexed text. Transformed formats omit invented source lines.

If a changed file fails during parsing, embedding, or its LanceDB write, incremental ingestion keeps
the previous rows searchable and records the current error, last-good checksum, and stale state.
Repairing the source replaces those rows once; deleting the source removes them. The default is
`--incremental-failure-policy preserve-last-good`. Select `remove-stale` explicitly when a failed
changed file must have no searchable rows.

`rgr status --json` reads only compact manifest and durable progress metadata. It exposes readiness,
`corpusFingerprint`, manifest freshness, persisted source-health and maintenance counts, plus the run
ID, mode, status, resume flag, last activity, batch size, chunk count, and file counts for `pending`,
`parsed`, `embedded`, `indexed`, and `error` states. The fingerprint is a deterministic SHA-256 over
sorted indexed relative paths and source-content checksums. It excludes timestamps, absolute roots,
and local index layout. Compare it only after both indexes are ready with no missing or stale files.
The value is `null` in JSON and `unavailable` in human output before a successful ingestion or when
the active manifest predates corpus fingerprints. Run `rgr ingest` to populate it. Status does not
open LanceDB or read chunk text. The human output shows the same progress in a compact form.

`rgr doctor` is constant-cost by default and reports the last health snapshot persisted by a
successful ingestion. Run `rgr doctor --deep` when current filesystem coverage, permissions, Git
ignore behavior, executable probes, or compatible quality evidence must be verified live. Deep
doctor and `rgr audit` label their O(corpus) cost in text and JSON output. A missing or invalid
manifest always yields `ready=false`, including legacy tables that predate manifest activation.

`rgr ingest --rebuild` writes batches into an isolated LanceDB generation. The existing index stays
active until the new table and manifest pass row-count, checksum, and duplicate-ID validation. The
final atomic manifest replacement activates the generation. Re-run the command after interruption
to resume the staged generation. Older generated tables remain available for searches that already
opened them; `rgr destroy-index` removes all generated index storage.

Ragmir checks LanceDB maintenance after every completed ingestion. It refreshes an absent or
incomplete `searchText_idx` before activation. To avoid unnecessary native rewrites and preserve a
newly validated index, automatic compaction starts only at 100,000 chunks, then after 20 mutation
batches or when at least eight fragments are 25% small fragments. Optional maintenance failures
return a warning while the validated table remains readable. It keeps exhaustive vector search below
100,000 rows,
maintains IVF-PQ at and above that crossover, and creates a `relativePath` BTree from 10,000 rows.
M uses 32 probes with refinement 10. L searches every partition with refinement 100 because lower
settings did not meet the Recall@10 gate. A failed ANN refresh falls back to exact search. Operators
can inspect or force the same process:

```bash
rgr storage optimize --dry-run --json
rgr storage optimize --json
```

If LanceDB hits its positional FTS list-offset decoder error during compaction, maintenance
rebuilds the FTS index without positions, retries compaction, then restores the positional index.
The row count and cited search remain available. Other compaction errors still return a warning.

The dry run acquires the local writer lock for a consistent report but creates no LanceDB version.
The JSON report includes table version, pending mutation count, fragment health, FTS/vector/scalar
coverage, index strategy, reasons, planned actions, completed actions, and any retryable operator
warning.

Rebuild generation cleanup uses a separate policy: active, resumable, rollback, and actively leased
tables are never reclaimed. Other generations receive a five-minute reader grace period, then are
bounded to three tables and seven days. Search and citation expansion create private PID-bound
leases and remove them in `finally`; dead or expired leases are ignored. Inspect the complete role
inventory and estimated bytes before cleanup:

```bash
rgr storage generations --json
rgr storage gc --dry-run --json
rgr storage gc --json
```

Generation GC runs only under the local writer lock. A dry run never drops a table. Reports include
active, resumable, rollback, leased, retained, and orphaned roles, plus reclaimable and reclaimed
bytes. Protected generations can temporarily exceed the ordinary three-table bound.

Ingestion, generation activation, quality-report persistence, and index destruction share one
private local writer lock. Concurrent readers remain available. Contention waits for a bounded
period and then returns retryable `INDEX_BUSY`; a dead owner is recovered from its PID and heartbeat.
The lock coordinates processes on one machine only, not hosts sharing a network filesystem.

## Monorepos

```bash
cd apps/web/src
rgr bases --json
rgr search "app-specific contract"
rgr --project-root /absolute/path/to/monorepo search "shared architecture"
```

Commands resolve the nearest configured ancestor. Use the root base for shared or cross-app
knowledge and an app base for app-specific evidence. `--project-root` overrides the working
directory deterministically. Root and nested bases use separate storage and never share index rows.

## Agents, maintenance, and JSON

```bash
rgr install-agent --agents codex,claude
rgr serve-mcp
rgr evaluate --golden .ragmir/golden.json --fail-under 0.8
rgr storage optimize --dry-run --json
rgr storage generations --json
rgr storage gc --dry-run --json
rgr destroy-index --yes
```

- `setup` installs canonical skills, native project links, a local runner, and selected MCP helpers.
- `install-skill` refreshes only the canonical kit; `install-agent` changes native scope or link mode.
- `install-agent --force` replaces a conflicting same-name skill only when explicitly requested.
- `serve-mcp` starts the local stdio MCP server.
- `evaluate` measures retrieval against a local golden-query file of at most 16 MiB and 1,000
  cases. Wrapped files can declare graded `relevanceJudgments`, `answerable: false` hard negatives,
  categories, locales, exact citations, and independent thresholds for Recall@1/3/5/10,
  Precision@5, MRR@10, nDCG@10, citation accuracy, and false-positive rate. One run pins a single
  index generation and evaluates cases with bounded concurrency while preserving report order.
- A passing suite with at least 100 cases, graded relevance, exact citations, hard negatives, and
  every threshold stores a fingerprint in the active manifest. `rgr doctor --deep` reports retrieval
  quality as verified only while that report still matches the golden file, corpus, model revision,
  retrieval profile, and index policy.
- `limits`, `storage optimize`,
  `storage generations`, `storage gc`, and `destroy-index` expose the other local maintenance
  operations.
- Add `--json` to machine-readable commands. Do not parse human-readable output in automation.

## Semantic retrieval and local OCR

```bash
pnpm add -D @huggingface/transformers
rgr models pull --enable
rgr ingest --rebuild
rgr ocr doctor
rgr ocr setup --language eng+fra
rgr ingest
```

Semantic setup explicitly downloads model weights; ordinary retrieval keeps remote loading disabled.
OCR runs only on PDF pages without extracted text, in bounded batches with a local cache.
See [configuration](./configuration.md) for local extractor contracts and [migration](./migration.md)
for removed commands and explicit old-config migration.
