# Ragmir Core API Reference

This reference covers the public TypeScript API exported by `@jcode.labs/ragmir`. It is for
developers embedding Ragmir Core in local tools, scripts, desktop shells, MCP launchers, or tests.

Ragmir Core does not call an LLM and does not write final generated answers. Retrieval APIs return
cited local context; answer synthesis belongs to the agent or model runtime you choose around that
context.

## Import Surface

Use named imports only:

```ts
import { addSourceEntries, ask, doctor, ingest, search, securityAudit } from "@jcode.labs/ragmir"
```

Most project-scoped functions accept an optional `cwd` pointing at the target workspace. If omitted,
Ragmir resolves the project from `process.cwd()`.

```ts
await ingest({ cwd: "/path/to/local/workspace" })
const results = await search("offline approval", { cwd: "/path/to/local/workspace", topK: 5 })
```

## Project Setup

### `initProject(cwd?)`

Creates the local Ragmir scaffolding:

- `.ragmir/config.json`
- `.ragmir/raw/`
- `.gitignore` entries for `.ragmir/`

```ts
import { initProject } from "@jcode.labs/ragmir"

const created = await initProject("/path/to/workspace")
```

Returns `string[]` with relative paths created or updated.

### `setupProject(options?)`

Runs the normal first-run workflow: initialize the project, install the portable agent kit, run
doctor, and auto-ingest only when supported files are present and the privacy posture has no
warnings. Pass `semantic: true` to intentionally preload the configured Transformers.js embedding
model and switch the workspace to higher-quality semantic retrieval during setup.

```ts
import { setupProject } from "@jcode.labs/ragmir"

const result = await setupProject({ cwd: "/path/to/workspace", ingest: true, semantic: true })
console.log(result.semantic?.model.embeddingModelPath)
```

Use `agents`, `mcpServerName`, `mcpCommand`, and `mcpArgs` when setup should generate only selected
agent helpers or launch MCP through a repository wrapper:

```ts
await setupProject({
  cwd: "/path/to/workspace",
  agents: ["claude", "codex"],
  mcpServerName: "project-docs",
  mcpCommand: "./scripts/serve-mcp.sh",
})
```

Useful result fields:

| Field | Meaning |
| --- | --- |
| `created` | Relative scaffolding files created by setup. |
| `agentKit` | Paths to generated skills and MCP helper files. |
| `semantic` | Semantic model preload and config result when `semantic: true`; otherwise `null`. |
| `ingested` | `IngestResult` when auto-ingest ran; otherwise `null`. |
| `doctor` | Final readiness report. |
| `nextSteps` | User-facing next actions. |
| `configurationPrompt` | English copy-paste prompt for an AI assistant or local chat to tune repository-specific `sources` entries safely. |

### `loadConfig(start?)`

Finds `.ragmir/config.json` by walking upward from `start`, applies defaults and `RAGMIR_*`
environment overrides, and returns resolved absolute paths.

```ts
import { loadConfig } from "@jcode.labs/ragmir"

const config = await loadConfig("/path/to/workspace/subdir")
console.log(config.projectRoot)
```

### `inspectPdfOcr(cwd?)`

Detects supported local PDF OCR tools without changing configuration. The result reports OCRmyPDF,
Tesseract, Poppler, installed Tesseract languages, the effective privacy profile, and the currently
configured command.

```ts
import { inspectPdfOcr } from "@jcode.labs/ragmir"

const status = await inspectPdfOcr("/path/to/workspace")
console.log(status.recommendedEngine, status.languages)
```

### `configurePdfOcr(options?)`

Initializes the project when needed, selects an installed local engine, and writes a page-aware
`pdfOcrCommand` to `.ragmir/config.json`. `engine: "auto"` prefers OCRmyPDF 12.6 or newer, then
Tesseract plus Poppler. It never installs system tools, downloads OCR models, or calls a cloud API.
The `strict` privacy profile rejects configuration because it disables all external extractors.

