# Local retrieval demo for agentic RAG

A complete fictional workspace for learning how agents and scripts retrieve cited project evidence
with Ragmir. It covers multiple formats, local security checks, unsupported files, golden queries,
and agent access with offline `local-hash` retrieval. Ragmir supplies citations; the consuming
agent chooses searches, expands evidence, and generates with its own model.

The corpus is fictional. Local retrieval keeps the files and index on the machine running Ragmir;
connecting an agent or chat can send excerpts elsewhere. A local model can keep them on-device, a
self-hosted model can process them on your server or private cloud, and a cloud provider receives
what the consuming app sends. Review that complete path before using confidential documents.

## Scenario

| File | Role |
| --- | --- |
| `raw/operations-brief.md` | Approval, ownership, and operating requirements |
| `raw/dataset-inventory.csv` | Accepted and rejected datasets |
| `raw/incident-timeline.jsonl` | Time-ordered operational evidence |
| `raw/security-policy.yaml` | Model-loading and security rules |
| `raw/review-notes.evidence` | Project-configured text extension |
| `raw/facility-scan.heic` | Deliberately unsupported audit fixture |

## Run the workflow

From a checkout of the Ragmir repository, start at its root:

```bash
pnpm install --frozen-lockfile
pnpm build
cd packages/ragmir-core/examples/sovereign-rag-demo
node ../../dist/cli.js init

# POSIX only: Git and npm archives do not preserve this fixture's intended mode.
chmod 700 raw

node ../../dist/cli.js security-audit
node ../../dist/cli.js ingest --rebuild
node ../../dist/cli.js search "offline retrieval approval"
node ../../dist/cli.js search "sovereign deployment evidence" --compact
node ../../dist/cli.js evaluate --golden golden-queries.json --fail-under 1
node ../../dist/cli.js audit --unsupported
node ../../dist/cli.js status
```

`init` is idempotent. The security audit intentionally warns that `.ragmir/` is not fully ignored
because this public fixture commits its configuration and source list. Generated storage, models,
reports remain ignored. Private projects should ignore the complete
`.ragmir/` directory.

Expected results:

- search identifies source paths and chunks;
- agents can expand selected citations and refine queries;
- every golden query finds its expected source;
- the audit explains why HEIC was skipped and suggests local OCR;
- status confirms the active provider and local index.

Useful queries include `dataset residency`, `incident containment evidence`,
`who owns the usage review`, and `what documents support sovereign deployment`.

## Connect an agent

In a real project, `rgr setup` writes an ignored MCP helper. Connect it to a compatible agent and
choose the model independently. The agent can search, expand citations, and refine its query before
writing a response. For example:

```text
Use Ragmir to search for "offline retrieval approval" and write a cited report under
.ragmir/reports/demo-sovereign-rag.md. Mention unsupported or stale files reported by the audit.
```

Keep retrieved reports under ignored local state. The [agent integration guide](../../../../docs/agent-integration.md)
shows the MCP connection and an example chat flow with a local Ollama model.

## Compare semantic retrieval

The committed configuration uses offline lexical/hash retrieval:

```json
{ "embeddingProvider": "local-hash" }
```

For a deliberate semantic comparison, install `@huggingface/transformers`, prepare a model locally, set
`embeddingProvider`, `embeddingModel`, `embeddingModelRevision`, `embeddingModelPath`, and
`transformersAllowRemoteModels: false`, then rebuild and rerun evaluation. Keep remote loading off.
A lower semantic score is a tuning signal, never a reason to weaken a quality gate.

All generated state stays under `.ragmir/`. Reset only the index with:

```bash
node ../../dist/cli.js destroy-index --yes
```

Never replace the fictional fixtures with confidential documents. Continue with the
[Library API demo](../library-api-demo/README.md),
[Document evidence benchmark](../document-evidence-benchmark/README.md), or
[Core README](../../README.md).
