# Mimir Core API Reference

This reference covers the public TypeScript API exported by `@jcode.labs/mimir`. It is for
developers embedding Mimir Core in local tools, scripts, desktop shells, MCP launchers, or tests.

Mimir Core does not call an LLM and does not write final generated answers. Retrieval APIs return
cited local context; answer synthesis belongs to the agent or model runtime you choose around that
context.

## Import Surface

Use named imports only:

```ts
import { ask, doctor, ingest, search, securityAudit } from "@jcode.labs/mimir"
```

Most project-scoped functions accept an optional `cwd` pointing at the target workspace. If omitted,
Mimir resolves the project from `process.cwd()`.

```ts
await ingest({ cwd: "/path/to/local/workspace" })
const results = await search("offline approval", { cwd: "/path/to/local/workspace", topK: 5 })
```

## Project Setup

### `initProject(cwd?)`

Creates the local Mimir scaffolding:

- `.mimir/config.json`
- `.mimir/sources.txt`
- `.mimir/raw/`
- `.gitignore` entries for `.mimir/`

When a project already has legacy `.kb/config.json`, `initProject` preserves that config instead of
creating a second active config.

```ts
import { initProject } from "@jcode.labs/mimir"

const created = await initProject("/path/to/workspace")
```

Returns `string[]` with relative paths created or updated.

### `setupProject(options?)`

Runs the normal first-run workflow: initialize the project, install the portable agent kit, run
doctor, and auto-ingest only when supported files are present and the privacy posture has no
warnings.

```ts
import { setupProject } from "@jcode.labs/mimir"

const result = await setupProject({ cwd: "/path/to/workspace", ingest: true })
```

Useful result fields:

| Field | Meaning |
| --- | --- |
| `created` | Relative scaffolding files created by setup. |
| `agentKit` | Paths to generated skills and MCP helper files. |
| `ingested` | `IngestResult` when auto-ingest ran; otherwise `null`. |
| `doctor` | Final readiness report. |
| `nextSteps` | User-facing next actions. |

### `loadConfig(start?)`

Finds `.mimir/config.json` by walking upward from `start`, falls back to legacy `.kb/config.json`
when present, applies defaults and `MIMIR_*` environment overrides, and returns resolved absolute
paths. Legacy `KB_*` aliases are still accepted.

```ts
import { loadConfig } from "@jcode.labs/mimir"

const config = await loadConfig("/path/to/workspace/subdir")
console.log(config.projectRoot)
```

## Ingestion And Retrieval

### `ingest(options?)`

Discovers supported source files, parses them, redacts configured patterns, chunks text, embeds
chunks, and writes the local LanceDB table.

```ts
import { ingest } from "@jcode.labs/mimir"

const result = await ingest({ cwd: "/path/to/workspace" })
```

Use `rebuild: true` after changing the embedding provider or model:

```ts
await ingest({ cwd: "/path/to/workspace", rebuild: true })
```

`IngestResult` includes discovered/supported/skipped file counts, rebuilt/reused file counts,
unsupported-extension summaries, redaction counts, chunk count, `emptyTextFiles` for supported files
that produced no indexable text, and per-file parsing errors.

### `audit(cwd?)`

Compares supported files on disk with the current index.

```ts
import { audit } from "@jcode.labs/mimir"

const report = await audit("/path/to/workspace")
```

Use `missingFromIndex` and `staleInIndex` to decide whether to run `ingest` or `ingest({ rebuild:
true })`. `emptyTextFiles` lists supported files that were processed but produced no indexable text;
they are not treated as missing while their checksum remains unchanged.

### `search(query, options?)`

Returns ranked cited passages. Mimir combines vector candidates with bounded lexical scoring.

```ts
import { search } from "@jcode.labs/mimir"

const passages = await search("Who approved offline operation?", {
  cwd: "/path/to/workspace",
  topK: 8,
})
```

Each `SearchResult` includes:

| Field | Meaning |
| --- | --- |
| `relativePath` | Source path relative to the Mimir project root. |
| `source` | Source category used by discovery. |
| `chunkIndex` | Chunk number inside that source file. |
| `text` | Retrieved redacted chunk text. |
| `distance` | Vector distance when available; `null` for lexical-only rows. |

Use `compactSearchResults(passages)` when an agent or MCP client needs short snippets instead of
full retrieved chunks.

### `ask(query, options?)`

Returns retrieval context formatted for an agent or LLM, plus the same cited source list as
`search`.

```ts
import { ask } from "@jcode.labs/mimir"

const answer = await ask("What evidence supports the project timeline?", {
  cwd: "/path/to/workspace",
})
```

`AskResult.answer` is not an LLM synthesis. It is a deterministic retrieval-only text block that
lists cited passages.

### `research(query, options?)`

Runs an audit-backed research pass for broad agent tasks. It checks index freshness, runs the
security audit, generates multiple retrieval queries from the topic, merges cited evidence, reports
source diagnostics, and optionally scans repository code-like files for matching terms.