```ts
import { configurePdfOcr } from "@jcode.labs/ragmir"

const configured = await configurePdfOcr({
  cwd: "/path/to/workspace",
  engine: "auto",
  language: "eng+fra",
  timeoutMs: 120_000,
})
console.log(configured.engine, configured.pdfOcrCommand)
```

### `extractPdfPage(options)`

Runs the low-level local page extractor used by the configured command. Applications normally call
`configurePdfOcr` and then `ingest`; direct callers must provide a positive one-based page number,
an installed engine, and Tesseract language codes.

```ts
import { extractPdfPage } from "@jcode.labs/ragmir"

const text = await extractPdfPage({
  engine: "tesseract",
  input: "/path/to/scan.pdf",
  page: 2,
  language: "eng",
})
```

### `listSourceEntries(cwd?)`

Reads the `sources` array from `.ragmir/config.json` and returns active source entries.

```ts
import { listSourceEntries } from "@jcode.labs/ragmir"

const sources = await listSourceEntries("/path/to/workspace")
console.log(sources.entries)
```

### `addSourceEntries(options)`

Adds paths, glob patterns, or `!` exclusion patterns to the `sources` array in
`.ragmir/config.json` without duplicating existing entries. This is the programmatic equivalent of
`rgr sources add`.

```ts
import { addSourceEntries } from "@jcode.labs/ragmir"

await addSourceEntries({
  cwd: "/path/to/workspace",
  entries: ["../apps/*/README.md", "../apps/*/docs/**/*.md", "!../apps/**/node_modules/**"],
})
```

## Ingestion And Retrieval

### `ingest(options?)`

Discovers supported source files, parses them, redacts configured patterns, chunks text, embeds
chunks, and writes the local LanceDB table.

```ts
import { ingest } from "@jcode.labs/ragmir"

const result = await ingest({ cwd: "/path/to/workspace" })
```

Use `rebuild: true` to intentionally discard and recreate an otherwise compatible index:

```ts
await ingest({ cwd: "/path/to/workspace", rebuild: true })
```

Ragmir fingerprints embedding, model revision, chunking, redaction, parsing, and extractor policy.
An incompatible policy triggers a safe full rebuild automatically. Otherwise ingestion updates only
changed or removed source paths; a no-op does not create a new LanceDB table version.

`IngestResult` includes discovered/supported/skipped file counts, `supportedBytes`,
`largestFileBytes`, rebuilt/reused file counts,
unsupported-extension summaries, redaction counts, chunk count, `emptyTextFiles` for supported files
that produced no indexable text, per-file parsing errors, and `policyRebuild`.

### `ingestionLimits(config)`

Returns the effective per-file limit and the hard PDF, Office/archive, and external-extractor safety
bounds. `maxFiles` and `maxCorpusBytes` are `null` because Ragmir has no fixed ceiling for either.

```ts
import { ingestionLimits, loadConfig } from "@jcode.labs/ragmir"

const limits = ingestionLimits(await loadConfig("/path/to/workspace"))
console.log(limits.maxFileBytes, limits.maxFiles)
```

### `audit(cwd?)`

Compares supported files on disk with the current index.

```ts
import { audit } from "@jcode.labs/ragmir"

const report = await audit("/path/to/workspace")
```

Use `missingFromIndex` and `staleInIndex` to decide whether to run `ingest` or `ingest({ rebuild:
true })`. The report also exposes `discoveredFiles`, `supportedBytes`, and `largestFileBytes`.
`emptyTextFiles` lists supported files that were processed but produced no indexable text; they are
not treated as missing while their checksum remains unchanged, but doctor still marks coverage
incomplete.

### `search(query, options?)`

Returns ranked cited passages. Ragmir combines vector candidates with full-text lexical candidates
when the index is available, then falls back to bounded lexical scoring for older indexes.

