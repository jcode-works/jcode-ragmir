# Library API Demo

Runnable smoke for the `@jcode.labs/ragmir` **library** API, meant for local development of Ragmir
Core itself. Where [`sovereign-rag-demo`](../sovereign-rag-demo) drives the **CLI**
(`node ../../dist/cli.js ...`), this demo `import`s the public TypeScript surface the same way an
external consumer would:

```js
import { ask, audit, ingest, search } from "@jcode.labs/ragmir"
```

Node self-referencing resolves `@jcode.labs/ragmir` to this repository's local build
(`packages/ragmir-core/dist`), **never** the npm-published package. So you can validate your local
changes to the library end to end, without `npx` silently running a released version.

## Run

From the repository root:

```bash
pnpm example
```

That builds Ragmir Core, then runs the demo. It reuses the committed synthetic corpus from
`sovereign-rag-demo`, so it needs no private documents and writes only to that example's gitignored
`.ragmir/storage`.

To run it directly against the already-built `dist/` without rebuilding:

```bash
node packages/ragmir-core/examples/library-api-demo/run.mjs
```

## What it exercises

- `ingest({ cwd, rebuild: true })` — parse, redact, chunk, and embed the synthetic corpus.
- `search(query, { cwd, topK })` — ranked cited passages.
- `ask(query, { cwd, topK })` — retrieval-only cited context (no LLM synthesis in core).
- `audit(cwd)` — indexed, supported, and skipped file counts.

It uses `embeddingProvider: "local-hash"` (from the reused corpus config), so it runs fully offline
with no model download.
