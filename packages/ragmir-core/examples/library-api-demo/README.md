# Library API demo

A runnable smoke test for the public `@jcode.labs/ragmir` TypeScript API. It opens one persistent
client, ingests a fictional local corpus, retrieves cited passages, returns retrieval-only context,
and reports status through the same package name an external consumer imports.

## Run it

```bash
pnpm install --frozen-lockfile
pnpm example
```

The root command builds the packages and runs [`run.mjs`](./run.mjs). Package self-reference points
to this checkout's `packages/ragmir-core/dist`, never the npm release. To rerun after a build:

```bash
node packages/ragmir-core/examples/library-api-demo/run.mjs
```

## Integration pattern

```js
import { createRagmirClient } from "@jcode.labs/ragmir"

const ragmir = await createRagmirClient({ cwd: projectRoot })
try {
  await ragmir.ingest({ rebuild: true, timeoutMs: 30_000 })
  const results = await ragmir.search("offline retrieval approval", { topK: 3 })
  const context = await ragmir.ask("What evidence supports offline operation?", { topK: 3 })
  const status = await ragmir.status()
} finally {
  await ragmir.close()
}
```

The demo proves `ingest`, `search`, `ask`, and `status` in order. `ask` returns cited context without
LLM synthesis. Reuse one client per project root in a long-running process; one-shot top-level
functions remain available.

The script shares the sibling demo's synthetic Markdown, CSV, JSONL, YAML, and custom-text corpus.
It uses offline `local-hash`, writes only ignored `.ragmir/storage`, downloads no model, and contains
no private documents. Keep committed changes deterministic and use a separate ignored corpus for
private tests.

| Need | Continue with |
| --- | --- |
| Complete CLI workflow | [Confidential local RAG demo](../sovereign-rag-demo/README.md) |
| Exact path and citation gates | [Document evidence benchmark](../document-evidence-benchmark/README.md) |
| Every exported option | [TypeScript API reference](../../../../docs/api-reference.md) |
