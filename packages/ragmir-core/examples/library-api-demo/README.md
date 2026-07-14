# Library API demo

A runnable smoke test for the public `@jcode.labs/ragmir` TypeScript API behind agent and script
workflows.

Use this example when you are changing Ragmir Core or evaluating it as a library rather than as a
CLI. It imports the same package name an external consumer uses, runs the full retrieval loop, and
prints cited results from a fictional local corpus.

## What it proves

The demo exercises four public operations in order:

1. `ingest({ cwd, rebuild: true })` parses, redacts, chunks, embeds, and stores the corpus.
2. `search(query, { cwd, topK })` returns ranked source passages.
3. `ask(query, { cwd, topK })` returns retrieval-only cited context without LLM synthesis.
4. `audit(cwd)` compares supported files with the current index.

Node's package self-reference resolves `@jcode.labs/ragmir` to this checkout's local
`packages/ragmir-core/dist` build. It never falls back to the npm-published version, so the result
reflects the code you are currently reviewing.

## Run it

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm example
```

The root command builds the published packages required by Core and runs [`run.mjs`](./run.mjs). The
output is organized into `ingest`, `search`, `ask`, and `audit` sections so a reviewer can see each
public step succeed.

To rerun only the script after an existing build:

```bash
node packages/ragmir-core/examples/library-api-demo/run.mjs
```

`dist/` is ignored, so a clean clone must be built at least once.

## The public API pattern

The essential integration is intentionally small:

```js
import { ask, audit, ingest, search } from "@jcode.labs/ragmir"

await ingest({ cwd: projectRoot, rebuild: true })

const results = await search("offline retrieval approval", {
  cwd: projectRoot,
  topK: 3,
})

const context = await ask("What evidence supports offline operation?", {
  cwd: projectRoot,
  topK: 3,
})

const report = await audit(projectRoot)
```

All project-relative state is resolved from `cwd`. This is the key boundary for applications that
use Ragmir across more than one repository.

## Data used by the demo

The script reuses the sibling [sovereign RAG demo](../sovereign-rag-demo/README.md):

- committed synthetic Markdown, CSV, JSONL, YAML, and custom text files;
- an offline `local-hash` configuration;
- gitignored `.ragmir/storage` output;
- no private documents and no model download.

Change the queries in `run.mjs` when testing a retrieval behavior, but keep the committed demo
deterministic and public-safe. Use a separate ignored corpus for private evaluations.

## When to use another example

| Need | Example |
| --- | --- |
| Learn the complete CLI workflow | [Sovereign RAG demo](../sovereign-rag-demo/README.md) |
| Measure exact paths and citations | [Document evidence benchmark](../document-evidence-benchmark/README.md) |
| Explore every exported function and option | [Complete TypeScript API reference](../../../../docs/api-reference.md) |

Return to the [Ragmir Core README](../../README.md) for installation, MCP, OCR, and privacy guidance.
