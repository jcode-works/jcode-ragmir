# Ragmir Core benchmarks

This directory contains the reproducible performance and retrieval-quality harness. Generated
corpora and raw results are deliberately excluded from Git.

## Commands

```bash
pnpm bench:smoke
pnpm bench:quality
pnpm bench:scale -- --size M
pnpm bench:vector-index -- --sizes S,M,L
pnpm bench:compare -- --baseline baseline.json --current current.json
```

`bench:smoke` is a fast functional check and is not eligible for product claims. `bench:quality`
evaluates two clean S indexes and fails unless their corpus and quality fingerprints match and all
quality gates pass. `bench:scale` accepts `S`, `M`, or `L`; the default is `S` and uses the full
warm-up and repetition policy.

`bench:vector-index` builds deterministic 384-dimensional S/M/L tables and compares exhaustive
search, IVF-PQ, HNSW-SQ, and `relativePath` BTree lookup. It records build time, p50/p95/p99,
throughput, Recall@10 against exact ground truth, index coverage, RSS checkpoints, table bytes,
physical bytes, and machine metadata. A full run uses 10 warm-ups, 100 samples, and five measured repetitions. It fails
if the selected strategy does not improve p95, loses 0.01 or more Recall@10, has incomplete
coverage, or misses the M/L latency gate. `--quick` is for calibration and is not claim-eligible;
`--nprobes`, `--refine-factor`, and `--ef` support explicit tuning runs.

Use `--provider transformers` only when the configured model is already present locally. Remote
model downloads remain disabled. Pass its cache with `--model-path /absolute/path/to/models` when
it is not under the invoking repository's `.ragmir/models`. Use `--keep` to preserve the generated
temporary project for manual inspection.

Every JSON result records the commit, runtime, machine, corpus hash, provider, model revision,
sample counts, quality metrics, latency percentiles, throughput, process resource usage, and
physical source/index sizes. Results from different machine fingerprints are inconclusive unless
the comparison is explicitly allowed.

The generated corpus includes prose, code-like Markdown, JSON, JSONL, HTML, YAML, CSV, XML, PDF,
DOCX, XLSX, PPTX, and EPUB fixtures. S/M/L are targets, and the result records the actual chunk
count produced by the current parser and chunker.
