# TypeScript API reference

Ragmir publishes three ESM packages for Node.js 20 or later:

| Package | Recommended entry point |
| --- | --- |
| `@jcode.labs/ragmir` | Index and retrieve cited project evidence. |
| `@jcode.labs/ragmir-chat` | Generate a cited answer from passages with a local GGUF model. |
| `@jcode.labs/ragmir-tts` | Render reviewed text as local WAV or explicit online MP3 audio. |

Use the CLI or MCP server when an agent or automation only needs to retrieve evidence. Use these
APIs when a Node.js process owns the workflow. All paths resolve from `cwd` or the current working
directory, and generated state stays under the project's ignored `.ragmir/` directory. With the
default `local-hash` provider, Core indexes and retrieves private project files locally and
offline. Only passages a caller explicitly hands to an external consumer cross that boundary.

## Core: cited retrieval

```bash
npm install @jcode.labs/ragmir
```

```ts
import { ingest, search, type SearchOptions } from "@jcode.labs/ragmir"

const cwd = process.cwd()
await ingest({ cwd })

const options: SearchOptions = { cwd, topK: 5, explain: true }
const results = await search("Which decision changed the rollout?", options)

for (const result of results) {
  console.log(result.citation, result.text)
}
```

Search results include `relativePath`, `citation`, `chunkIndex`, exact indexed text, verified source
line ranges when available, PDF page ranges, structural context, and optional score explanations.
Citation strings also encode PPTX slides, XLSX sheet and cell ranges, and EPUB spine positions.
`charStart` and `charEnd` always address the redacted indexed text, not the original source bytes.
When parsing or redaction invalidates a source-line mapping, `lineStart` and `lineEnd` are `null`
instead of presenting an unverifiable line claim.

With `explain: true`, `score` includes the vector and lexical ranks, their reciprocal-rank-fusion
contributions, matched terms, backend scores, FTS or complete-fallback activation and reason,
candidate materialization, query-variant count, indexed/unindexed rows, coverage, queue wait as
`workloadQueueMs`, and
`rankingPolicyFingerprint`. The fingerprint
identifies the provider, retrieval profile, fusion parameters, and abstention threshold used by
the result. Equal scores are ordered by stable source and chunk keys, so identical indexes return
the same order regardless of backend row order. Search returns an empty array when every candidate
fails the active provider's evidence threshold.

### Persistent client for Node.js workers

Use one client per project root when a stateful Node.js process performs repeated retrieval. The
client reuses one local LanceDB connection plus one immutable manifest/table snapshot, refreshes the
snapshot only after atomic manifest replacement, and closes each retired table after its last active
reader finishes.

The client and one-shot API share bounded process-local queues per project root for search,
embedding, and ingestion. Saturation raises retryable `RagmirError` code `OVERLOADED`; queue expiry
raises `TIMEOUT`. Caller abort signals remove queued work before it starts. `close()` stops new
admission and waits for already accepted queued and active operations before closing LanceDB.

```ts
import { createRagmirClient, isRagmirError } from "@jcode.labs/ragmir"

const controller = new AbortController()
const ragmir = await createRagmirClient({ cwd: process.cwd() })

try {
  await ragmir.ingest({ signal: controller.signal, timeoutMs: 120_000 })
  const results = await ragmir.search("release approval", {
    topK: 5,
    signal: controller.signal,
    timeoutMs: 10_000,
  })
  console.log(results.map(({ citation }) => citation))
} catch (error) {
  if (isRagmirError(error)) {
    console.error(error.code, error.retryable)
  } else {
    throw error
  }
} finally {
  await ragmir.close()
}
```

`RagmirClient` exposes `ingest`, `search`, `ask`, `research`, `expandCitation`, `status`, `sources`,
and an idempotent `close`. Every data operation accepts `signal` and `timeoutMs` through its options.
`close()` takes no options, rejects new work, waits for active operations, flushes the bounded
metadata-only access-log writer, closes the shared connection, and releases the client's embedding
model ownership. The final owner retires the matching Transformers pipeline only after active
inference leases finish.
Index writes targeting the same storage directory are serialized across local OS processes. The
private lock records its PID, run ID, owner token, start time, and heartbeat; readers do not acquire
it. A dead local owner is recovered automatically, while bounded contention returns the retryable
`INDEX_BUSY` error.
Cancellation is cooperative between filesystem, parsing, embedding, storage, retrieval, and
diagnostic phases.

