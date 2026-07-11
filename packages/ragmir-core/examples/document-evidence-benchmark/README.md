# Document Evidence Benchmark

Synthetic document benchmark for Ragmir retrieval. It is intentionally safe to commit: the contract,
RFP, runbook, spec, and legal/tax notes are fictional and contain no customer data.

This benchmark checks three things:

- `Recall@K`: each query retrieves the expected source file or passage.
- exact citations: each query retrieves the expected `relative/path:Lx-Ly#chunkIndex` citation.
- embedded PDF text: the synthetic PDF is extracted and retrieved with an exact
  `relative/path:p1:Lx-Ly#chunkIndex` page citation.

The corpus is small on purpose so every source file fits in a single chunk. That keeps the expected
citations deterministic while exercising the same CLI path used for private dogfooding.

## Run From This Repository Checkout

Build Ragmir once from the repository root:

```bash
pnpm build
```

Then run the benchmark from this folder:

```bash
cd packages/ragmir-core/examples/document-evidence-benchmark
node ../../dist/cli.js init
node ../../dist/cli.js ingest
node ../../dist/cli.js evaluate --golden golden-queries.json --json
node ../../dist/cli.js evaluate --golden golden-queries.json --fail-under 1
```

Use this example as a public-safe template for private document evaluations. Keep real contracts,
RFPs, runbooks, tax notes, golden queries, and generated JSON reports outside Git or under ignored
local Ragmir state.
