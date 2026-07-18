# Configuration

Ragmir reads `.ragmir/config.json` from the current directory or an ancestor. Start with `rgr setup`;
edit JSON only for a real need.

```json
{
  "sources": ["docs/**/*.md", "src", "!docs/archive/**"],
  "privacyProfile": "private",
  "retrievalProfile": "balanced",
  "embeddingProvider": "local-hash"
}
```

## Common fields

| Field | Default | Why change it |
| --- | --- | --- |
| `sources` | `[]` | Add project paths, globs, and `!` exclusions. |
| `privacyProfile` | `private` | Use `strict` for the strongest local floor. |
| `retrievalProfile` | `balanced` | Use `fast`, `quality`, or `custom` for different search budgets. |
| `embeddingProvider` | `local-hash` | Set `transformers` only after an explicit preload. |
| `embeddingModel` | `intfloat/multilingual-e5-small` | Select the local Transformers embedding model. Rebuild after changing it. |
| `embeddingModelRevision` | Pinned commit for bundled profiles | Use an immutable 40-character commit for reproducible model artifacts. Unknown custom models default to the mutable `main` revision until explicitly pinned. |
| `embeddingModelDigest` | `null` | `rgr models pull --enable` records a SHA-256 identity for the resolved local artifact tree. Do not set it by hand unless the local files were verified independently. |
| `topK` | `8` | Change the default number of returned passages, up to the hard limit of 100. |
| `mcpMaxTopK` | `10` | Bound MCP passage requests; values above 100 are rejected. |
| `mcpMaxOutputBytes` | `32768` | Cap variable-size MCP tool and resource JSON; the server also enforces an absolute 1 MiB ceiling. |
| `chunkSize` / `chunkOverlap` | `1200` / `200` | Tune chunking, then rebuild the index. Chunk size is capped at 1,000,000 characters. |
| `maxFileBytes` | `50000000` | Lower the per-file parser budget; 50 MB is the hard ceiling. |
| `ingestConcurrency` | `4` | Bound concurrent parsers; values above `8` are rejected. |
| `embeddingBatchSize` | `32` | Bound one model call; values above `128` are rejected. |
| `sourceFingerprintMode` | `fast` | Use `strict` to hash every source on every inventory instead of reusing unchanged private fingerprints. |
| `incrementalFailurePolicy` | `preserve-last-good` | Use `remove-stale` only when failed changed files must disappear immediately. |
| `hybridTextScanLimit` | `5000` | Bound only the complete-scan fallback used when FTS is unavailable; values above 10,000 are rejected. A fallback smaller than the active corpus is rejected instead of returning silently truncated lexical evidence. |
| `workloadLimits` | See below | Bound active search, embedding, and ingestion work plus their queues and queue deadlines. |
| `includeExtensions` | `[]` | Add safe custom text extensions. |

Configuration arrays and strings have hard size ceilings. Sources are capped at 10,000 entries,
custom extensions at 128, redaction patterns at 64, and external commands at 128 arguments.
`mcpMaxOutputBytes` cannot exceed 1 MiB. Invalid environment overrides fail configuration loading
with the variable name instead of silently reverting to a different value.

### Stable team source configuration

Keep a shared source contract stable across workstations. Prefer canonical directories and globs,
such as `../design-system/docs/**/*.md`, over a script that expands files found on one machine. A
missing sibling repository should produce an explicit local coverage difference, not configuration
churn.

The active `.ragmir/config.json` stays local and ignored. A project can version a reviewed template,
copy it locally during setup, and keep machine-specific paths outside that template. Git-backed
teams use `rgr team sync` for the normal loop: fetch the current branch upstream, apply only a safe
fast-forward, then ingest locally. `--no-pull` keeps branch updates manual, and `--check` previews
without changing the worktree or index.

When Git is current but two results still differ, use the advanced `rgr team snapshot` and
`rgr team compare` commands to inspect source-contract, version, embedding, chunking, retrieval,
privacy, and per-file drift. The lower-level `corpusFingerprint` remains a quick equality check.
Use `sourceFingerprintMode: "strict"` when synchronization can preserve file metadata while
replacing content.

### Workload admission