`status()` reads compact manifest health without opening the vector table. `sources({ offset,
limit })` streams only the requested page from the manifest file snapshot; `limit` defaults to 50
and is capped at 100. Totals remain complete, and `page.nextOffset` is `null` on the final page.

`RagmirError.code` is one of `ABORTED`, `CLIENT_CLOSED`, `INDEX_BUSY`, `INTERNAL`,
`INVALID_ARGUMENT`, `OVERLOADED`, or `TIMEOUT`. `retryable` is true for cancellation, timeout,
overload, and busy-index errors. `isRagmirError(error)` narrows
unknown failures, while `normalizeRagmirError(error)` preserves Ragmir errors and converts other
failures into an `INTERNAL` `RagmirError` with the original cause.

The lock is local-machine coordination, not a distributed lock. Do not share one writable index
directory across hosts or a network filesystem; build one local index per machine instead.

This API targets stateful Node.js processes with a local filesystem. It is not an edge or stateless
serverless API, and Ragmir does not provide an HTTP listener. A network-facing application owns
authentication, authorization, rate limits, and transport security.

### Project and source setup

| Export | Purpose |
| --- | --- |
| `initProject(cwd?)` | Create local configuration and ignore rules. |
| `setupProject(options?)` | Initialize sources, agent helpers, and optional semantic retrieval. |
| `loadConfig(start?)` | Resolve and validate effective configuration from the nearest base. |
| `knowledgeBaseIdentity(start?)` | Identify the nearest base relative to the outer workspace. |
| `discoverKnowledgeBases(start?)` | List root and nested bases and mark the active one. |
| `getKnowledgeBaseContext(cwd?, options?)` | Return bounded identity, readiness, freshness, and capabilities. |
| `getKnowledgeBaseSourceCatalog(cwd?, options?)` | Return paged manifest source coverage with complete totals. |
| `listSourceEntries(cwd?)` | Read configured source and exclusion entries. |
| `addSourceEntries(options)` | Add source paths or exclusions without duplicating entries. |

### Index and retrieve

| Export | Purpose |
| --- | --- |
| `ingest(options?)` | Incrementally parse, redact, chunk, embed, and store selected files. |
| `getIngestionProgress(config)` | Read durable progress for the latest ingestion run. |
| `audit(cwd?, options?)` | Run a deep O(corpus) comparison of files on disk with the current index. |
| `previewChunks(options?)` | Return redacted chunks and distributions without writing an index. |
| `search(query, options?)` | Return ranked cited passages. |
| `ask(query, options?)` | Return cited retrieval context without calling an LLM. |
| `research(query, options?)` | Run bounded, rank-aware multi-query retrieval and report evidence gaps. |
| `expandCitation(citation, options?)` | Read one exact chunk and a bounded neighbor window. |
| `compactSearchResults(results, maxLength?)` | Reduce retrieved passages for a limited context window. |
| `compactResearchReport(report)` | Replace full research evidence text with compact snippets. |
| `evaluateGoldenQueries(options)` | Score Recall@1/3/5/10, Precision@5, MRR@10, graded nDCG@10, exact citations, and abstention against a local golden-query file. |

One evaluation pins a single configuration, connection, manifest generation, table handle, and
embedding model. Cases run with bounded concurrency, preserve file order in the report, and release
all scoped resources when evaluation finishes.

