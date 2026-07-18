import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createRagmirClient, initProject } from "../dist/index.js"
import { DEFAULT_CONFIG } from "../dist/defaults.js"
import { indexPolicyFingerprint } from "../dist/index-policy.js"

const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-model-reproducibility-"))
const invocationRoot = process.env.INIT_CWD ?? process.cwd()
const modelPath = path.resolve(
  process.env.RAGMIR_BENCH_MODEL_PATH ?? path.join(invocationRoot, ".ragmir", "models"),
)
const model = process.env.RAGMIR_BENCH_MODEL ?? "mixedbread-ai/mxbai-embed-xsmall-v1"
const revision =
  process.env.RAGMIR_BENCH_MODEL_REVISION ?? "e6ac24e5d6efb8782b59de1647b3ececb4ece94e"
const digest =
  process.env.RAGMIR_BENCH_MODEL_DIGEST ??
  "sha256:8da5ea361dddbfd4203fbae01eb1708b22357577eee88a00f236c4f9c2f823fd"

try {
  await initProject(root)
  const rawDir = path.join(root, ".ragmir", "raw")
  await mkdir(rawDir, { recursive: true })
  await Promise.all([
    writeFile(path.join(rawDir, "alpha.md"), "# Alpha\n\nRotating credentials protects production systems.\n"),
    writeFile(path.join(rawDir, "beta.md"), "# Beta\n\nWarehouse inventory is reviewed every Friday.\n"),
    writeFile(path.join(rawDir, "gamma.md"), "# Gamma\n\nProduction access requires a reviewed approval.\n"),
  ])
  await writeFile(
    path.join(root, ".ragmir", "config.json"),
    `${JSON.stringify(
      {
        ...DEFAULT_CONFIG,
        embeddingProvider: "transformers",
        embeddingModel: model,
        embeddingModelRevision: revision,
        embeddingModelDigest: digest,
        embeddingModelPath: modelPath,
        transformersAllowRemoteModels: false,
        accessLog: false,
      },
      null,
      2,
    )}\n`,
  )
  const client = await createRagmirClient({ cwd: root })
  try {
    await client.ingest({ rebuild: true })
    const results = await client.search("Which document describes production approval?", {
      topK: 3,
    })
    const config = {
      ...DEFAULT_CONFIG,
      projectRoot: root,
      embeddingProvider: "transformers",
      embeddingModel: model,
      embeddingModelRevision: revision,
      embeddingModelDigest: digest,
    }
    process.stdout.write(
      `${JSON.stringify({
        revision,
        digest,
        policyFingerprint: indexPolicyFingerprint(config),
        topK: results.map((result) => result.relativePath),
      })}\n`,
    )
  } finally {
    await client.close()
  }
} finally {
  await rm(root, { recursive: true, force: true })
}