Ragmir keeps independent process-local queues per project root. Search defaults to 8 active and 64
queued operations, embedding to 1 active and 64 queued operations, and ingestion to 1 active and 4
queued operations. Search and embedding wait at most 30 seconds in their queue; ingestion waits at
most 120 seconds. Each workload accepts `concurrency`, `maxQueue`, and `queueTimeoutMs` under
`workloadLimits.search`, `.embedding`, or `.ingestion`.

Concurrency is capped at 16, queue length at 1,000, and queue time at 900,000 ms. A full queue
returns the retryable `OVERLOADED` error. An expired queue entry returns retryable `TIMEOUT`, and an
aborted entry never starts. `explain: true` exposes `workloadQueueMs` on every returned search score.
The defaults come from the 100-request XS scorecard: search concurrency 8 kept throughput and p95
within measurement noise while reducing Transformers peak RSS. Change these limits only after a
representative concurrency benchmark.

### Retrieval profiles and ranking policy

Profiles bound retrieval work. They are candidate and diversification budgets, not a guarantee that
a larger budget improves every corpus. Evaluate the profile against a representative golden set
before changing production configuration.

| Profile | Quality intent | Latency intent | Default `topK` | Fallback scan cap | Vector candidates | FTS candidates | First-pass chunks per source | Context radius |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `fast` | Narrow, diverse evidence | Lowest work budget | 5 | 2,000 | max(40, 3 x `topK`) | max(100, 10 x `topK`) | 1, then backfill | 0 |
| `balanced` | General-purpose evidence | Default work budget | 8 | 5,000 | max(80, 4 x `topK`) | max(250, 20 x `topK`) | 2, then backfill | 0 |
| `quality` | Broader multi-section evidence | Highest work budget | 12 | 10,000 | max(200, 8 x `topK`) | min(4,000, max(500, 40 x `topK`)) | 4, then backfill | 1 |
| `custom` | Golden-set validated | Operator-defined | configured | configured | max(80, 4 x `topK`) | max(250, 20 x `topK`) | 2, then backfill | 0 |

Vector candidates are capped at 1,000. The FTS pool is profile-aware and capped at 4,000,
independently from `hybridTextScanLimit`. Structural context and body text feed the primary local
index. Exact file paths use a bounded scalar variant. Controlled exact-phrase, identifier, and fuzzy
rare-term queries expand only a primary pool that cannot fill `topK`, preserving established ranks.
The diversity pass prefers distinct sources first, then backfills ranked non-duplicate, non-overlapping
chunks to `topK`. Hybrid ranking uses deterministic reciprocal-rank fusion with `k = 60` and equal
vector and lexical weights. Stable source and chunk keys break score ties before ranks are assigned.
The active provider, profile, and ranking parameters form a policy fingerprint stored in quality
reports and exposed by score explanations.

Abstention is provider-aware. `local-hash` requires lexical evidence and gives query identifiers
precedence over coincidental section numbers. Transformers results require lexical evidence or a
normalized L2 distance no greater than 1.1. That distance was calibrated against the bundled
quality corpus with `mixedbread-ai/mxbai-embed-xsmall-v1`; every other model and corpus still needs
its own golden-query evaluation. The benchmark keeps experimental rank weights in its report and
does not promote them automatically.

Changing an embedding provider, model, revision, digest, or chunking field requires
`rgr ingest --rebuild`. Revision and artifact digest participate in the index, vector-index, and
quality-report fingerprints, so an index built from different weights is never treated as
compatible.
Ragmir also preserves Markdown heading paths and JSON or JSONL structure as retrieval-only context.
Rebuild indexes created by an older Ragmir version to populate that structural context.

Fast source fingerprints reuse SHA-256 only when path identity, size, high-resolution modification
and change times, inode, device, and mode still match. Suspicious metadata or a cache older than 30
days forces a full hash. A corrupt cache falls back to full hashing. Strict mode always reads and
hashes every included file.

Incremental ingestion preserves the last indexed rows when parsing, embedding, or LanceDB writing
fails for a changed file. The result, manifest, durable ingestion state, and `rgr audit` mark that
file as stale until a later ingest repairs it. Set `incrementalFailurePolicy` to `remove-stale`, or
pass `rgr ingest --incremental-failure-policy remove-stale`, only when serving stale evidence is
less acceptable than temporarily serving no evidence for that file. Actual source deletion always
removes its rows.