`SearchOptions` accepts `cwd`, `topK`, `contextRadius`, `includePaths`, `excludePaths`,
`contextPaths`, `explain`, `vectorSearchMode`, `signal`, and `timeoutMs`. Set
`vectorSearchMode: "exact"` to bypass ANN for diagnostic comparison; the default `"adaptive"`
uses the compatible strategy recorded in the manifest. `topK` is limited to 100 and
`contextRadius` is clamped to three chunks. `IngestOptions` also accepts `rebuild`, a
positive `batchSize` that defaults to 25 files and is capped at 128, `incrementalFailurePolicy`, and
an optional `onProgress` callback. The default `preserve-last-good` policy keeps prior rows searchable and marks
them stale when a changed file fails; `remove-stale` deletes them. Its durable progress contains the
run ID, resume flag, last activity, chunk count, stale count, and per-stage file counts.
Atomic sidecar replacement flushes file contents before rename and synchronizes the storage
directory where supported. The activation manifest keeps one validated previous generation for
recovery. Retrieval may use that generation after canonical sidecar loss or corruption, but doctor
reports a recovery warning and readiness remains false until `ingest --rebuild` repairs it.
Parsing windows are independently bounded by source bytes and estimated chunks. Embeddings are
bounded by batch size and vector bytes, while each file remains the atomic durable commit unit.
`DoctorOptions.deep` enables live O(corpus) inventory and security probes; default doctor and status
paths consume persisted manifest health. `KnowledgeBaseSourceCatalogOptions` accepts zero-based
`offset`, a `limit` from 1 to 100, `signal`, and `timeoutMs`.

`IngestOptions`, `ResearchOptions`, `ExpandCitationOptions`, `EvaluationOptions`, and
`AccessLogUsageOptions` accept `signal` and `timeoutMs`. Diagnostic functions that take a separate
`options` argument use the same `OperationOptions` contract. When explanation is enabled, each
result includes reciprocal-rank fusion contributions, one-based vector and lexical ranks, vector
distance, lexical backend and coverage diagnostics, and matched query terms.
`ExpandCitationOptions.contextRadius` is
clamped to three chunks.

`ResearchOptions` also accepts `fullAudit`, `codeTopK`, `codeScanMaxFiles`,
`codeScanMaxBytes`, and `codeScanConcurrency`. The defaults are a manifest-only health snapshot,
20 code results, 1,000 files, 32 MiB, and four concurrent reads. Limits are capped at 100 results,
10,000 files, 256 MiB, and 16 reads. A full source inventory is opt-in with `fullAudit: true`.
`ResearchReport.budgets` records configured and consumed budgets; `audit.mode` distinguishes
`manifest` from `full`. Evidence exposes a weighted cross-query RRF `researchScore` and `bestRank`.
The original query has a protected weight so language-aware expansions can add evidence without
removing direct-search results from the same candidate depth.

Golden evaluation files are limited to 1 MiB and 100 cases. Each query is limited to 20,000
characters, with at most 100 expected paths or citations of 500 characters each.
`AccessLogUsageOptions.days` accepts an integer from 1 to 3650.

Structural context comes from Markdown headings or structured-data paths. It can improve candidate
selection without changing the exact text, offsets, or citations returned to the caller.

### Operations, diagnostics, and privacy

| Export | Purpose |
| --- | --- |
| `doctor(cwd?, options?)` | Report setup, source, index, and agent-integration readiness. |
| `securityAudit(cwd?, options?)` | Report local privacy, redaction, private-path Git/permission state, extractor authority, and MCP posture. |
| `ingestionLimits(config)` | Read active parser safety limits. |
| `accessLogUsageReport(options?)` | Summarize metadata-only local access logs. |
| `accessLogWriterMetrics(config)` | Read pending, in-flight, written, and dropped access-log event counts. |
| `flushAccessLog(config)` | Flush the bounded asynchronous access-log writer and return its metrics. |
| `optimizeStorage(options?)` | Inspect or force fragment compaction, old-version pruning, and complete FTS, adaptive-vector, and scalar-index coverage under the local writer lock. |
| `collectGenerationGarbage(options?)` | Inspect generation roles or reclaim expired, unleased tables under the local writer lock. |
| `destroyIndex(cwd?)` | Remove generated index data without deleting source files. |
| `redactText(input, config)` | Apply configured redaction before custom processing; unsafe custom expressions are rejected before matching. |
| `routePrompt(prompt)` | Recommend deterministically whether a prompt needs retrieval. |
| `getIndexFreshnessWarning(config)` | Return a stale-index warning or `null`. |
| `getLexicalScanWarning(config, chunkCount)` | Return a lexical-scan capacity warning or `null`. |
| `INDEX_SCHEMA_VERSION` | Current persisted index schema version. |
| `VERSION` | Installed Ragmir Core package version. |

### Optional embeddings and PDF OCR

