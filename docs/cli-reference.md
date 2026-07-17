# CLI reference

Use `rgr` in the repository that owns the knowledge base. `rgr --help` and `rgr <command> --help`
are the source of truth for option details.

## First use

```bash
rgr setup
rgr ingest
rgr search "release decision"
```

| Command | Purpose |
| --- | --- |
| `setup [--semantic]` | Initialize `.ragmir/`, agent helpers, and optionally preload embeddings. |
| `init` | Create basic local configuration only. |
| `doctor [--fix]` | Check setup, index freshness, and safe repairs. |
| `preview` | Parse, redact, and chunk selected sources without writing the index. |
| `ingest [--rebuild] [--batch-size N] [--incremental-failure-policy POLICY] [--metrics] [--json]` | Index configured sources through bounded windows with per-file durable progress; optionally return privacy-safe phase and throughput metrics. |
| `search <query>` | Return ranked cited passages. |
| `ask <query>` | Return cited context without model synthesis. |
| `research <query>` | Run a bounded, rank-aware multi-query retrieval pass. |
| `audit [--unsupported]` | Compare sources with the index and list skipped files. |
| `bases` | List root and nested monorepo bases and mark the active one. |
| `status` | Show configuration, indexed chunk count, and the latest ingestion progress. |
| `security-audit [--strict]` | Check local privacy and Git-ignore posture. |

## Sources and retrieval

```bash
rgr sources add "docs/**/*.md" "!docs/archive/**"
rgr sources list
rgr preview --path docs --max-files 5 --max-chunks 3
rgr search "migration" --top-k 5 --context-radius 1
rgr search "migration" --include-path docs --exclude-path docs/archive
rgr search "migration" --context-path "Guide > Migration" --explain
rgr search "migration" --exact-vector-search
```

`sources add` accepts paths, globs, and `!` exclusions. Search, ask, and research accept `--top-k`,
`--include-path`, `--exclude-path`, and repeatable `--context-path`. Search and ask accept
`--explain`; the optional score object reports RRF contributions, retriever ranks, raw backend
scores, FTS or complete-fallback activation and reason, candidate and index coverage, queue wait,
and matched query terms without changing ranking. Use `--compact` on search or research when
agent context is limited. Search and ask accept `--exact-vector-search` to bypass an active ANN
index for diagnostics against exhaustive vector search. `--top-k` is limited to 100 and
`--context-radius` is clamped to three chunks.

The explanation also contains a ranking-policy fingerprint so a stored quality report can be tied
to the exact provider, profile, fusion, and abstention settings. Equal backend scores have a stable
source-and-chunk tie-break. Search returns no result when all candidates fail the provider-aware
evidence threshold; it does not force a low-confidence passage into the response.

`preview` uses the active redaction and chunking configuration but never writes storage. `audit`
reports min, mean, p50, p95, and max chunk sizes plus structural-context coverage.

### Bounded research

```bash
rgr research "release obligations" --timeout-ms 10000 --code-top-k 10
rgr research "release obligations" --code-scan-max-files 500 --code-scan-max-bytes 8388608
rgr research "release obligations" --full-audit
```

Research uses language-aware expansions and deterministic weighted cross-query RRF. The direct
query keeps enough weight to preserve its candidate set; expansions add support and fill remaining
slots. The default path reads a fresh manifest health snapshot instead of walking every source.
`--full-audit` explicitly requests that inventory and its duplicate, archive, and mirror
diagnostics. `--top-k` and `--code-top-k` bound output items; `--timeout-ms`,
`--code-scan-max-files`, `--code-scan-max-bytes`, and `--code-scan-concurrency` bound work. The
report records both configured and consumed budgets.

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

`--metrics` adds queue and write-lock wait, discovery, hashing, parsing, redaction, chunking,
embedding, Lance payload write, maintenance, throughput, cache-state, RSS, OCR subprocess, fallback,
error, timeout, and bound-activation counters to the result. The local `ragmir:ingestion`
diagnostics channel emits the same bounded summary when subscribed. It never includes a project
root, source path, source text, or raw query. Without the flag or a subscriber, phase timers and RSS
sampling stay disabled.

Citation coordinates are emitted only when they are verifiable: `:L10-L12` for source-preserving
text, `:p3` for PDF pages, `:slide12` for PPTX, `:sheet=Finance%20Ops:cells=A7-D7` for XLSX, and
`:spine2` for EPUB. Character offsets refer to redacted indexed text. Transformed formats and files
whose redaction changes line mapping omit line coordinates.

If a changed file fails during parsing, embedding, or its LanceDB write, incremental ingestion keeps
the previous rows searchable and records the current error, last-good checksum, and stale state.
Repairing the source replaces those rows once; deleting the source removes them. The default is
`--incremental-failure-policy preserve-last-good`. Select `remove-stale` explicitly when a failed
changed file must have no searchable rows.