## Privacy profiles

- `private` defaults remote model loading to disabled and keeps built-in redaction enabled; remote
  Transformers loading still requires an explicit opt-in.
- `strict` also bounds MCP output and disables every external extractor.
- `trusted` and `custom` are for operators who explicitly accept different local controls.

`privacyProfile` is a safety floor, separate from retrieval quality.

Custom redaction patterns are compiled only after syntax, length, and catastrophic-backtracking
checks. Unsafe expressions are rejected while loading configuration and are never applied to source
text.

## Semantic retrieval

```bash
rgr setup --semantic
rgr ingest --rebuild
```

This preloads the configured Transformers model once and leaves normal remote model loading disabled.
Use `rgr models pull --enable` for the same change after initial setup. Both commands persist the
resolved immutable revision and artifact digest. Bundled model profiles use pinned commits. Pin a
custom model to a 40-character commit before relying on reproducible search results; `main` remains
mutable and therefore unverified.

`local-hash` never resolves Transformers.js, ONNX Runtime, or Sharp. In a long-running process,
Transformers pipelines are shared per exact model identity and disposed when the final
`RagmirClient` owner closes. Cache retirement waits for active inference leases, so a model switch
or shutdown does not dispose a session still serving a request.

## Local extractors

```bash
rgr ocr doctor
rgr ocr setup --language eng+fra
```

PDF OCR is optional and page-aware. Ragmir calls it only for blank extracted pages. Custom
`pdfOcrCommand`, `imageOcrCommand`, and `legacyWordCommand` values must be JSON argument arrays;
they run without a shell and must print text to stdout. They still execute with the operator's
filesystem and process authority. Their per-invocation timeout is capped at 900,000 ms, and strict
privacy disables them even when a command remains present in the configuration file.

`rgr ocr setup` writes the batched PDF contract. It replaces `{pages}` with up to 16 ordered page
numbers and expects JSON containing `subprocesses` plus an ordered `pages` array of `{ page, text }`
objects. Existing custom commands using `{page}` remain compatible and gain durable per-page cache,
but still launch once per missing page. Cache entries live under private `.ragmir/ocr-cache/` state
and are keyed by source checksum, page, engine and engine version, language, DPI, parser policy, and
command fingerprint. A changed source, executable, language, DPI, or parser policy cannot reuse stale
OCR text. `pdfOcrTimeoutMs` applies to one bounded batch.

## Environment overrides

Use `RAGMIR_*` variables for local experiments, for example:

```bash
RAGMIR_TOP_K=5 rgr search "migration"
RAGMIR_MCP_MAX_OUTPUT_BYTES=16384 rgr serve-mcp
```

Environment overrides cover selected runtime settings such as models, retrieval limits, access logs,
and extractor commands. Run `rgr status --json` to inspect the effective result.

`rgr security-audit` reports permission state plus Git-ignore and tracked-file state for the config,
raw documents, index storage, source list, access log, and local model directory. Read-only status,
doctor, search, and audit operations do not create an absent index or change an existing shared
directory mode.

For a long-running process that hosts more than one isolated project workflow, create one
`RagmirClient` per project root and keep process-wide environment overrides stable after startup.
Close every client during shutdown. Ragmir serializes writers across local OS processes with a
private heartbeat lock under `storageDir`; readers stay available. This is not a distributed lock,
so do not place one writable index on a shared network filesystem.

## Parser safety limits

Run `rgr limits` to inspect the fixed parser ceilings. Office archives, including DOCX and XLSX,
allow at most 512 text entries, 25 MB per entry, and 50 MB of expanded text in total. PDF extraction
is capped at 1,000 pages and 25 million text characters. Combined stdout and stderr from a local
external extractor are capped at 25 MB. Files above `maxFileBytes` are skipped and reported instead
of being partially indexed. Ingestion also caps a parse window at 50 MB and 8,192 estimated chunks,
one file at 65,536 chunks and 256 MiB of vectors, the CLI file batch at 128, parser concurrency at
8, and embedding batches at 128. Each file is committed separately, so restart repeats at most one
bounded commit.