| Export | Purpose |
| --- | --- |
| `enableSemanticEmbeddings(cwd?, artifact?)` | Enable Transformers embeddings and optionally persist a verified revision and artifact digest. |
| `pullEmbeddingModel(config)` | Download the configured model explicitly and return its resolved revision, local path, and canonical artifact digest. |
| `clearTransformersCache()` | Retire process-local Transformers pipelines without interrupting active inference. |
| `disposeTransformersCache()` | Retire all cached pipelines and wait for their active leases and disposal. |
| `disposeTransformersModel(config)` | Retire one exact model identity and wait for safe disposal. |
| `inspectPdfOcr(cwd?)` | Detect configured local OCR tools and readiness. |
| `configurePdfOcr(options?)` | Write a safe page-aware PDF OCR command. |
| `extractPdfPage(options)` | Run the low-level local PDF page extractor. |
| `extractPdfPages(options)` | Run one bounded local OCR batch and return ordered page text plus process diagnostics. |

Semantic embeddings and OCR are opt-in boundaries. Core never calls a cloud OCR service, and a
model download must be explicitly enabled before local inference can use it. The default
`local-hash` path does not resolve Transformers.js, ONNX Runtime, or Sharp. Bundled embedding
profiles use immutable model commits; the resolved artifact digest participates in persisted index
and quality compatibility. PDF parsing exposes content-free `PdfOcrMetrics`; generated OCR setup
batches pages and caches each result privately by content and runtime identity.

### MCP, skills, and command helpers

| Export | Purpose |
| --- | --- |
| `createMcpServer(cwd?)` | Construct the read-focused MCP server without selecting a transport. |
| `connectMcpServer(transport, cwd?)` | Connect a caller-owned MCP transport and return a closeable server handle. |
| `serveMcp(cwd?)` | Start the local stdio MCP server. |
| `installAgentSkills(options?)` | Install the canonical skill kit for selected native agents. |
| `installSkill(options?)` | Install one bundled skill with ownership checks. |
| `inspectAgentIntegration(cwd?)` | Verify runner and native skill discovery. |
| `parseAgentTargets(value)` | Validate and normalize agent target input. |
| `SUPPORTED_AGENT_TARGETS` | Supported native helper targets. |
| `bundledSkillPath(skillName?)` | Resolve a bundled skill path inside the installed package. |
| `detectPackageManager(cwd?)` | Detect the target project's package manager. |
| `rgrCommand(cwd, args)` | Prefer the generated runner, then build a package-manager command. |
| `kbCommand(cwd, args)` | Compatibility alias for older integrations. |
| `ragmirCommand(cwd, args)` | Compatibility alias for older integrations. |

New integrations should use `rgrCommand` and the `rgr` CLI name. Search, ask, research, expansion,
audit, and evaluation accept `maxBytes`; every tool and resource JSON response is bounded by the
configured `mcpMaxOutputBytes` and an absolute 1 MiB ceiling. Search, ask, and research also accept
compact output. When a response does not fit, the server selects a typed summary with exact scalar
values, previews, and omission counters rather than recursively shortening arbitrary strings. A
successful search keeps its best citation at the minimum 1 KiB budget. Retrieval depth, source
pages, audit previews, and returned evaluation case details are capped before their response report
is constructed; aggregate audit and evaluation metrics still cover the complete requested work.
Metrics are returned under
`_meta["ragmir/output"]` and summarized by the metadata-only usage report.

Each MCP server resolves configuration once per request, lazily reuses one `RagmirClient` per
effective configuration, closes and refreshes it after configuration changes, and closes it with the
server. All tools advertise non-destructive behavior. Search, ask, research, and evaluation
conservatively advertise open-world behavior because
explicitly enabled Transformers models may download public weights. The pure prompt router,
security audit, and usage report also advertise read-only, idempotent behavior. Other tools do not
because they can initialize ignored local state or append metadata-only access logs. MCP cancellation
signals propagate into Core retrieval, audit, evaluation, security, usage, and resource operations.
Native filesystem and LanceDB calls that do not expose `AbortSignal` are checked immediately before
and after the call, so cancellation waits only for that in-flight native operation to return.
`ragmir_evaluate` requires an existing
project-relative golden file and rejects absolute paths, traversal, and symlinks outside the root.
Its result includes one gate per declared quality threshold, grouped category and locale metrics,
the model revision, golden fingerprint, index fingerprint, complete aggregate metrics, and whether
a compatible report was stored for `doctor`. Library callers can set
`EvaluationOptions.caseDetailLimit` to return only a bounded case preview; `omittedCases` reports
the remaining evaluated cases.
Strict mode returns that project-relative path, replaces evaluation errors with a generic message,
and masks configured model, storage, source, and access-log paths in diagnostic responses.

