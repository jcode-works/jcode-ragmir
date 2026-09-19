import { createHash } from "node:crypto"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { createRagmirClient, initProject, loadConfig } from "../dist/index.js"
import { DEFAULT_CONFIG } from "../dist/defaults.js"
import { embedText } from "../dist/embeddings.js"
import { addLexicalDocument, lexicalDocument, lexicalDocumentScore } from "../dist/lexical-scoring.js"
import { readRows } from "../dist/store.js"
import { tokenize } from "../dist/text.js"
import { cases, documents, spreadsheet } from "./lib/developer-corpus.mjs"
import { environmentMetadata } from "./lib/metrics.mjs"

const provider = process.argv[2] ?? "local-hash"
if (!["local-hash", "mixedbread", "e5"].includes(provider)) {
  throw new Error("Expected local-hash, mixedbread, or e5.")
}
const workspace = process.env.INIT_CWD ?? process.cwd()
const output = path.resolve(workspace, process.argv[3] ?? `packages/ragmir-core/benchmarks/.results/developer-evidence-${provider}.json`)
const model = provider === "mixedbread" ? "mixedbread-ai/mxbai-embed-xsmall-v1" : "intfloat/multilingual-e5-small"
const revision = provider === "mixedbread" ? "e6ac24e5d6efb8782b59de1647b3ececb4ece94e" : "614241f622f53c4eeff9890bdc4f31cfecc418b3"
const facts = {
  "auth-redirect.md": ["AUTH_REDIRECT_ORIGIN_X17", "Reject wildcard hosts"],
  "token-renewal.md": ["/session/renew", "HttpOnly cookie", "terminates the session"],
  "offline-buffer.md": ["durable outbox", "original idempotency key"],
  "payments.md": ["Persist it before", "reuse it for all retries"],
  "permissions.md": ["Only a billing administrator", "author must not approve their own"],
  "current-storage.md": ["Status: accepted", "Supersedes ADR-001", "Do not store attachment bytes"],
  "retention.md": ["90 days", "no legal hold"],
  "worker.md": ["02:00 UTC", "Do not compute eligibility"],
  "api-signature.md": ["invoices.validateDraft", "ERR_INVOICE_409", "reload the record"],
  "pagination.md": ["preserve the sort order", "does not invalidate"],
  "french-exports.md": ["tâche asynchrone", "mille lignes", "interroge son statut"],
  "deployment.md": ["migration before enabling", "Roll back the flag before"],
  "webhooks.md": ["raw request body before parsing JSON", "five minutes"],
  "cache.md": ["after a successful transaction commit", "failed transaction must leave"],
  "limits.xlsx": ["Auditor", "0", "Refund approval limit EUR"],
}
const tests = [...cases,
  { id: "no-answer-french", query: "Quelle est la durée maximale d'une réunion de validation des factures ?", expected: [] },
  { id: "no-answer-french-unrelated", query: "Pourquoi les manchots plongent-ils sous la banquise ?", expected: [] },
]
const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-developer-evidence-"))
let client
try {
  await initProject(root)
  const source = path.join(root, ".ragmir/raw/specs")
  await mkdir(source, { recursive: true })
  for (const [name, text] of Object.entries(documents)) await writeFile(path.join(source, name), text)
  await writeFile(path.join(source, "limits.xlsx"), spreadsheet())
  await writeFile(path.join(root, ".ragmir/config.json"), JSON.stringify({
    ...DEFAULT_CONFIG,
    sources: [".ragmir/raw/specs"],
    embeddingProvider: provider === "local-hash" ? provider : "transformers",
    embeddingModel: model,
    embeddingModelRevision: revision,
    embeddingModelPath: path.join(workspace, ".ragmir/models"),
    retrievalProfile: "balanced",
  }))
  client = await createRagmirClient({ cwd: root })
  const ingest = await client.ingest({ rebuild: true })
  if (ingest.errors.length) throw new Error(JSON.stringify(ingest.errors))
  const config = await loadConfig(root)
  const corpusRows = await readRows(config)
  const lexical = corpusRows.map(row => lexicalDocument(row.searchText))
  const outcomes = []
  for (const test of tests) {
    const started = performance.now()
    const hybrid = await client.search(test.query, { topK: 5, contextRadius: 0, explain: true })
    const elapsedMs = performance.now() - started
    const vector = await embedText(test.query, config)
    const dense = corpusRows.map(row => ({ row, value: squaredDistance(row.vector, vector) }))
      .sort((a, b) => a.value - b.value || a.row.id.localeCompare(b.row.id))
    const queryTokens = [...new Set(tokenize(test.query))]
    const statistics = { documentCount: 0, totalLength: 0, documentFrequencies: new Map() }
    for (const document of lexical) addLexicalDocument(statistics, document, queryTokens)
    const bm25 = corpusRows.map((row, i) => ({ row, value: lexicalDocumentScore(lexical[i], statistics, queryTokens) }))
      .filter(item => item.value > 0)
      .sort((a, b) => b.value - a.value || a.row.id.localeCompare(b.row.id))
    outcomes.push({
      id: test.id,
      query: test.query,
      answerable: test.expected.length > 0,
      elapsedMs,
      hybrid: scoreEvidence(test, hybrid),
      independentDense: scoreEvidence(test, selectDocuments(dense)),
      independentBm25: scoreEvidence(test, selectDocuments(bm25)),
    })
  }
  const safetyCases = ["exact-anchor", "long-query-anchor", "exact-error", "dot-identifier", "filename", "table-header-and-row"]
  const passed = outcomes.filter(test => safetyCases.includes(test.id)).every(test => test.hybrid.completeEvidence)
  const result = {
    schemaVersion: 1, createdAt: new Date().toISOString(), environment: environmentMetadata(),
    description: "Synthetic diagnostic set, not a representative benchmark or an end-to-end coding evaluation.",
    baselineScope: "Dense L2 and BM25 each rank the complete corpus independently, with one chunk per document and native table-header context. Baselines have no calibrated abstention. No hybrid candidate pool is reused.",
    provider, model, revision, files: ingest.indexedFiles, chunks: ingest.chunks,
    corpusHash: createHash("sha256").update(JSON.stringify(documents)).update(spreadsheet()).digest("hex"),
    workloadHash: createHash("sha256").update(JSON.stringify({ tests, facts })).digest("hex"),
    cases: outcomes,
    summary: Object.fromEntries(["hybrid", "independentDense", "independentBm25"].map(variant => [variant, {
      answerable: outcomes.filter(test => test.answerable).length,
      completeEvidenceAt5: outcomes.filter(test => test.answerable && test[variant].completeEvidence).length,
      negative: outcomes.filter(test => !test.answerable).length,
      emptyForNegative: outcomes.filter(test => !test.answerable && test[variant].empty).length,
    }])),
    safetyCases, passed,
  }
  await mkdir(path.dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`)
  console.log(JSON.stringify({ output, provider, passed, summary: result.summary }))
  if (!passed) process.exitCode = 1

  function selectDocuments(scored) {
    const seen = new Set()
    const rows = []
    for (const { row } of scored) {
      if (seen.has(row.relativePath)) continue
      seen.add(row.relativePath)
      const header = corpusRows.find(candidate => candidate.relativePath === row.relativePath && candidate.chunkIndex === row.headerChunkIndex)
      rows.push({ ...row, context: header ? [header] : [] })
      if (rows.length === 5) break
    }
    return rows
  }
} finally {
  await client?.close()
  await rm(root, { recursive: true, force: true })
}

function squaredDistance(left, right) {
  return left.reduce((sum, value, i) => sum + (value - right[i]) ** 2, 0)
}

function scoreEvidence(test, rows) {
  const evidence = rows.map(row => ({
    file: path.basename(row.relativePath), citation: row.citation ?? null,
    text: [row.text, ...(row.context ?? []).map(context => context.text)].join("\n"),
    contextCitations: (row.context ?? []).map(context => context.citation ?? null),
  }))
  const missingFacts = test.expected.flatMap(file => {
    const text = evidence.filter(row => row.file === file).map(row => row.text).join("\n").toLowerCase()
    return (facts[file] ?? []).filter(fact => !text.includes(fact.toLowerCase())).map(fact => ({ file, fact }))
  })
  return { completeEvidence: test.expected.length > 0 && missingFacts.length === 0, empty: rows.length === 0, missingFacts, evidence }
}
