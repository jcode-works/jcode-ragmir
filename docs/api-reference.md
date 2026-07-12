# TypeScript API reference

```ts
import { ingest, search } from "@jcode.labs/ragmir"

await ingest({ cwd: process.cwd() })
const results = await search("Which decision changed the rollout?", { topK: 5 })
```

All paths resolve from `cwd` or the current working directory. Retrieval results include `relativePath`,
`citation`, `chunkIndex`, text, line ranges, and page ranges when available.

## Project and source setup

| Export | Use |
| --- | --- |
| `initProject(cwd?)` | Create local Ragmir state and ignore rules. |
| `setupProject(options?)` | Initialize sources, helpers, and optional semantic retrieval. |
| `loadConfig(start?)` | Resolve and validate effective configuration. |
| `knowledgeBaseIdentity(start?)` | Identify the nearest base relative to the outer configured workspace. |
| `discoverKnowledgeBases(start?)` | List root and nested bases and mark the active one. |
| `listSourceEntries(cwd?)` | Read configured source entries. |
| `addSourceEntries(options)` | Add source paths or exclusions. |

## Index and retrieve

| Export | Use |
| --- | --- |
| `ingest(options?)` | Incrementally parse, redact, chunk, embed, and store files. |
| `audit(cwd?)` | Compare files on disk with the current index. |
| `search(query, options?)` | Return ranked cited passages. |
| `ask(query, options?)` | Return cited retrieval context without calling an LLM. |
| `research(query, options?)` | Run audit-backed multi-query retrieval. |
| `expandCitation(citation, options?)` | Read one exact indexed chunk and a bounded neighbor window. |
| `compactSearchResults(results)` | Produce compact search output for limited contexts. |
| `compactResearchReport(report)` | Remove verbose evidence text from a research report. |
| `evaluateGoldenQueries(options)` | Score retrieval against a local golden-query file. |

`SearchOptions` accepts `cwd`, `topK`, `contextRadius`, `includePaths`, and `excludePaths`.
`ExpandCitationOptions` accepts `cwd` and a `contextRadius` clamped to three chunks.
Search results expose a `contextPath` derived from Markdown headings or JSON structure. This field
improves retrieval, while `text`, offsets, and citations continue to reference the exact source
passage.

## Operations and privacy

| Export | Use |
| --- | --- |
| `doctor(cwd?)` | Report setup and index readiness. |
| `securityAudit(cwd?)` | Report local privacy, redaction, permissions, and MCP posture. |
| `ingestionLimits(config)` | Read active parser safety limits. |
| `accessLogUsageReport(options?)` | Summarize metadata-only local access logs. |
| `destroyIndex(cwd?)` | Remove generated index data. |
| `redactText(input, config)` | Apply configured redaction before custom processing. |
| `routePrompt(prompt)` | Deterministically recommend whether a prompt needs retrieval. |

## Optional retrieval helpers

| Export | Use |
| --- | --- |
| `enableSemanticEmbeddings(cwd?)` | Safely enable preloaded Transformers embeddings. |
| `pullEmbeddingModel(config)` | Download the configured embedding model explicitly. |
| `clearTransformersCache()` | Clear the local Transformers cache. |
| `inspectPdfOcr(cwd?)` | Detect local OCR tools and configuration. |
| `configurePdfOcr(options?)` | Write a safe page-aware PDF OCR command. |
| `extractPdfPage(options)` | Run the low-level local PDF page extractor. |

## MCP, skills, and command helpers

| Export | Use |
| --- | --- |
| `serveMcp(cwd?)` | Start the local stdio MCP server. |
| `installSkill(options?)` / `installAgentSkills(options?)` | Install bundled helper files. |
| `parseAgentTargets(value)` / `SUPPORTED_AGENT_TARGETS` | Validate supported agent targets. |
| `detectPackageManager(cwd?)` | Detect the target project package manager. |
| `rgrCommand(cwd, args)` | Build the canonical local `rgr` command. |

`kbCommand` and `ragmirCommand` remain compatibility helpers. New integration code should use
`rgrCommand` and the `rgr` CLI name.

In a monorepo, all public operations still resolve the nearest configured ancestor from `cwd`.
`KnowledgeBaseInventory` exposes deterministic relative IDs, while each base keeps its own source,
storage, manifest, and access-log paths.

The MCP retrieval tools accept an optional `maxBytes` below the configured `mcpMaxOutputBytes`
ceiling. `ragmir_search` and `ragmir_research` also accept `compact`; `ragmir_ask` supports the same
flag. Oversized full output is compacted and then reduced as valid JSON. Output metrics are available
under `_meta["ragmir/output"]` and in the metadata-only usage report.