### Core type exports

The package exports the named types used by every public function signature, including the options
types that callers commonly compose explicitly.

| Area | Exported types |
| --- | --- |
| Configuration | `Config`, `PrivacyProfile`, `RetrievalProfile` |
| Ingestion | `IngestOptions`, `IngestResult`, `IncrementalFailurePolicy`, `IngestionProgress`, `IngestionFileStage`, `IngestionRunMode`, `IngestionRunStatus`, `AuditReport`, `ChunkStats`, `IngestionLimitsReport`, `IndexManifest`, `IndexHealthSnapshot`, `IndexMaintenanceSnapshot`, `IndexManifestFile`, `IndexManifestStaleFile`, `VectorIndexManifest`, `VectorIndexParameters`, `VectorIndexStrategy`, `ParsedPage` |
| Preview | `PreviewChunksOptions`, `PreviewReport`, `PreviewFile`, `PreviewChunk` |
| Retrieval | `SearchOptions`, `SearchResult`, `SearchContextChunk`, `SearchScoreExplanation`, `AskResult`, `CompactSearchResult`, `ExpandCitationOptions`, `ExpandedCitation` |
| Research, audit, and evaluation | `ResearchOptions`, `ResearchReport`, `ResearchEvidence`, `CodeEvidence`, `SourceDiagnostics`, `SourceDuplicateCandidate`, `SourcePathCandidate`, `AuditOptions`, `AuditReport`, `EvaluationOptions`, `EvaluationResult`, `EvaluationCaseResult`, `GoldenQuery` |
| Bases and sources | `KnowledgeBaseIdentity`, `KnowledgeBaseInfo`, `KnowledgeBaseInventory`, `KnowledgeBaseContextReport`, `KnowledgeBaseSourceCatalog`, `KnowledgeBaseSourceCatalogOptions`, `AddSourceEntriesOptions`, `AddSourceEntriesResult`, `SourceEntriesResult` |
| Operations | `RagmirClientOptions`, `OperationOptions`, `DoctorOptions`, `SecurityAuditOptions`, `OptimizeStorageOptions`, `StorageMaintenanceAction`, `StorageMaintenanceReason`, `StorageMaintenanceReport`, `AdaptiveIndexAction`, `AdaptiveIndexMaintenanceReport`, `ScalarIndexStatus`, `CollectGenerationGarbageOptions`, `GenerationGarbageCollectionReport`, `GenerationInventoryItem`, `GenerationRole`, `RagmirErrorCode`, `DoctorReport`, `SecurityAuditReport`, `DestroyIndexResult`, `AccessLogAction`, `AccessLogUsageOptions`, `AccessLogUsageReport`, `AccessLogWriterMetrics`, `McpOutputTool`, `McpOutputUsageReport`, `RedactionCount` |
| Embeddings and OCR | `EnableSemanticEmbeddingsResult`, `PullEmbeddingModelResult`, `ConfigurePdfOcrOptions`, `ConfigurePdfOcrResult`, `ExtractPdfPageOptions`, `ExtractPdfPagesOptions`, `ExtractPdfPagesResult`, `PdfOcrMetrics`, `OcrExecutableStatus`, `PdfOcrEngine`, `PdfOcrEngineSelection`, `PdfOcrStatus` |
| Agent integration | `AgentHelperFile`, `AgentInstallMode`, `AgentInstallScope`, `AgentIntegrationReport`, `AgentSkillInstallation`, `AgentTarget`, `InstallAgentSkillsOptions`, `InstallAgentSkillsResult`, `InstallSkillOptions`, `InstallSkillResult`, `RagmirRunnerMode` |
| Setup and commands | `SetupOptions`, `SetupResult`, `SetupSemanticResult`, `PackageManager`, `RagmirCommand`, `PromptRouteDecision`, `PromptRouteTool` |

## Chat: cited local generation

```bash
npm install @jcode.labs/ragmir-chat
```

