# Confidential local RAG demo

A complete, fictional workspace for learning how agents and scripts retrieve cited local project
context with Ragmir.

Use this example to ingest several file types, search with citations, inspect privacy posture, find
an unsupported file, evaluate golden queries, and prepare agent access. It keeps the fictional
corpus and generated index on the machine, runs with offline `local-hash` retrieval, and contains no
customer or production data.

## Scenario

The corpus models an operations team reviewing whether an evidence workflow can stay local:

| File | Role in the scenario |
| --- | --- |
| `raw/operations-brief.md` | Approval, ownership, and operating requirements |
| `raw/dataset-inventory.csv` | Accepted and rejected datasets |
| `raw/incident-timeline.jsonl` | Time-ordered operational evidence |
| `raw/security-policy.yaml` | Model-loading and security rules |
| `raw/review-notes.evidence` | Custom text extension configured for this project |
| `raw/facility-scan.heic` | Deliberately unsupported file used by the audit example |

## Run the full workflow

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm build
```

Then enter this example and run the local CLI build:

```bash
cd packages/ragmir-core/examples/sovereign-rag-demo
node ../../dist/cli.js init

# POSIX only: this example deliberately uses a custom tracked rawDir.
chmod 700 raw

node ../../dist/cli.js security-audit
node ../../dist/cli.js ingest --rebuild
node ../../dist/cli.js search "offline retrieval approval"
node ../../dist/cli.js ask "What evidence supports offline operation?"
node ../../dist/cli.js research "sovereign deployment evidence" --compact
node ../../dist/cli.js evaluate --golden golden-queries.json --fail-under 1
node ../../dist/cli.js audit --unsupported
node ../../dist/cli.js status
```

`init` is idempotent. Git and npm archives cannot preserve the example's intended `0700` raw-folder
mode, so the explicit `chmod` keeps the raw corpus owner-only on POSIX systems.

The security audit still reports that `.ragmir/` is not fully ignored. That warning is expected only
for this public fixture because it deliberately commits `.ragmir/config.json` and
`.ragmir/sources.txt`. Generated storage, models, reports, audio, logs, and salts remain ignored.
Normal private projects should ignore the complete `.ragmir/` directory.

## What to look for

- Search and ask output identify the source path and chunk.
- `ask` returns cited passages, not a generated answer from a hosted LLM.
- `research` combines several retrieval queries and reports source diagnostics.
- The audit surfaces the fixture-specific tracked-config warning described above.
- The golden evaluation finds the expected sources for all four questions.
- `audit --unsupported` explains why the HEIC fixture was skipped and recommends local OCR.
- `status` confirms the active provider and local index state.

## Useful queries

```text
offline retrieval approval
dataset residency
incident containment evidence
who owns the usage review
what documents support sovereign deployment
```

Try a precise query first, then compare it with `research --compact` when the question spans several
files.

## Give the demo to an agent

In a real project, `rgr setup` generates an MCP helper under `.ragmir/`. After setup, an
MCP-compatible agent can follow a prompt like:

```text
Use Ragmir to inspect the local knowledge base, search for "offline retrieval approval", and write a
cited Markdown report under .ragmir/reports/demo-sovereign-rag.md. Mention any unsupported or stale
files reported by the audit.
```

The report path stays under ignored local state. Do not commit generated reports that may contain
retrieved project evidence.

## Compare semantic retrieval

The committed configuration uses:

```json
{
  "embeddingProvider": "local-hash"
}
```

This is offline lexical/hash retrieval, not model-semantic search. To run a deliberate semantic
comparison, configure a Transformers.js model, preload it under `.ragmir/models`, and rebuild:

```json
{
  "embeddingProvider": "transformers",
  "embeddingModel": "intfloat/multilingual-e5-small",
  "embeddingModelRevision": "main",
  "embeddingModelPath": ".ragmir/models",
  "transformersAllowRemoteModels": false
}
```

```bash
node ../../dist/cli.js ingest --rebuild
node ../../dist/cli.js evaluate --golden golden-queries.json --json
```

Keep remote model loading disabled for an offline comparison. A lower semantic score may indicate
that queries or thresholds need tuning, not that a gate should be weakened.

## Generated state and cleanup

All runtime state stays under the ignored directory:

```text
.ragmir/
```

Remove only the generated index when you want a clean rerun:

```bash
node ../../dist/cli.js destroy-index --yes
```

Never replace the fictional fixtures in this package with real confidential documents. Use a
separate ignored workspace for private dogfooding.

## Continue exploring

- [Library API demo](../library-api-demo/README.md): call the public TypeScript API.
- [Document evidence benchmark](../document-evidence-benchmark/README.md): require exact paths and citations.
- [Ragmir Core README](../../README.md): installation, MCP, OCR, and privacy reference.
