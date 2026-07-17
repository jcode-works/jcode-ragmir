# Ragmir Core benchmarks

This directory contains the reproducible performance and retrieval-quality harness. Generated
corpora and raw results are deliberately excluded from Git.

## Commands

```bash
pnpm bench:smoke
pnpm bench:quality
pnpm bench:quality -- --size XS --profile fast
pnpm bench:scale -- --size M
pnpm bench:vector-index -- --sizes S,M,L
pnpm bench:observability
pnpm bench:parsers
pnpm bench:parsers -- --stress
pnpm bench:compare -- --baseline baseline.json --current current.json
```

`bench:smoke` is a fast functional check and is not eligible for product claims. `bench:quality`
evaluates two clean S indexes and fails unless their corpus and quality fingerprints match and all
quality gates pass. It accepts `fast`, `balanced`, `quality`, or `custom` with `--profile`, records
p50/p95 latency separately from its deterministic quality fingerprint, and reports Recall@10 plus
false positives for vector-only, lexical-only, current hybrid, and experimental lexical weights.
Variant comparisons rerank the bounded, post-abstention candidate pool returned by a top-100
search; they are diagnostic evidence, not an automatic production-policy change. `bench:scale`
accepts `S`, `M`, or `L`; the default is `S` and uses the full warm-up and repetition policy.

`bench:vector-index` builds deterministic 384-dimensional S/M/L tables and compares exhaustive
search, IVF-PQ, HNSW-SQ, and `relativePath` BTree lookup. It records build time, p50/p95/p99,
throughput, Recall@10 against exact ground truth, index coverage, RSS checkpoints, table bytes,
physical bytes, and machine metadata. A full run uses 10 warm-ups, 100 samples, and five measured repetitions. It fails
if the selected strategy does not improve p95, loses 0.01 or more Recall@10, has incomplete
coverage, or misses the M/L latency gate. `--quick` is for calibration and is not claim-eligible;
`--nprobes`, `--refine-factor`, and `--ef` support explicit tuning runs.

`bench:observability` verifies privacy-safe ingestion diagnostics, complete phase attribution,
throughput counters, and the disabled hot-path probe. It fails when diagnostics expose a project
root, source path, or source text, or when the inactive probe exceeds 100 ns per call.

`bench:parsers` measures DOCX, XLSX, PPTX, EPUB, and PDF throughput, peak RSS, chunk citation
coordinates, and malformed-input rejection in isolated processes. The `--stress` profile uses
source fixtures between 45 MB and 50 MB and enforces the 768 MiB ingestion memory budget.

Use `--provider transformers` only when the configured model is already present locally. Remote
model downloads remain disabled. Pass its cache with `--model-path /absolute/path/to/models` when
it is not under the invoking repository's `.ragmir/models`. Use `--keep` to preserve the generated
temporary project for manual inspection.

Every JSON result records the commit, runtime, machine, corpus hash, provider, model revision,
sample counts, quality metrics, latency percentiles, throughput, process resource usage, and
physical source/index sizes. Scale results also count manifest reads and table opens for persistent
and one-shot search series. Results from different machine fingerprints are inconclusive unless
the comparison is explicitly allowed.

The generated corpus includes prose, code-like Markdown, JSON, JSONL, HTML, YAML, CSV, XML, PDF,
DOCX, XLSX, PPTX, and EPUB fixtures. S/M/L are targets, and the result records the actual chunk
count produced by the current parser and chunker.

`bench:cli-startup` measures the lightweight packaged entry for `--version` and `route-prompt`.
It records p95 process startup latency and peak RSS, and enforces the CLI startup budget used by
release validation.

`bench:local-hash-experiment` compares the previous SHA-256 feature adapter with the versioned
integer-hash prototype. It gates throughput, explicit temporary allocations, reproducibility,
retrieval quality, and citation accuracy against clean quality scorecards supplied through
`--baseline` and `--candidate`. Capture both scorecards with `bench:quality` while each adapter is
active; generated results remain excluded from release artifacts.