`rgr status --json` reads only compact manifest and durable progress metadata. It exposes readiness,
manifest freshness, persisted source-health and maintenance counts, plus the run ID, mode, status,
resume flag, last activity, batch size, chunk count, and file counts for `pending`, `parsed`,
`embedded`, `indexed`, and `error` states. It does not open LanceDB or read chunk text. The human
output shows the same progress in a compact form.

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
incomplete `searchText_idx` before activation and runs compaction after 20 mutation batches or when
at least eight fragments are 25% small fragments. Optional maintenance failures return a warning
while the validated table remains readable. It keeps exhaustive vector search below 100,000 rows,
maintains IVF-PQ at and above that crossover, and creates a `relativePath` BTree from 10,000 rows.
M uses 32 probes with refinement 10. L searches every partition with refinement 100 because lower
settings did not meet the Recall@10 gate. A failed ANN refresh falls back to exact search. Operators
can inspect or force the same process:

```bash
rgr storage optimize --dry-run --json
rgr storage optimize --json
```

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

## Optional local features

```bash
rgr models pull --enable
rgr ocr doctor
rgr ocr setup --language eng+fra
rgr chat setup --profile fast
printf '%s\n' "Non-sensitive model preload text." > /tmp/ragmir-tts-preload.txt
rgr audio /tmp/ragmir-tts-preload.txt --lang en --allow-remote-models --out .ragmir/audio/preload.wav
rgr audio ./brief.md --lang en --offline --out .ragmir/audio/brief.wav
```

Keep the same Chat profile across `setup`, `doctor`, and answers: `lite` is the ~0.49 GB Qwen option,
`fast` is the default ~3.35 GB Gemma option, and `quality` is the explicit ~5.15 GB Gemma option.
For offline TTS, keep the same `--lang` across preload and render: `en`, `fr`, and `es` select their
own local model automatically. Edge additionally supports `ja`, `th`, and `zh` when explicitly
selected.

| Command | Purpose |
| --- | --- |
| `models pull [--enable]` | Preload the configured embedding model, report its immutable revision and artifact digest, and optionally persist that identity while enabling semantic retrieval. |
| `ocr doctor` / `ocr setup` | Detect and configure local batched, resumable PDF OCR. |
| `chat setup|doctor|<question>` | Prepare, inspect, or use the optional local chat add-on. |
| `audio <file>` | Render text with the optional TTS add-on. |

OCR runs only for PDF pages without embedded text. The generated command processes bounded page
groups and stores private content-addressed page results, so interruption resumes only missing pages.
Ingest and preview JSON expose OCR pages, cache hits, batches, subprocesses, and phase time without
document content. The strict privacy profile disables external extractors. The first audio command above explicitly downloads the model from non-sensitive text;
the second uses the prepared cache and does not download anything. See the
[offline TTS guide](./offline-tts-preload.md) for model paths and verification.
See [offline Chat](./offline-chat-preload.md) for profile selection and air-gapped preparation.

Bundled embedding profiles resolve to pinned model commits. `models pull --enable` hashes the local
artifact tree and stores both `embeddingModelRevision` and `embeddingModelDigest`; rebuild the index
afterward. For a custom model, configure a 40-character commit instead of mutable `main` when two
installations must produce the same index policy and ranking.

## Agents, maintenance, and JSON

```bash
rgr install-agent --agents codex,claude
rgr serve-mcp
rgr evaluate --golden .ragmir/golden.json --fail-under 0.8
rgr usage-report --days 30
rgr storage optimize --dry-run --json
rgr storage generations --json
rgr storage gc --dry-run --json
rgr destroy-index --yes
```

- `setup` installs canonical skills, native project links, a local runner, and selected MCP helpers.
- `install-skill` refreshes only the canonical kit; `install-agent` changes native scope or link mode.
- `install-agent --force` replaces a conflicting same-name skill only when explicitly requested.
- `serve-mcp` starts the local stdio MCP server.
- `route-prompt` classifies whether a prompt should use Ragmir without storing it. Piped prompt
  input is limited to 64 KiB before classification.
- `evaluate` measures retrieval against a local golden-query file of at most 16 MiB and 1,000
  cases. Wrapped files can declare graded `relevanceJudgments`, `answerable: false` hard negatives,
  categories, locales, exact citations, and independent thresholds for Recall@1/3/5/10,
  Precision@5, MRR@10, nDCG@10, citation accuracy, and false-positive rate. One run pins a single
  index generation and evaluates cases with bounded concurrency while preserving report order.
- A passing suite with at least 100 cases, graded relevance, exact citations, hard negatives, and
  every threshold stores a fingerprint in the active manifest. `rgr doctor --deep` reports retrieval
  quality as verified only while that report still matches the golden file, corpus, model revision,
  retrieval profile, and index policy.
- `usage-report --days` accepts an integer from 1 to 3650; `limits`, `storage optimize`,
  `storage generations`, `storage gc`, and `destroy-index` expose the other local maintenance
  operations.
- Add `--json` to machine-readable commands. Do not parse human-readable output in automation.