```ts
import { compactResearchReport, research } from "@jcode.labs/mimir"

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
import { loadConfig, pullEmbeddingModel } from "@jcode.labs/mimir"

const config = await loadConfig("/path/to/workspace")
await pullEmbeddingModel(config)
```

This intentionally allows remote model loading for the bootstrap call. Keep
`transformersAllowRemoteModels` false for confidential indexing after the model files are present.

### `enableSemanticEmbeddings(cwd?)`

Switches the active Mimir config to the safe semantic path:

- `embeddingProvider: "transformers"`
- existing or default `embeddingModel`
- existing or default `embeddingModelPath`
- `transformersAllowRemoteModels: false`

```ts
import { enableSemanticEmbeddings, ingest } from "@jcode.labs/mimir"

await enableSemanticEmbeddings("/path/to/workspace")
await ingest({ cwd: "/path/to/workspace", rebuild: true })
```

The CLI shortcut `mimir models pull --enable` combines model preload with this config update.

## Readiness And Safety

### `doctor(cwd?)`

Returns a readiness report combining setup state, index freshness, security warnings, and next
steps.

```ts
import { doctor } from "@jcode.labs/mimir"

const report = await doctor("/path/to/workspace")
if (!report.ready) {
  console.log(report.nextSteps)
}
```

### `securityAudit(cwd?)`

Returns local privacy posture: provider settings, redaction status, access-log behavior, generated
state Git ignore coverage, MCP bounds, and warnings.

```ts
import { securityAudit } from "@jcode.labs/mimir"

const report = await securityAudit("/path/to/workspace")
```

`accessLog.storesRawQueries` is always `false`. Mimir's access log stores query hashes and metadata,
not raw query strings.

### `accessLogUsageReport(options?)`

Summarizes recent metadata-only access-log activity. It returns counts by action, unique query-hash
count, average result count, invalid-line count, and the latest event timestamp without exposing raw
queries or local paths.

```ts
import { accessLogUsageReport } from "@jcode.labs/mimir"

const report = await accessLogUsageReport({ cwd: "/path/to/workspace", days: 7 })
```

### `redactText(input, config)`

Applies built-in and custom redaction patterns to text before indexing.

```ts
import { loadConfig, redactText } from "@jcode.labs/mimir"

const config = await loadConfig("/path/to/workspace")
const redacted = redactText("contact: user@example.com", config)
```

Returns `{ text, counts }`.

### `destroyIndex(cwd?)`

Deletes generated `.mimir/storage` index files, or the configured legacy storage directory when a
legacy project still uses `.kb/config.json`.

```ts
import { destroyIndex } from "@jcode.labs/mimir"

await destroyIndex("/path/to/workspace")
```

This does not make forensic deletion claims. Use encrypted volumes and key destruction for stronger
at-rest guarantees.

## Agent And MCP Integration

### `installSkill(options?)`

Installs the portable Mimir skill pack and MCP helper files under `.mimir/`.

```ts
import { installSkill } from "@jcode.labs/mimir"

const result = await installSkill({ cwd: "/path/to/workspace" })
```

The installed skills are:

- `mimir`
- `mimir-audio-summary`
- `mimir-markdown-report`
- `mimir-legal-dossier`

### `installAgentSkills(options?)`

Creates native agent discovery folders for selected agents and links or copies the `.mimir/skills`
source.

```ts
import { installAgentSkills } from "@jcode.labs/mimir"

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
import { parseAgentTargets } from "@jcode.labs/mimir"

const agents = parseAgentTargets("claude,codex,kimi")
```

### `serveMcp(cwd?)`

Starts the MCP stdio server. It is normally called by the CLI, not directly inside a long-running
application process.

```ts
import { serveMcp } from "@jcode.labs/mimir"

await serveMcp("/path/to/workspace")
```

MCP tools exposed by the server:

| Tool | Input |
| --- | --- |
| `mimir_status` | `{}` |
| `mimir_search` | `{ query: string, topK?: number, compact?: boolean }` |
| `mimir_ask` | `{ query: string, topK?: number }` |
| `mimir_research` | `{ query: string, topK?: number, includeCode?: boolean, compact?: boolean }` |
| `mimir_audit` | `{}` |
| `mimir_evaluate` | `{ goldenPath: string, topK?: number, failUnder?: number }` |
| `mimir_usage_report` | `{ days?: number }` |
| `mimir_security_audit` | `{}` |

`topK` is bounded by `mcpMaxTopK` from config. `mimir_evaluate` also requires `goldenPath` to stay
inside the MCP project root.

## Package Manager Helpers

### `detectPackageManager(cwd?)`

Detects `pnpm`, `npm`, `yarn`, or `bun` from package metadata and lockfiles.

### `mimirCommand(cwd, args)`

Builds the package-manager-specific command that runs `mimir`.

```ts
import { mimirCommand } from "@jcode.labs/mimir"

const command = await mimirCommand("/path/to/workspace", ["doctor"])
console.log(command.display)
```

`kbCommand` remains available as a legacy compatibility alias.

## Version

`VERSION` exports the package version compiled into the package.
