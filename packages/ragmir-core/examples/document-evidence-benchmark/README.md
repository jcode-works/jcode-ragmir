# Document evidence benchmark

A deterministic, public-safe benchmark for the retrieval and citation quality a coding agent
receives from Ragmir. Six golden queries require the expected path and an exact file, line, chunk,
or PDF-page citation. The fictional corpus runs offline with `local-hash`.

## What passes

| Signal | Requirement |
| --- | --- |
| Recall@K | An expected source appears in the configured top K |
| Text citation | Exact `relative/path:Lx-Ly#chunkIndex` |
| PDF citation | Exact `relative/path:pN#chunkIndex`, with no invented source lines |

Each source fits in one chunk so citation expectations stay stable while exercising the production
ingestion and evaluation pipeline.

| Fictional source | Evidence |
| --- | --- |
| `raw/contracts/master-services-agreement.md` | Contract and residency obligations |
| `raw/contracts/pdf-control-evidence.pdf` | Embedded PDF text and page citation |
| `raw/rfp/security-questionnaire.md` | Security and hosting requirements |
| `raw/runbooks/incident-response-runbook.md` | Operational evidence collection |
| `raw/specs/agent-integration-spec.md` | Agent and retrieval boundaries |
| `raw/legal-tax/residency-review-note.md` | Professional-review disclaimer |

[`golden-queries.json`](./golden-queries.json) maps questions to expected paths and citations.

## Run it

```bash
pnpm install --frozen-lockfile
pnpm build
cd packages/ragmir-core/examples/document-evidence-benchmark
node ../../dist/cli.js init
node ../../dist/cli.js ingest --rebuild
node ../../dist/cli.js evaluate --golden golden-queries.json --json
node ../../dist/cli.js evaluate --golden golden-queries.json --fail-under 1
```

The final command fails unless every query meets the threshold. Keep JSON output when CI or a
retrieval review needs machine-readable evidence.

On failure, run `rgr audit`, inspect returned paths and citations, then decide whether retrieval,
chunking, the corpus, or the intended expectation changed. Update a golden query only for an
intentional behavior change; never lower `--fail-under` to hide a regression.

For private evaluation, copy the `.ragmir/config.json`, `golden-queries.json`, and `raw/` structure
into an ignored workspace. Record the smallest expected source set and exact coordinates only when
the source is stable. Never commit private documents, queries, or reports.

A perfect score proves this fixture, not universal retrieval quality. Continue with the
[confidential local RAG demo](../sovereign-rag-demo/README.md) or
[Core README](../../README.md).
