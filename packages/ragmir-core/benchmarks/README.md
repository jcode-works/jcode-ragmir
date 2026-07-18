# Ragmir Core benchmarks

Reproducible performance, scale, storage, and retrieval-quality harnesses for Ragmir Core. Generated
corpora, model caches, and raw results stay outside Git.

## Run a benchmark

| Command | Measures |
| --- | --- |
| `pnpm bench:smoke` | Fast functional calibration, not product-claim evidence |
| `pnpm bench:quality` | Recall@10, false positives, citations, and deterministic fingerprints |
| `pnpm bench:quality -- --size XS --profile fast` | Focused quality profile |
| `pnpm bench:scale -- --size M` | S/M/L ingestion and retrieval scale |
| `pnpm bench:vector-index -- --sizes S,M,L` | Exact, IVF-PQ, HNSW-SQ, and path-index tradeoffs |
| `pnpm bench:observability` | Diagnostic completeness, privacy, and disabled-path cost |
| `pnpm bench:parsers [-- --stress]` | Office, EPUB, PDF throughput, memory, citations, and malformed input |
| `pnpm bench:compare -- --baseline baseline.json --current current.json` | Comparable result regression |

Additional root scripts cover CLI startup, discovery, ingestion memory, metadata, local-hash
runtime, storage maintenance, status, runtime reuse, OCR cache, generation retention, concurrency,
and explicit reranker, compression, hashing, and content-dedup experiments.

## Claim rules

- `bench:quality` requires clean indexes with matching corpus and quality fingerprints. It separates
  p50/p95 latency from deterministic quality and evaluates vector-only, lexical-only, current
  hybrid, and experimental lexical weights.
- `bench:vector-index` uses deterministic 384-dimensional tables, 10 warm-ups, 100 samples, and five
  measured repetitions. A candidate fails if it loses at least 0.01 Recall@10, has incomplete
  coverage, misses the M/L latency gate, or does not improve p95. `--quick` is calibration only.
- `bench:observability` rejects diagnostics that reveal project roots, source paths, or source text,
  and enforces a 100 ns inactive-probe budget.
- Parser stress fixtures are 45 MB to 50 MB and enforce the 768 MiB ingestion memory budget.
- Results from different machine fingerprints are inconclusive unless comparison is explicitly
  allowed.

Every JSON result records commit, runtime, machine, corpus hash, provider, model revision, samples,
quality metrics, latency percentiles, throughput, process resources, and physical source/index
sizes. Scale runs also count manifest reads and table opens for persistent and one-shot searches.
The deterministic corpus covers prose, code-like Markdown, JSON, JSONL, HTML, YAML, CSV, XML, PDF,
DOCX, XLSX, PPTX, and EPUB.

Use Transformers only with a model already present locally:

```bash
pnpm bench:quality -- --provider transformers --model-path /absolute/path/to/models
```

Remote model downloads remain disabled. `--keep` preserves the temporary project for inspection.

## Experimental harnesses

The local-hash, reranker, index-compression, and content-dedup experiments compare candidate designs
against clean baselines. They gate reproducibility, retrieval quality, citations, latency, memory,
storage, deletion behavior, and interrupted writes where relevant. A passing experiment is evidence
for review, not an automatic production-policy change.

See the [root README](../../../README.md) for the public guarantees these benchmarks support.
