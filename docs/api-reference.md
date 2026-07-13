# TypeScript API reference

Ragmir publishes three ESM packages for Node.js 20 or later:

| Package | Recommended entry point |
| --- | --- |
| `@jcode.labs/ragmir` | Index and retrieve cited project evidence. |
| `@jcode.labs/ragmir-chat` | Generate a cited answer from passages with a local GGUF model. |
| `@jcode.labs/ragmir-tts` | Render reviewed text as local WAV or explicit online MP3 audio. |

Use the CLI or MCP server when an agent or automation only needs to retrieve evidence. Use these
APIs when a Node.js process owns the workflow. All paths resolve from `cwd` or the current working
directory, and generated state stays under the project's ignored `.ragmir/` directory.

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

Search results include `relativePath`, `citation`, `chunkIndex`, exact text, line ranges, page ranges
when available, structural context, and optional score explanations.

### Project and source setup

| Export | Purpose |
| --- | --- |
| `initProject(cwd?)` | Create local configuration and ignore rules. |
| `setupProject(options?)` | Initialize sources, agent helpers, and optional semantic retrieval. |
| `loadConfig(start?)` | Resolve and validate effective configuration from the nearest base. |
| `knowledgeBaseIdentity(start?)` | Identify the nearest base relative to the outer workspace. |
| `discoverKnowledgeBases(start?)` | List root and nested bases and mark the active one. |
| `getKnowledgeBaseContext(cwd?)` | Return bounded identity, readiness, freshness, and capabilities. |
| `getKnowledgeBaseSourceCatalog(cwd?)` | Return bounded source coverage with complete totals. |
| `listSourceEntries(cwd?)` | Read configured source and exclusion entries. |
| `addSourceEntries(options)` | Add source paths or exclusions without duplicating entries. |

### Index and retrieve

| Export | Purpose |
| --- | --- |
| `ingest(options?)` | Incrementally parse, redact, chunk, embed, and store selected files. |
| `audit(cwd?)` | Compare files on disk with the current index. |
| `previewChunks(options?)` | Return redacted chunks and distributions without writing an index. |
| `search(query, options?)` | Return ranked cited passages. |
| `ask(query, options?)` | Return cited retrieval context without calling an LLM. |
| `research(query, options?)` | Run audit-backed multi-query retrieval and report evidence gaps. |
| `expandCitation(citation, options?)` | Read one exact chunk and a bounded neighbor window. |
| `compactSearchResults(results, maxLength?)` | Reduce retrieved passages for a limited context window. |
| `compactResearchReport(report)` | Replace full research evidence text with compact snippets. |
| `evaluateGoldenQueries(options)` | Score retrieval against a local golden-query file. |

`SearchOptions` accepts `cwd`, `topK`, `contextRadius`, `includePaths`, `excludePaths`,
`contextPaths`, and `explain`. When explanation is enabled, each result includes reciprocal-rank
fusion contributions, one-based vector and lexical ranks, vector distance, lexical backend score,
and matched query terms. `ExpandCitationOptions.contextRadius` is clamped to three chunks.

Structural context comes from Markdown headings or structured-data paths. It can improve candidate
selection without changing the exact text, offsets, or citations returned to the caller.

### Operations, diagnostics, and privacy

| Export | Purpose |
| --- | --- |
| `doctor(cwd?)` | Report setup, source, index, and agent-integration readiness. |
| `securityAudit(cwd?)` | Report local privacy, redaction, permissions, and MCP posture. |
| `ingestionLimits(config)` | Read active parser safety limits. |
| `accessLogUsageReport(options?)` | Summarize metadata-only local access logs. |
| `destroyIndex(cwd?)` | Remove generated index data without deleting source files. |
| `redactText(input, config)` | Apply configured redaction before custom processing. |
| `routePrompt(prompt)` | Recommend deterministically whether a prompt needs retrieval. |
| `getIndexFreshnessWarning(config)` | Return a stale-index warning or `null`. |
| `getLexicalScanWarning(config, chunkCount)` | Return a lexical-scan capacity warning or `null`. |
| `INDEX_SCHEMA_VERSION` | Current persisted index schema version. |
| `VERSION` | Installed Ragmir Core package version. |

