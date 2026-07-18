import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { generateCorpus } from "./lib/corpus.mjs"

const roots = await Promise.all([
  mkdtemp(path.join(os.tmpdir(), "ragmir-benchmark-verify-a-")),
  mkdtemp(path.join(os.tmpdir(), "ragmir-benchmark-verify-b-")),
])

try {
  const options = {
    targetChunks: 100,
    seed: "ragmir-benchmark-verification-v1",
    provider: "local-hash",
    model: "intfloat/multilingual-e5-small",
    modelRevision: "main",
    modelPath: path.join(roots[0], ".ragmir", "models"),
    goldenCount: 20,
  }
  const [first, second] = await Promise.all([
    generateCorpus({ ...options, root: roots[0] }),
    generateCorpus({
      ...options,
      root: roots[1],
      modelPath: path.join(roots[1], ".ragmir", "models"),
    }),
  ])
  if (first.corpusHash !== second.corpusHash) {
    throw new Error(
      `Benchmark corpus is not deterministic: ${first.corpusHash} != ${second.corpusHash}`,
    )
  }
  const expectedGoldenQueries = Math.min(20, first.files.length)
  if (
    first.files.length !== second.files.length ||
    first.goldenQueries.length !== expectedGoldenQueries
  ) {
    throw new Error("Benchmark corpus verification produced an unexpected shape.")
  }
  process.stdout.write(
    `${JSON.stringify({
      deterministic: true,
      corpusHash: first.corpusHash,
      files: first.files.length,
      goldenQueries: expectedGoldenQueries,
    })}\n`,
  )
} finally {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
}
