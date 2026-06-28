# Sovereign RAG Demo

Synthetic test workspace for Mimir. It is intentionally safe to commit: every document is fictional,
generic, and designed only to exercise local ingestion, retrieval, redaction, custom extensions, and
security-audit flows.

This folder must never contain real-world sensitive, regulated, or production documents.

## What It Covers

- Markdown operational briefs.
- CSV dataset inventories.
- JSONL incident timelines.
- YAML policy metadata.
- A custom `.evidence` text extension enabled through `.kb/config.json`.

## Run From This Repository Checkout

Build Mimir once from the repository root:

```bash
pnpm build
```

Then run the CLI from this folder:

```bash
cd examples/sovereign-rag-demo
node ../../dist/cli.js security-audit
node ../../dist/cli.js ingest
node ../../dist/cli.js search "offline retrieval approval"
node ../../dist/cli.js search "dataset residency"
node ../../dist/cli.js ask "What evidence supports offline operation?"
node ../../dist/cli.js audit
node ../../dist/cli.js status
```

This example uses `embeddingProvider: "local-hash"`, so it does not require a model runtime.
Retrieval is lexical/hash-based rather than model-semantic.

## Useful Test Queries

- `offline retrieval approval`
- `dataset residency`
- `incident containment evidence`
- `who owns the usage review`
- `what documents support sovereign deployment`

## Switch To Transformers Semantic Mode

To compare no-model retrieval with semantic local retrieval, change `.kb/config.json`:

```json
{
  "embeddingProvider": "transformers",
  "embeddingModel": "mixedbread-ai/mxbai-embed-xsmall-v1",
  "embeddingModelPath": ".mimir/models",
  "transformersAllowRemoteModels": false
}
```

Preload the model files under `.mimir/models` for offline work, then rebuild the index:

```bash
node ../../dist/cli.js ingest
node ../../dist/cli.js ask "What documents support sovereign deployment?"
```

## Generated State

Generated state stays local and ignored:

```plain text
.kb/storage/
.kb/access.log
.mimir/
```

Do not replace these synthetic documents with real confidential files inside the Mimir package
repository.