### Optional embeddings and PDF OCR

| Export | Purpose |
| --- | --- |
| `enableSemanticEmbeddings(cwd?)` | Enable Transformers embeddings after validating local state. |
| `pullEmbeddingModel(config)` | Download the configured embedding model explicitly. |
| `clearTransformersCache()` | Clear the process-local Transformers pipeline cache. |
| `inspectPdfOcr(cwd?)` | Detect configured local OCR tools and readiness. |
| `configurePdfOcr(options?)` | Write a safe page-aware PDF OCR command. |
| `extractPdfPage(options)` | Run the low-level local PDF page extractor. |

Semantic embeddings and OCR are opt-in boundaries. Core never calls a cloud OCR service, and a
model download must be explicitly enabled before local inference can use it.

### MCP, skills, and command helpers

| Export | Purpose |
| --- | --- |
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

New integrations should use `rgrCommand` and the `rgr` CLI name. MCP retrieval tools accept a
`maxBytes` value below the configured `mcpMaxOutputBytes` ceiling. Search, ask, and research also
accept compact output. Metrics are returned under `_meta["ragmir/output"]` and summarized by the
metadata-only usage report.

### Core type exports

The package exports the named types used by every public function signature, including the options
types that callers commonly compose explicitly.

| Area | Exported types |
| --- | --- |
| Configuration | `Config`, `PrivacyProfile`, `RetrievalProfile` |
| Ingestion | `IngestOptions`, `IngestResult`, `AuditReport`, `ChunkStats`, `IngestionLimitsReport`, `IndexManifest`, `IndexManifestFile`, `ParsedPage` |
| Preview | `PreviewChunksOptions`, `PreviewReport`, `PreviewFile`, `PreviewChunk` |
| Retrieval | `SearchOptions`, `SearchResult`, `SearchContextChunk`, `SearchScoreExplanation`, `AskResult`, `CompactSearchResult`, `ExpandCitationOptions`, `ExpandedCitation` |
| Research and evaluation | `ResearchOptions`, `ResearchReport`, `ResearchEvidence`, `CodeEvidence`, `SourceDiagnostics`, `SourceDuplicateCandidate`, `SourcePathCandidate`, `EvaluationOptions`, `EvaluationResult`, `EvaluationCaseResult`, `GoldenQuery` |
| Bases and sources | `KnowledgeBaseIdentity`, `KnowledgeBaseInfo`, `KnowledgeBaseInventory`, `KnowledgeBaseContextReport`, `KnowledgeBaseSourceCatalog`, `AddSourceEntriesOptions`, `AddSourceEntriesResult`, `SourceEntriesResult` |
| Operations | `DoctorReport`, `SecurityAuditReport`, `DestroyIndexResult`, `AccessLogAction`, `AccessLogUsageOptions`, `AccessLogUsageReport`, `McpOutputTool`, `McpOutputUsageReport`, `RedactionCount` |
| Embeddings and OCR | `EnableSemanticEmbeddingsResult`, `PullEmbeddingModelResult`, `ConfigurePdfOcrOptions`, `ConfigurePdfOcrResult`, `ExtractPdfPageOptions`, `OcrExecutableStatus`, `PdfOcrEngine`, `PdfOcrEngineSelection`, `PdfOcrStatus` |
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

const result = await renderSpeech({
  textFile: ".ragmir/reports/release-brief.md",
  outputPath: ".ragmir/audio/release-brief.wav",
  engine: "transformers",
  language: "en",
  allowRemoteModels: false,
})

console.log(result.outputPath, result.samplingRate)
```

TTS renders text supplied by the caller. It does not retrieve evidence or write a summary. The
default Transformers.js path produces local WAV output after an explicit model preload. The Edge
path is explicit and sends narration text to the external service.

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
| `DEFAULT_EDGE_VOICE`, `DEFAULT_EDGE_RATE` | Default explicit Edge settings. |

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
