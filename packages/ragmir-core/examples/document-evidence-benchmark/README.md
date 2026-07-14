# Document evidence benchmark

A deterministic, public-safe benchmark for the retrieval and citation quality agents receive from
Ragmir.

Use this example when you want to prove more than "a relevant file appeared." Its six golden queries
check that Ragmir retrieves the expected path and the exact file, line, chunk, or PDF-page citation.
Every document is fictional and safe to commit.

## What it measures

| Signal | What a passing result means |
| --- | --- |
| `Recall@K` | An expected source path appears within the configured top K results |
| Exact text citation | The expected `relative/path:Lx-Ly#chunkIndex` is returned |
| Exact PDF citation | The expected `relative/path:pN:Lx-Ly#chunkIndex` is returned |

The corpus is intentionally small enough for each source to fit in one chunk. That makes citation
expectations stable while exercising the same ingestion and evaluation code used for private
knowledge bases.

## Corpus

| Fictional source | Evidence type |
| --- | --- |
| `raw/contracts/master-services-agreement.md` | Contract and residency obligations |
| `raw/contracts/pdf-control-evidence.pdf` | Embedded PDF text with a page citation |
| `raw/rfp/security-questionnaire.md` | Security and hosting requirements |
| `raw/runbooks/incident-response-runbook.md` | Operational evidence collection |
| `raw/specs/agent-integration-spec.md` | Agent and retrieval boundaries |
| `raw/legal-tax/residency-review-note.md` | Professional-review disclaimer |

[`golden-queries.json`](./golden-queries.json) maps each test query to its expected path and exact
citation.

## Run the benchmark

From the repository root, install dependencies and build the packages:

```bash
pnpm install --frozen-lockfile
pnpm build
```

Then run the benchmark from this directory:

```bash
cd packages/ragmir-core/examples/document-evidence-benchmark
node ../../dist/cli.js init
node ../../dist/cli.js ingest --rebuild
node ../../dist/cli.js evaluate --golden golden-queries.json --json
node ../../dist/cli.js evaluate --golden golden-queries.json --fail-under 1
```

The last command exits non-zero unless every golden query succeeds at the configured threshold.
Keep the JSON output when you need machine-readable evidence for CI or a retrieval-quality review.

## Read a failure

1. Check `rgr audit` for missing, stale, or skipped source files.
2. Inspect the failed query's returned paths and citations in JSON output.
3. Decide whether the corpus, expected citation, chunking, or retrieval mode changed.
4. Update a golden expectation only when the intended product behavior changed.

Do not lower `--fail-under` merely to make a regression pass.

## Adapt it to a private corpus

Copy the structure, not the fictional documents:

```text
private-evaluation/
├── .ragmir/config.json
├── golden-queries.json
└── raw/
```

For each important question, record the smallest set of expected source paths. Add exact citations
when the source is stable enough to make line, page, and chunk boundaries meaningful. Keep private
contracts, RFPs, runbooks, tax notes, scans, golden queries, and evaluation reports outside Git or
under ignored local state.

## Safety

- The committed corpus contains no customer or production data.
- The benchmark uses the offline `local-hash` provider and needs no model download.
- Generated `.ragmir/storage` and evaluation output stay local and ignored.
- A perfect synthetic score proves this fixture, not universal retrieval quality.

Return to the [Ragmir Core README](../../README.md) or try the
[sovereign RAG demo](../sovereign-rag-demo/README.md) for a broader CLI walkthrough.
