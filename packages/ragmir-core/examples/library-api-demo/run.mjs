#!/usr/bin/env node
// Local library smoke for @jcode.labs/ragmir.
//
// This exercises the public TypeScript API (ingest -> search -> ask -> audit) the
// exact way an external consumer would `import` it, but Node self-referencing
// resolves "@jcode.labs/ragmir" to THIS repo's local build (packages/ragmir-core/dist),
// never the npm-published version. That is the point of the demo: while developing
// core you can validate the library surface end to end against your own changes,
// without `npx` silently pulling a released package.
//
// Run it from the repository root with `pnpm example`.

import path from "node:path"
import { fileURLToPath } from "node:url"

import { ask, audit, ingest, search } from "@jcode.labs/ragmir"

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

  heading("ingest")
  const ingested = await ingest({ cwd: corpus, rebuild: true })
  console.log(
    `indexed ${ingested.indexedFiles}/${ingested.supportedFiles} supported files, ` +
      `${ingested.chunks} chunks, ${ingested.redactions} redactions`,
  )

  heading('search "offline retrieval approval"')
  const passages = await search("offline retrieval approval", { cwd: corpus, topK: 3 })
  for (const passage of passages) {
    console.log(`- ${passage.relativePath}#${passage.chunkIndex} (distance ${passage.distance ?? "n/a"})`)
  }

  heading('ask "What evidence supports offline operation?"')
  const answer = await ask("What evidence supports offline operation?", { cwd: corpus, topK: 3 })
  console.log(`${answer.sources.length} cited sources`)
  console.log(answer.answer)

  heading("audit")
  const report = await audit(corpus)
  console.log(
    `${report.supportedFiles.length} supported, ${report.skippedFiles.length} skipped, ` +
      `${report.totalChunks} chunks indexed`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