Chat does not discover or index files. Pass it passages returned by Core, or use `rgr chat` to run
retrieval and generation together.

```ts
import {
  generateChatAnswer,
  setupChatModel,
  type ChatSource,
} from "@jcode.labs/ragmir-chat"

await setupChatModel({ profile: "lite" })

const sources: ChatSource[] = [
  {
    relativePath: "docs/rollout.md",
    chunkIndex: 0,
    text: "The rollout moved from Friday to Monday after the review.",
  },
]

const result = await generateChatAnswer({
  question: "What changed in the rollout?",
  profile: "lite",
  sources,
})

console.log(result.answer, result.citationStatus)
```

`profile` accepts `lite` (Qwen2.5 0.5B, ~0.49 GB, thinking off), `fast` (default Gemma 4 E2B,
~3.35 GB), or `quality` (Gemma 4 E4B, ~5.15 GB). Setup, doctor, and generation should use the same
profile.

### Recommended Chat exports

| Export | Purpose |
| --- | --- |
| `setupChatModel(options?)` | Download and verify one selected model profile explicitly. |
| `generateChatAnswer(options)` | Generate from supplied evidence and validate citation markers. |
| `doctor(options?)` | Inspect runtime, backend, model, manifest, size, and optional hash validity. |
| `modelCacheExists(cwd?, profile?, modelPath?)` | Check the expected local model file and size. |
| `CHAT_MODEL_PROFILES` | Read the immutable profile definitions. |
| `DEFAULT_CHAT_PROFILE` | Read the default profile name. |

Normal generation rejects remote model resolution. When no usable source is supplied,
`generateChatAnswer` returns an insufficient-context result without loading a model. Raw model
thought is never returned or persisted.

### Advanced Chat exports

These exports support custom local runtimes, standalone line-delimited JSON servers, model
preparation tools, and citation validation. Most applications should use the recommended exports
above.

| Area | Runtime exports |
| --- | --- |
| Prompt and citations | `buildChatMessages`, `formatSources`, `validateAnswerCitations` |
| Profiles and paths | `chatModelDefinition`, `chatModelProfile`, `resolveChatModelPaths`, `inspectChatModel` |
| Model preparation | `setupChatModelFiles`, `verifyChatModelFile`, `sha256File` |
| Runtime | `NodeLlamaChatRuntime`, `createChatRuntime`, `isNodeLlamaAvailable`, `inspectNodeLlamaRuntime` |
| JSON server | `serveChat`, `parseChatServerRequest` |
| Profile constants | `CHAT_MODEL_MANIFEST_FILE`, `NODE_LLAMA_RUNTIME_VERSION`, `DEFAULT_CHAT_MODEL`, `DEFAULT_CHAT_MODEL_PATH`, `DEFAULT_CHAT_ALLOW_REMOTE_MODELS`, `DEFAULT_CHAT_SETUP_ALLOW_REMOTE_MODELS` |
| Generation constants | `CHAT_CONTEXT_SIZE`, `LITE_CHAT_CONTEXT_SIZE`, `MAX_CHAT_GENERATION_TOKENS`, `MAX_CHAT_HISTORY_MESSAGES`, `CHAT_THOUGHT_TOKEN_BUDGETS`, `DEFAULT_CHAT_CONTEXT_CHAR_LIMIT`, `DEFAULT_CHAT_MAX_NEW_TOKENS`, `DEFAULT_CHAT_DTYPE`, `DEFAULT_CHAT_THINKING` |

### Chat type exports

| Area | Exported types |
| --- | --- |
| Messages and evidence | `ChatRole`, `ChatMessage`, `ChatHistoryMessage`, `ChatSource`, `ChatCitationStatus`, `CitationValidationResult` |
| Profiles | `ChatModelProfile`, `ChatModelFamily`, `ChatModelProfileDefinition`, `ChatModelManifest`, `ChatModelInspection`, `ChatModelPaths`, `ModelFileResolver` |
| Generation | `ChatThinkingMode`, `ChatStopReason`, `ChatGenerationEvent`, `GenerateChatAnswerOptions`, `GenerateChatAnswerResult` |
| Runtime | `ChatComputeBackend`, `ChatRuntime`, `ChatRuntimeDependencies`, `ChatRuntimeGenerationOptions`, `ChatRuntimeGenerationResult`, `ChatRuntimeInspection`, `CreateChatRuntimeOptions` |
| Setup and doctor | `SetupChatModelOptions`, `SetupChatModelResult`, `DoctorOptions`, `DoctorReport` |
| JSON server | `GenerateChatServerRequest`, `CancelChatServerRequest`, `ShutdownChatServerRequest`, `ChatServerRequest`, `ChatServerEvent`, `ServeChatOptions` |