```ts
import { search } from "@jcode.labs/ragmir"

const passages = await search("Who approved offline operation?", {
  cwd: "/path/to/workspace",
  topK: 8,
  contextRadius: 1,
  includePaths: ["primary"],
  excludePaths: ["research/archive"],
})
```

`includePaths` and `excludePaths` accept exact project-relative paths or directory prefixes. Filters
are applied inside LanceDB before candidate limits and ranking, so excluded mirror or research
folders do not consume top-K candidate capacity.

Each `SearchResult` includes:

| Field | Meaning |
| --- | --- |
| `relativePath` | Source path relative to the Ragmir project root. |
| `source` | Source category used by discovery. |
| `chunkIndex` | Chunk number inside that source file. |
| `citation` | Stable citation including PDF page and line span when available, for example `brief.pdf:p2:L4-L8#3`. |
| `text` | Retrieved redacted chunk text. |
| `distance` | Vector distance when available; `null` for lexical-only rows. |
| `lineStart` / `lineEnd` | 1-based line span for the matched chunk, or `null` for legacy indexes. |
| `pageStart` / `pageEnd` | 1-based PDF page span, or `null` for non-PDF and legacy indexes. |
| `context` | Neighboring chunks when `contextRadius` is set. The matched chunk remains the cited result. |

Use `compactSearchResults(passages)` when an agent or MCP client needs short snippets instead of
full retrieved chunks.

Retrieval uses equal-weight reciprocal-rank fusion over vector and LanceDB FTS candidates, then
deduplicates identical content and diversifies sources. `retrievalProfile` controls candidate breadth
and source density. Ragmir uses exact flat vector search by default and abstains from weak
`local-hash` matches that have no lexical evidence.

### `routePrompt(prompt)`

Classifies a user prompt and suggests whether an agent should use Ragmir local context before
answering. This is deterministic prompt routing, not LLM synthesis and not retrieval.

```ts
import { routePrompt } from "@jcode.labs/ragmir"

const decision = routePrompt("Audit this repository release checklist from cited evidence.")
if (decision.shouldUseRagmir && decision.tool === "ragmir_research") {
  console.log(decision.query)
}
```

The decision includes:

| Field | Meaning |
| --- | --- |
| `shouldUseRagmir` | Whether the prompt appears to need local Ragmir evidence. |
| `confidence` | Deterministic confidence score from `0` to `0.95`. |
| `tool` | Suggested MCP/CLI tool: `ragmir_status`, `ragmir_search`, `ragmir_ask`, `ragmir_research`, or `none`. |
| `query` | Normalized prompt text when Ragmir should be used; otherwise `null`. |
| `reason` | Short explanation of the routing decision. |
| `matchedSignals` | Positive and negative heuristic signals that fired. |
| `safeguards` | Privacy reminders for agent wrappers. |

The router does not store prompt text, call an LLM, read the vector index, or run retrieval. Agent
hooks can use it before deciding whether to call Ragmir over MCP.

### `ask(query, options?)`

Returns retrieval context formatted for an agent or LLM, plus the same cited source list as
`search`.

```ts
import { ask } from "@jcode.labs/ragmir"

const answer = await ask("What evidence supports the project timeline?", {
  cwd: "/path/to/workspace",
  contextRadius: 1,
})
```

`AskResult.answer` is not an LLM synthesis. It is a deterministic retrieval-only text block that
lists cited passages. `contextRadius` adds adjacent chunks around each matched passage without
changing the source citation.

### `research(query, options?)`

Runs an audit-backed research pass for broad agent tasks. It checks index freshness, runs the
security audit, generates multiple retrieval queries from the topic, merges cited evidence, reports
source diagnostics, and optionally scans repository code-like files for matching terms.

```ts
import { compactResearchReport, research } from "@jcode.labs/ragmir"

const report = await research("release readiness and risks", {
  cwd: "/path/to/workspace",
  topK: 8,
})

const compact = compactResearchReport(report)
```

Use `research` before broad summaries, implementation planning, migration notes, or review briefs.
Use `compactResearchReport(report)` before sending results through a constrained agent context.

