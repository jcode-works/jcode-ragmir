# Library API demo

A runnable smoke test for the public `@jcode.labs/ragmir` TypeScript API. It opens one persistent
client, ingests a fictional local corpus, searches and expands cited passages, and reports status
through the same package name an external consumer imports. This is the retrieval portion of an
agentic RAG application; your agent or chat supplies the reasoning and generation model.

## Run it

From a checkout of the Ragmir repository, start at its root:

```bash
pnpm install --frozen-lockfile
pnpm example
```

The root command builds Core and runs [`run.mjs`](./run.mjs). Package self-reference points
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
  const evidence = results[0] ? await ragmir.expandCitation(results[0].citation) : undefined
  const status = await ragmir.status()
} finally {
  await ragmir.close()
}
```

The demo exercises `ingest`, `search`, `expandCitation`, and `status` in order. Expansion returns
source context. Reuse one client per project root in a long-running process; one-shot top-level
functions remain available. An agent can search again when the first passages do not answer its
question, then pass the selected evidence to its model.

The same API works with a local chat, a model on your own server or private cloud, or a cloud model
provider. The consuming application owns that connection. Retrieved text is not masked, so choose
where it may be sent and how the consumer stores or logs it. See the
[MCP and Ollama integration guide](../../../../docs/agent-integration.md).

The script shares the sibling demo's synthetic Markdown, CSV, JSONL, YAML, and custom-text corpus.
It uses offline `local-hash`, writes only ignored `.ragmir/storage`, downloads no model, and contains
no private documents. Keep committed changes deterministic and use a separate ignored corpus for
private tests.

| Need | Continue with |
| --- | --- |
| Complete CLI workflow | [Local retrieval demo](../sovereign-rag-demo/README.md) |
| Exact path and citation gates | [Document evidence benchmark](../document-evidence-benchmark/README.md) |
| Every exported option | [TypeScript API reference](../../../../docs/api-reference.md) |