## TTS: reviewed text to audio

```bash
npm install @jcode.labs/ragmir-tts
```

```ts
import { doctor, renderSpeech } from "@jcode.labs/ragmir-tts"

const runtime = await doctor()
console.log(runtime.transformersAvailable)
const controller = new AbortController()

await renderSpeech({
  cwd: process.cwd(),
  text: "Non-sensitive model preload text.",
  outputPath: "/tmp/ragmir-tts-preload.wav",
  engine: "transformers",
  language: "en",
  allowRemoteModels: true,
})

const result = await renderSpeech({
  cwd: process.cwd(),
  textFile: ".ragmir/reports/release-brief.md",
  outputPath: ".ragmir/audio/release-brief.wav",
  engine: "transformers",
  language: "en",
  allowRemoteModels: false,
  signal: controller.signal,
})

console.log(result.outputPath, result.samplingRate)
```

TTS renders text supplied by the caller. It does not retrieve evidence or write a summary. The
first call explicitly preloads the local model from non-sensitive text. Later calls can keep
`allowRemoteModels: false` for confidential content. The Edge path is explicit and sends narration
text to the external service.

The local Transformers.js path supports `language: "en"`, `"fr"`, and `"es"`, each with its own
automatically selected MMS model. Edge additionally supports `"ja"`, `"th"`, and `"zh"`. French is
the default when no language is provided.

`RenderSpeechOptions.signal` stops before subsequent render or write phases. The Edge CLI is also
terminated when cancelled and defaults to a 120-second bound; override it with `edgeTimeoutMs` when
the host needs a shorter deadline.

### TTS runtime exports

| Export | Purpose |
| --- | --- |
| `renderSpeech(options)` | Render text or a text file and return output metadata. |
| `doctor()` | Report engines, languages, dependencies, and defaults. |
| `isTtsLanguage(value)` | Narrow an external string to a supported language. |
| `mmsModelForLanguage(language)` | Resolve the offline MMS model for a supported language. |
| `edgeVoiceForLanguage(language)` | Resolve the default Edge voice for a supported language. |
| `modelCacheExists(cwd?)` | Check whether the default offline model cache exists. |
| `TTS_LANGUAGES` | Languages supported across all engines. |
| `OFFLINE_TTS_LANGUAGES` | Languages supported by the local Transformers.js path. |
| `DEFAULT_TTS_ENGINE`, `DEFAULT_TTS_LANGUAGE` | Default render choices. |
| `DEFAULT_TTS_MODEL`, `DEFAULT_TTS_MODEL_PATH` | Default offline model and cache path. |
| `DEFAULT_TTS_ALLOW_REMOTE_MODELS` | Default remote model-loading policy. |
| `DEFAULT_AUDIO_DIR` | Default generated-audio directory. |
| `DEFAULT_EDGE_VOICE`, `DEFAULT_EDGE_RATE`, `DEFAULT_EDGE_TTS_TIMEOUT_MS` | Default explicit Edge settings. |

The package exports `RenderSpeechOptions`, `RenderSpeechResult`, `DoctorReport`, `TtsEngine`,
`TtsLanguage`, `OfflineTtsLanguage`, `OutputFormat`, `TextToAudioOptions`,
`TextToAudioOutputLike`, `TextToAudioSynthesizer`, `EdgeTtsRenderer`, and `EdgeTtsRenderOptions`.
The injected synthesizer and Edge renderer types are intended for tests and custom runtimes that
preserve the same local-data boundary.

## Package and runtime guarantees

- All three packages publish ESM JavaScript and TypeScript declarations from one package root.
- Core remains model-agnostic. Chat and TTS are optional add-ons, not MCP requirements.
- A `cwd` option always resolves project state from the caller, never from the installed package.
- Remote downloads and external speech are explicit operations, never silent fallbacks.