## Semantic Embeddings

### `pullEmbeddingModel(config)`

Downloads or warms the configured Transformers.js embedding model into `embeddingModelPath`.

```ts
import { loadConfig, pullEmbeddingModel } from "@jcode.labs/ragmir"

const config = await loadConfig("/path/to/workspace")
await pullEmbeddingModel(config)
```

This intentionally allows remote model loading for the bootstrap call. Keep
`transformersAllowRemoteModels` false for confidential indexing after the model files are present.

### `enableSemanticEmbeddings(cwd?)`

Switches the active Ragmir config to the safe semantic path:

- `embeddingProvider: "transformers"`
- existing or default `embeddingModel`
- existing or default `embeddingModelPath`
- `transformersAllowRemoteModels: false`

```ts
import { enableSemanticEmbeddings, ingest } from "@jcode.labs/ragmir"

await enableSemanticEmbeddings("/path/to/workspace")
await ingest({ cwd: "/path/to/workspace", rebuild: true })
```

The CLI shortcut `rgr models pull --enable` combines model preload with this config update. The
first-run CLI shortcut is `rgr setup --semantic`.

## Readiness And Safety

### `doctor(cwd?)`

Returns a readiness report combining setup state, index freshness, security warnings, and next
steps.

`readiness` separates `operationalReady`, `indexPolicyCurrent`, `privacyCompliant`, and
`retrievalQualityVerified`. Retrieval quality remains unverified until callers run an evaluation
gate; it is not inferred from index freshness.

```ts
import { doctor } from "@jcode.labs/ragmir"

const report = await doctor("/path/to/workspace")
if (!report.ready) {
  console.log(report.nextSteps)
}
```

### `securityAudit(cwd?)`

Returns local privacy posture: provider settings, redaction status, access-log behavior, generated
state Git ignore coverage, MCP bounds, and warnings.

The report includes `privacyProfile`, `retrievalProfile`, model revision, and `acceptedRisks`.
Accepted risks are informational and do not suppress warnings.
On POSIX, `permissions` reports whether the config, raw directory, storage directory, and access log
exclude group/other access. `rgr doctor --fix` repairs Ragmir-owned default config and directory
modes; custom external paths remain under the operator's permission policy.

```ts
import { securityAudit } from "@jcode.labs/ragmir"

const report = await securityAudit("/path/to/workspace")
```

`accessLog.storesRawQueries` is always `false`. Ragmir's access log stores project-salted HMAC query
hashes and metadata, not raw query strings.

### `accessLogUsageReport(options?)`

Summarizes recent metadata-only access-log activity. It returns counts by action, unique query-hash
count, average result count, invalid-line count, and the latest event timestamp without exposing raw
queries or local paths.

```ts
import { accessLogUsageReport } from "@jcode.labs/ragmir"

const report = await accessLogUsageReport({ cwd: "/path/to/workspace", days: 7 })
```

### `redactText(input, config)`

Applies built-in and custom redaction patterns to text before indexing.

```ts
import { loadConfig, redactText } from "@jcode.labs/ragmir"

const config = await loadConfig("/path/to/workspace")
const redacted = redactText("contact: user@example.com", config)
```

Returns `{ text, counts }`.

### `destroyIndex(cwd?)`

Deletes generated `.ragmir/storage` index files, or a safe configured storage directory. Ragmir
rejects filesystem roots, the project root, home-directory ancestors, and paths without a valid
index manifest.

```ts
import { destroyIndex } from "@jcode.labs/ragmir"

await destroyIndex("/path/to/workspace")
```

This does not make forensic deletion claims. Use encrypted volumes and key destruction for stronger
at-rest guarantees.

## Agent And MCP Integration

### `installSkill(options?)`

Installs the portable Ragmir skill pack and MCP helper files under `.ragmir/`.

```ts
import { installSkill } from "@jcode.labs/ragmir"

const result = await installSkill({ cwd: "/path/to/workspace" })
```

