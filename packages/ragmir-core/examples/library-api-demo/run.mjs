#!/usr/bin/env node
// Local library smoke for @jcode.labs/ragmir.
//
// This exercises the public TypeScript API (ingest -> search -> expand -> status) the
// exact way an external consumer would `import` it, but Node self-referencing
// resolves "@jcode.labs/ragmir" to THIS repo's local build (packages/ragmir-core/dist),
// never the npm-published version. That is the point of the demo: while developing
// core you can validate the library surface end to end against your own changes,
// without `npx` silently pulling a released package.
//
// Run it from the repository root with `pnpm example`.

import path from "node:path"
import { fileURLToPath } from "node:url"

import { createRagmirClient } from "@jcode.labs/ragmir"

const here = path.dirname(fileURLToPath(import.meta.url))

// Reuse the committed synthetic corpus so the demo needs no private documents and
// writes only to the sibling example's gitignored .ragmir/storage.
const corpus = path.resolve(here, "..", "sovereign-rag-demo")

function heading(title) {
  console.log(`\n=== ${title} ===`)
}

async function main() {
  console.log("Running @jcode.labs/ragmir from the local build against the synthetic corpus.")
  console.log(`corpus: ${corpus}`)
  const ragmir = await createRagmirClient({ cwd: corpus })
  try {
    heading("ingest")
    const ingested = await ragmir.ingest({ rebuild: true, timeoutMs: 30_000 })
    console.log(
      `indexed ${ingested.indexedFiles}/${ingested.supportedFiles} supported files, ` +
        `${ingested.chunks} chunks`,
    )

    heading('search "offline retrieval approval"')
    const passages = await ragmir.search("offline retrieval approval", { topK: 3 })
    for (const passage of passages) {
      console.log(
        `- ${passage.relativePath}#${passage.chunkIndex} (distance ${passage.distance ?? "n/a"})`,
      )
    }

    if (passages[0]) {
      heading("expand one citation")
      console.log(await ragmir.expandCitation(passages[0].citation))
    }

    heading("status")
    const status = await ragmir.status()
    console.log(
      `${status.coverage.indexedFiles} indexed files, ` +
        `${status.coverage.chunksIndexed} chunks`,
    )
  } finally {
    await ragmir.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
