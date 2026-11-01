// Compare Ragmir with popular local TypeScript retrieval stacks on the public Ragmir repository:
// the same tracked files, the same questions, and, for every vector side, the same embedding
// model and vectors. Writes benchmarks/.results/competitors.json and prints a Markdown table.
import { execFileSync } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { fileURLToPath } from "node:url"
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters"
import { create, insertMultiple, search as searchOrama } from "@orama/orama"
import MiniSearch from "minisearch"
import picomatch from "picomatch"
import { DEFAULT_CONFIG } from "../dist/defaults.js"
import { embedTexts } from "../dist/embeddings.js"
import { createRagmirClient, initProject, loadConfig } from "../dist/index.js"
import { environmentMetadata } from "./lib/metrics.mjs"

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const repositoryRoot = path.resolve(packageRoot, "../..")
const options = parseArguments(process.argv.slice(2))
const model = options.model ?? "mixedbread-ai/mxbai-embed-xsmall-v1"
const revision = options.revision ?? "e6ac24e5d6efb8782b59de1647b3ececb4ece94e"
const modelPath = path.resolve(options.modelPath ?? path.join(repositoryRoot, ".ragmir/models"))
const resultPath = path.resolve(
  options.result ?? path.join(packageRoot, "benchmarks/.results/competitors.json"),
)
const TOP_K = 10
// The documentation and source a developer agent asks about, tracked in Git.
const SOURCES = [
  "README.md",
  "AGENTS.md",
  "CLAUDE.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "RELEASING.md",
  "SECURITY.md",
  "SECURITY-HARDENING.md",
  "llms.txt",
  "package.json",
  "docs/**/*.md",
  "packages/*/README.md",
  "packages/*/package.json",
  "packages/ragmir-core/src/**/*.ts",
  "packages/ragmir-core/skills/**/*.md",
  "packages/ragmir-core/benchmarks/README.md",
  "packages/ragmir-landing/src/**/*.{astro,ts,tsx}",
  "packages/ragmir-landing/messages/*.json",
  "scripts/*.mjs",
]

const questions = JSON.parse(
  await readFile(path.join(packageRoot, "benchmarks/fixtures/repository-questions.json"), "utf8"),
)
const isSource = picomatch(SOURCES, { dot: true })
const files = execFileSync("git", ["ls-files", "-z"], { cwd: repositoryRoot, encoding: "utf8" })
  .split("\0")
  .filter((file) => file && isSource(file))
  .sort()
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim()