Pass the same `agents`, `mcpServerName`, `mcpCommand`, and `mcpArgs` options to refresh a targeted
agent kit without re-running full setup.

The installed skills are:

- `ragmir`
- `ragmir-audio-summary`
- `ragmir-markdown-report`
- `ragmir-legal-dossier`

### `installAgentSkills(options?)`

Creates native agent discovery folders for selected agents and links or copies the `.ragmir/skills`
source.

```ts
import { installAgentSkills } from "@jcode.labs/ragmir"

await installAgentSkills({
  cwd: "/path/to/workspace",
  agents: ["claude", "codex"],
  scope: "project",
  mode: "link",
})
```

Supported agents are exported as `SUPPORTED_AGENT_TARGETS`.

### `parseAgentTargets(value)`

Parses CLI-style comma-separated agent names into supported agent identifiers.

```ts
import { parseAgentTargets } from "@jcode.labs/ragmir"

const agents = parseAgentTargets("claude,codex,kimi")
```

### `serveMcp(cwd?)`

Starts the MCP stdio server. It is normally called by the CLI, not directly inside a long-running
application process.

```ts
import { serveMcp } from "@jcode.labs/ragmir"

await serveMcp("/path/to/workspace")
```

When `cwd` is omitted, the server resolves the root from `RAGMIR_PROJECT_ROOT`, then from the current
working directory if it contains a Ragmir config, then from agent-provided project environment such as
`CLAUDE_PROJECT_DIR`, and finally from `process.cwd()`.

MCP tools exposed by the server:

| Tool | Input |
| --- | --- |
| `ragmir_status` | `{}` |
| `ragmir_route_prompt` | `{ prompt: string }` |
| `ragmir_search` | `{ query: string, topK?: number, contextRadius?: number, compact?: boolean, includePaths?: string[], excludePaths?: string[] }` |
| `ragmir_ask` | `{ query: string, topK?: number, contextRadius?: number, includePaths?: string[], excludePaths?: string[] }` |
| `ragmir_research` | `{ query: string, topK?: number, includeCode?: boolean, compact?: boolean, includePaths?: string[], excludePaths?: string[] }` |
| `ragmir_audit` | `{}` |
| `ragmir_evaluate` | `{ goldenPath: string, topK?: number, failUnder?: number }` |
| `ragmir_usage_report` | `{ days?: number }` |
| `ragmir_security_audit` | `{}` |

`topK` is bounded by `mcpMaxTopK` from config, and `contextRadius` is capped at 3 chunks on each
side. `ragmir_evaluate` also requires `goldenPath` to stay inside the MCP project root. Evaluation
golden files support `expectedPaths` for file-level recall and `expectedCitations` for exact
`relative/path:Lx-Ly#chunkIndex` checks. PDF citations may also include `:pN`. Older indexes without
line metadata fall back to `relative/path#chunkIndex` until they are rebuilt. Evaluation output
separates hit rate, Recall@K, Precision@K, MRR, bounded nDCG, and p50/p95 latency. Individual golden
queries may define `includePaths` and `excludePaths` using the same source-filter semantics.

`ragmir_status` includes `ingestionLimits`. This lets clients disclose the current safety bounds
without inferring them from configuration defaults.

With `privacyProfile: "strict"`, MCP returns compact search/research output by default, compact cited
retrieval for `ragmir_ask`, project-relative paths for status and security reports, and never enables
repository-wide code scanning.

## Package Manager Helpers

### `detectPackageManager(cwd?)`

Detects `pnpm`, `npm`, `yarn`, or `bun` from package metadata and lockfiles.

### `rgrCommand(cwd, args)`

Builds the package-manager-specific command that runs `rgr`.

```ts
import { rgrCommand } from "@jcode.labs/ragmir"

const command = await rgrCommand("/path/to/workspace", ["doctor"])
console.log(command.display)
```

## Version

`VERSION` exports the package version compiled into the package.
