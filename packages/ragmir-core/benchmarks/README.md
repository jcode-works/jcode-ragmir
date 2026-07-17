# Ragmir Core benchmarks

This directory contains the reproducible performance and retrieval-quality harness. Generated
corpora and raw results are deliberately excluded from Git.

## Commands

```bash
pnpm bench:smoke
pnpm bench:quality
pnpm bench:scale -- --size M
pnpm bench:compare -- --baseline baseline.json --current current.json
```

`bench:smoke` is a fast functional check and is not eligible for product claims. `bench:quality`
uses the S corpus with the full warm-up and repetition policy. `bench:scale` accepts `S`, `M`, or
`L`; the default is `S`.

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