const workspace = await mkdtemp(path.join(os.tmpdir(), "ragmir-competitors-"))
const systems = []
try {
  for (const file of files) {
    const target = path.join(workspace, file)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, await readFile(path.join(repositoryRoot, file)))
  }
  await initProject(workspace)
  const semanticConfig = {
    ...DEFAULT_CONFIG,
    sources: SOURCES,
    embeddingProvider: "transformers",
    embeddingModel: model,
    embeddingModelRevision: revision,
    embeddingModelPath: modelPath,
    retrievalProfile: "quality",
  }

  for (const provider of ["transformers", "local-hash"]) {
    const config =
      provider === "transformers"
        ? semanticConfig
        : { ...DEFAULT_CONFIG, sources: SOURCES, retrievalProfile: "quality" }
    await writeFile(path.join(workspace, ".ragmir/config.json"), JSON.stringify(config))
    const client = await createRagmirClient({ cwd: workspace })
    try {
      const startedAt = performance.now()
      const ingest = await client.ingest({ rebuild: true })
      if (ingest.errors.length > 0) throw new Error(JSON.stringify(ingest.errors))
      const indexMs = performance.now() - startedAt
      systems.push(
        await measure(
          provider === "transformers"
            ? `Ragmir (hybrid, ${shortModel(model)})`
            : "Ragmir (local-hash, no model)",
          indexMs,
          async (query) =>
            (await client.search(query, { topK: TOP_K })).map((result) => result.relativePath),
        ),
      )
    } finally {
      await client.close()
    }
  }

  // Every other stack reads the same files, split by LangChain's recommended splitter, and the
  // vector stacks reuse Ragmir's embedding function: identical model, prefixes, and vectors.
  await writeFile(path.join(workspace, ".ragmir/config.json"), JSON.stringify(semanticConfig))
  const embeddingConfig = await loadConfig(workspace)
  const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 1000, chunkOverlap: 200 })
  const splitStartedAt = performance.now()
  const chunks = []
  for (const file of files) {
    const text = await readFile(path.join(repositoryRoot, file), "utf8")
    for (const piece of await splitter.splitText(text)) {
      chunks.push({ id: String(chunks.length), path: file, text: piece })
    }
  }
  const splitMs = performance.now() - splitStartedAt
  const embedStartedAt = performance.now()
  const vectors = []
  for (let offset = 0; offset < chunks.length; offset += 64) {
    vectors.push(
      ...(await embedTexts(
        chunks.slice(offset, offset + 64).map((chunk) => chunk.text),
        embeddingConfig,
        "document",
      )),
    )
  }
  const embedMs = performance.now() - embedStartedAt
  const embedQuery = async (query) => (await embedTexts([query], embeddingConfig, "query"))[0]

  // LangChain's MemoryVectorStore ranks by exact cosine similarity over every stored vector.
  systems.push(
    await measure("LangChain.js splitter + MemoryVectorStore-style cosine", splitMs + embedMs, async (query) => {
      const queryVector = await embedQuery(query)
      return vectors
        .map((vector, index) => ({ index, score: cosine(queryVector, vector) }))
        .sort((left, right) => right.score - left.score)
        .slice(0, TOP_K)
        .map(({ index }) => chunks[index].path)
    }),
  )

  const oramaStartedAt = performance.now()
  const orama = create({
    schema: { path: "string", text: "string", embedding: `vector[${vectors[0].length}]` },
  })
  await insertMultiple(
    orama,
    chunks.map((chunk, index) => ({ path: chunk.path, text: chunk.text, embedding: vectors[index] })),
  )
  const oramaMs = splitMs + embedMs + (performance.now() - oramaStartedAt)
  // Orama's default 0.8 similarity drops most vector hits of this model, so both its default and
  // a 0.1 threshold that lets the vector side rank are reported.
  for (const similarity of [0.8, 0.1]) {
    systems.push(
      await measure(`Orama hybrid (similarity ${similarity})`, oramaMs, async (query) => {
        const result = await searchOrama(orama, {
          mode: "hybrid",
          term: query,
          vector: { value: await embedQuery(query), property: "embedding" },
          similarity,
          limit: TOP_K,
        })
        return result.hits.map((hit) => hit.document.path)
      }),
    )
  }

  const miniStartedAt = performance.now()
  const minisearch = new MiniSearch({ fields: ["text"], storeFields: ["path"] })
  minisearch.addAll(chunks)
  const miniMs = splitMs + (performance.now() - miniStartedAt)
  systems.push(
    await measure("MiniSearch BM25", miniMs, async (query) =>
      minisearch
        .search(query)
        .slice(0, TOP_K)
        .map((hit) => hit.path),
    ),
  )

  const report = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    commit,
    environment: await environmentMetadata(),
    corpus: { trackedFiles: files.length, langchainChunks: chunks.length },
    model: { name: model, revision },
    questions: {
      answerable: questions.answerable.length,
      unrelated: questions.unrelated.length,
      nearDomain: questions.nearDomain.length,
    },
    systems,
  }
  await mkdir(path.dirname(resultPath), { recursive: true })
  await writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(markdownTable(report))
  console.log(`\nWrote ${path.relative(process.cwd(), resultPath)}`)
} finally {
  await rm(workspace, { recursive: true, force: true })
}

async function measure(name, indexMs, retrieve) {
  for (const entry of questions.answerable.slice(0, 3)) await retrieve(entry.query)
  const latencies = []
  const timed = async (query) => {
    const startedAt = performance.now()
    const paths = await retrieve(query)
    latencies.push(performance.now() - startedAt)
    return paths
  }
  const ranking = []
  for (const entry of questions.answerable) {
    ranking.push(rankingMetrics(await timed(entry.query), entry.expectedPaths))
  }
  const refused = async (list) => {
    let count = 0
    for (const query of list) count += (await timed(query)).length === 0 ? 1 : 0
    return count
  }
  const unrelatedRefused = await refused(questions.unrelated)
  const nearDomainRefused = await refused(questions.nearDomain)
  latencies.sort((left, right) => left - right)
  const share = (key) => ranking.filter((entry) => entry[key]).length / ranking.length
  const mean = (key) => ranking.reduce((sum, entry) => sum + entry[key], 0) / ranking.length
  return {
    name,
    indexSeconds: round(indexMs / 1000, 1),
    hitAt1: round(share("hit1")),
    hitAt3: round(share("hit3")),
    hitAt10: round(share("hit10")),
    mrrAt10: round(mean("rr")),
    ndcgAt10: round(mean("ndcg")),
    unrelatedRefused,
    nearDomainRefused,
    medianMs: round(latencies[Math.floor(latencies.length / 2)], 1),
    p95Ms: round(latencies[Math.floor(latencies.length * 0.95)], 1),
  }
}

/** File-level metrics: a passage counts when its file answers the question; repeats count once. */
function rankingMetrics(paths, expectedPaths) {
  const expected = new Set(expectedPaths)
  const seen = new Set()
  let dcg = 0
  let reciprocalRank = 0
  for (const [index, file] of paths.slice(0, TOP_K).entries()) {
    if (!expected.has(file) || seen.has(file)) continue
    seen.add(file)
    dcg += 1 / Math.log2(index + 2)
    if (reciprocalRank === 0) reciprocalRank = 1 / (index + 1)
  }
  let ideal = 0
  for (let index = 0; index < Math.min(expected.size, TOP_K); index += 1) ideal += 1 / Math.log2(index + 2)
  const hit = (k) => paths.slice(0, k).some((file) => expected.has(file))
  return { hit1: hit(1), hit3: hit(3), hit10: hit(TOP_K), rr: reciprocalRank, ndcg: dcg / ideal }
}

function cosine(left, right) {
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index]
    leftNorm += left[index] * left[index]
    rightNorm += right[index] * right[index]
  }
  return dot / Math.sqrt(leftNorm * rightNorm)
}

function markdownTable(report) {
  const percent = (value) => `${Math.round(value * 100)}%`
  const rows = report.systems.map(
    (system) =>
      `| ${system.name} | ${percent(system.hitAt3)} | ${percent(system.hitAt10)} | ${system.mrrAt10} | ${system.unrelatedRefused}/${report.questions.unrelated} | ${system.nearDomainRefused}/${report.questions.nearDomain} | ${system.medianMs} ms |`,
  )
  return [
    `${report.questions.answerable} answerable questions over ${report.corpus.trackedFiles} tracked files at ${report.commit.slice(0, 7)}`,
    "",
    "| System | Answer in top 3 | Answer in top 10 | MRR@10 | Off-topic refused | Near-domain refused | Median search |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows,
  ].join("\n")
}

function shortModel(name) {
  return name.split("/").pop()
}

function round(value, digits = 3) {
  return Number(value.toFixed(digits))
}

function parseArguments(argumentsList) {
  const parsed = {}
  for (let index = 0; index < argumentsList.length; index += 1) {
    const current = argumentsList[index]
    if (!current.startsWith("--")) continue
    const key = current.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())
    parsed[key] = argumentsList[index + 1]
    index += 1
  }
  return parsed
}
