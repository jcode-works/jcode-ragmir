# CLI Reference

Ragmir ships three CLIs:

- `rgr`: the main local RAG, MCP, skills, security, chat, and audio command.
- `rgr-chat`: the standalone optional local chat add-on used by `rgr chat`.
- `rgr-tts`: the standalone text-to-speech renderer used by `rgr audio`.

## Main Workflow

| Command | Use it when |
| --- | --- |
| `rgr setup` | Initialize Ragmir, install the agent kit, run doctor, ingest when safe, and print a copyable AI prompt for source tuning. |
| `rgr setup --semantic` | Run first setup and explicitly download the configured Transformers.js embedding model for higher-quality semantic retrieval. |
| `rgr init` | Create `.ragmir/config.json` (with a `sources` array), `.ragmir/raw/`, and Git ignore rules. |
| `rgr doctor` | Diagnose setup, index freshness, security warnings, and the next command to run. |
| `rgr doctor --fix` | Create missing scaffolding, install skills/MCP config, and update stale indexes when safe. |
| `rgr ocr doctor` | Detect OCRmyPDF, Tesseract, Poppler, installed OCR languages, and the active PDF OCR configuration. |
| `rgr ocr setup [--engine auto\|ocrmypdf\|tesseract] [--language eng+fra]` | Configure local page-aware PDF OCR without installing tools or editing JSON manually. |
| `rgr models pull` | Download the configured Transformers.js embedding model into `embeddingModelPath`. |
| `rgr models pull --enable` | Download the embedding model and switch Ragmir config to safe Transformers embeddings. |
| `rgr sources add "../apps/*/docs/**/*.md"` | Add source paths, glob patterns, or `!` exclusions to the `sources` array in `.ragmir/config.json`. |
| `rgr sources list` | List active extra source entries from `.ragmir/config.json`. |
| `rgr ingest` | Parse changed source files, redact, chunk, embed, and update the local LanceDB index. |
| `rgr ingest --rebuild` | Force a full re-index. Policy changes already trigger a safe automatic rebuild. |
| `rgr audit` | Check whether supported source files are missing or stale, and report exact-content duplicate and archive/mirror candidates. |
| `rgr audit --unsupported` | List files skipped because they are unsupported, too large, or secret-like. |
| `rgr limits` | Show active per-file and parser safety limits plus unbounded file-count and corpus-size fields. |
| `rgr search "<query>"` | Retrieve ranked passages without asking an LLM to write an answer. |
| `rgr ask "<question>"` | Return cited retrieval context for an agent or trusted model runtime. |
| `rgr chat setup [--profile lite\|fast\|quality]` | Explicitly download and verify a local GGUF. `lite` uses Qwen2.5 0.5B (491 MB), `fast` is the default Gemma 4 E2B profile (3.35 GB), and `quality` uses E4B (5.15 GB). |
| `rgr chat "<question>" [--profile lite\|fast\|quality] [--thinking off\|standard\|deep] --offline` | Answer from retrieved Ragmir passages with a verified local model. Raw thought is never returned or persisted; `lite` always uses thinking `off`. |
| `rgr chat doctor [--profile lite\|fast\|quality] [--verify] --json` | Check runtime, expected manifest, file, and size. Add `--verify` for a full SHA-256 pass. |
| `rgr research "<topic>"` | Run audit, security, multi-query retrieval, source diagnostics, and lightweight code matching for broad agent tasks. |
| `rgr route-prompt "..."` | Classify a prompt and suggest whether an agent should use Ragmir local context. |
| `rgr evaluate --golden golden-queries.json` | Measure hit rate, Recall@K, Precision@K, MRR, nDCG, and p50/p95 latency against expected paths or citations. |
| `rgr security-audit` | Inspect privacy posture: telemetry, providers, redaction, actual Git ignore semantics, permissions, and MCP. |
| `rgr usage-report` | Summarize metadata-only local access-log activity for recent private dogfooding without query text or local paths. |
| `rgr status` | Print raw config paths, provider settings, and indexed chunk count. |

## Agent Integration

| Command | Use it when |
| --- | --- |
| `rgr install-skill` | Copy portable agent skills and an MCP config snippet into `.ragmir/`. |
| `rgr install-agent --agents <list>` | Expose Ragmir skills in native Claude, Codex, Kimi, OpenCode, or Cline discovery folders. |
| `rgr skill-path` | Print the package-bundled skill path for agents that load installed package skills. |
| `rgr serve-mcp` | Start the MCP stdio server for compatible agents. |

## Maintenance And Safety

| Command | Use it when |
| --- | --- |
| `rgr destroy-index --yes` | Delete generated `.ragmir/storage` index files. |
| `rgr security-audit --strict` | Fail the command when privacy warnings are present. |

## Local Chat

| Command | Use it when |
| --- | --- |
| `rgr chat setup` | Preload and verify the default `fast` Gemma 4 E2B profile. |
| `rgr chat setup --profile lite` | Preload and verify the 491 MB Qwen2.5 profile for older computers. |
| `rgr chat setup --profile quality` | Preload and verify the larger Gemma 4 E4B quality profile. |
| `rgr chat doctor --profile fast` | Run the normal runtime, manifest, file, and size readiness check. |
| `rgr chat doctor --profile fast --verify` | Recompute the full model SHA-256 after transfer or when integrity is in doubt. |
| `rgr chat "<question>" --profile fast --thinking standard --offline` | Generate a cited local answer with bounded hidden reasoning. |
| `rgr-chat setup --profile <lite\|fast\|quality>` | Invoke setup directly through the standalone add-on when maintaining or testing that package. |
| `rgr-chat doctor --profile <lite\|fast\|quality> [--verify] --json` | Inspect the standalone package directly. |
| `rgr-chat serve` | Start the persistent strict stdio JSONL transport used internally by the desktop app. This is not a user chat workflow. |

Chat doctor JSON includes the detected `platform` and `arch`, the packaged `supportedBackends`, the
`selectedBackend` used by `gpu: "auto"`, and whether hardware acceleration is active. On Apple
Silicon this should normally report Metal; supported Linux/Windows installations may report CUDA or
Vulkan. Normal answers do not build or download a missing backend.

The `rgr chat` commands are the supported user workflow and import the package API for one-shot
answers. `rgr-chat serve` accepts persistent protocol requests on stdin and writes protocol events to
stdout for desktop integration; wrappers must not mix logs with stdout. The transport does not
expose raw thought text.

## Audio

| Command | Use it when |
| --- | --- |
| `rgr audio --doctor` | Check TTS runtime readiness. |
| `rgr audio /tmp/preload.txt --engine transformers --allow-remote-models --model-path .ragmir/models/tts --out .ragmir/audio/preload-check.wav` | Preload the TTS model with non-sensitive text. |
| `rgr audio <file> --engine transformers --offline --out .ragmir/audio/name.wav` | Render a confidential/offline WAV. |
| `rgr audio <file> --engine edge --out .ragmir/audio/name.mp3` | Render a higher-quality online Edge MP3. |
| `rgr-tts doctor --json` | Inspect the standalone TTS package. |
| `rgr-tts render <file> --offline --out .ragmir/audio/name.wav` | Render directly through the TTS package. |

## Important Options

| Option | Applies to | Meaning |
| --- | --- | --- |
| `--project-root <path>` | all project-scoped `rgr` commands | Run against a specific local workspace instead of the current directory. |
| `--agents <list>` | `setup`, `install-skill`, `install-agent` | Select agent helpers or native skill folders: `all`, `claude`, `codex`, `kimi`, `opencode`, `cline`, or a comma-separated list. |
| `--mcp-name <name>` | `setup`, `install-skill` | Set the MCP server name used in generated helper files. |
| `--mcp-command <command>` | `setup`, `install-skill` | Use a repository wrapper or custom executable as the generated MCP stdio command. |
| `--mcp-arg <arg>` | `setup`, `install-skill` | Add one argument to `--mcp-command`; repeat for multiple arguments. Use `--mcp-arg=--flag` for dash-prefixed values. |
| `--semantic` | `setup` | Explicitly download the configured Transformers.js embedding model once, enable `embeddingProvider: "transformers"`, and keep remote model loading disabled for normal indexing. |
| `--engine <auto\|ocrmypdf\|tesseract>` | `ocr setup` | Select a detected local PDF OCR engine. `auto` prefers OCRmyPDF 12.6+, then Tesseract plus Poppler. |
| `--language <codes>` | `ocr setup` | Select installed Tesseract language packs such as `eng`, `fra`, or `eng+fra`. Default `eng`. |
| `--timeout-ms <number>` | `ocr setup` | Set the per-page OCR timeout written to `.ragmir/config.json`. |
| `--profile <lite\|fast\|quality>` | `chat`, chat setup/doctor, standalone chat setup/doctor | Select Qwen2.5 0.5B `lite` (491 MB), Gemma 4 E2B `fast` (default, 3.35 GB), or Gemma 4 E4B `quality` (5.15 GB). |
| `--thinking <off\|standard\|deep>` | `chat` | Select no, normal bounded, or larger bounded local reasoning. `lite` normalizes every value to `off`. Raw thought is never displayed, stored, or logged. |
| `--verify` | `chat doctor`, standalone chat doctor | Recompute the full GGUF SHA-256 and expose `modelHashValid`; use after transfer or when integrity is in doubt. |
| `--model-path <path>` | chat setup, doctor, and answers | Override the local chat model root. Each selected profile still requires its verified manifest and GGUF. |
| `--top-k <number>` | `search`, `ask`, `chat`, `research`, `evaluate` | Number of passages to return or keep. |
| `--context-radius <number>` | `search`, `ask` | Include neighboring chunks around each matched passage. MCP clamps this to 3 chunks on each side. |
| `--include-path <prefix>` | `search`, `ask`, `research` | Restrict retrieval to an exact project-relative path or directory prefix. Repeat for multiple roots. |
| `--exclude-path <prefix>` | `search`, `ask`, `research` | Remove an exact project-relative path or directory prefix before ranking. Repeat for multiple roots. |
| `--fail-under <recall>` | `evaluate` | Exit non-zero when mean Recall@K is below a threshold from `0` to `1`; without this option evaluation remains strict and fails on any miss. |
| `--days <number>` | `usage-report` | Number of recent days to include in the metadata-only usage summary. |
| `--json` | `setup`, `doctor`, `ocr doctor`, `ocr setup`, `ingest`, `search`, `ask`, `chat`, `research`, `route-prompt`, `evaluate`, `audit`, `limits`, `usage-report`, `status`, `security-audit`, `audio --doctor`, `rgr-chat doctor`, `rgr-tts doctor` | Print machine-readable JSON. |
| `--compact` | `search`, `research` | Return short snippets instead of full retrieved passages. |
| `--no-code` | `research` | Skip the lightweight repository code scan. |
| `--unsupported` | `audit` | List skipped file paths and reasons. |
| `--strict` | `security-audit` | Exit non-zero when warnings exist. |
| `--offline` | `chat`, `audio`, `rgr-tts render` | For chat, require the verified local GGUF. For audio, force the local Transformers.js path. |
| `--allow-remote-models` | `audio`, `rgr-tts render` | Explicitly allow a Transformers.js TTS model download. Chat downloads occur only through explicit `chat setup`. |
| `--engine edge` | `audio`, `rgr-tts render` | Use online Edge TTS for MP3 output. |
| `--lang <en\|es\|fr\|ja\|th\|zh>` | `audio`, `rgr-tts render` | Select the TTS language. `en`, `es`, and `fr` have default offline models; `ja`, `th`, and `zh` use Edge voices unless `--model` supplies a compatible offline model. Default `fr`. |

See [`offline-chat-preload.md`](./offline-chat-preload.md) and
[`offline-tts-preload.md`](./offline-tts-preload.md) before using `--offline` on a fully air-gapped
machine.

`evaluate` without `--fail-under` is observational and returns success even when some expected
passages are missed. Add `--fail-under <recall>` only when the command should act as a CI or private
dogfooding quality gate.

Duplicate diagnostics use matching SHA-256 content, not filenames. In a Git checkout,
`security-audit` asks Git whether configured generated paths are ignored, so glob rules, ancestor
rules, negations, and tracked-file behavior are respected. Outside Git it uses a conservative local
pattern fallback.

`rgr setup` ends with an English prompt between copy markers. Paste it into an AI assistant or local
chat to ask for repository-specific `sources` recommendations while excluding secrets, generated
files, dependency folders, caches, and unnecessary locale noise.

## External Text Extraction Configuration

OCR and legacy binary extraction remain opt-in. For scanned or image-only PDFs, start with the
local readiness check and setup command:

```bash
rgr ocr doctor
rgr ocr setup --language eng+fra
rgr ingest
```

Setup detects OCRmyPDF 12.6 or newer first, then Tesseract plus Poppler. It writes a page-aware
`pdfOcrCommand` that calls the installed project version of `rgr`; it does not install system tools,
download language packs, or call a cloud OCR service. The selected language packs must already be
reported by `tesseract --list-langs`.

For a custom local extractor, configure a wrapper that prints OCR text to stdout instead:

```json
{
  "pdfOcrCommand": ["my-pdf-ocr", "{input}", "{page}"],
  "pdfOcrTimeoutMs": 120000
}
```

You can also set `RAGMIR_PDF_OCR_COMMAND` to a JSON array. Ragmir invokes it only for pages where embedded-text
extraction returns no text. PDF wrappers also receive `RAGMIR_PDF_PAGE` and may use `{page}` in an
argument. When a supported document still yields no indexable text,
`rgr ingest --json` reports the relative paths under `emptyTextFiles`.

Standalone image files such as `.png`, `.jpg`, `.heic`, and `.tiff` are skipped by default. To index
them directly, configure an explicit local image OCR wrapper:

```json
{
  "imageOcrCommand": ["ragmir-image-ocr", "{input}"],
  "imageOcrTimeoutMs": 120000
}
```

Or set `RAGMIR_IMAGE_OCR_COMMAND` to a JSON array. Image files become supported only when this command
is configured. OCR commands are executed from the target project root without a shell and with a
minimal environment allowlist. They receive `RAGMIR_PDF_PATH` or `RAGMIR_IMAGE_PATH`, replace
`{input}` placeholders with the source path, and must print UTF-8 text to stdout. The `strict`
privacy profile disables external extractors. Keep OCR tooling local for confidential documents. `rgr audit
--unsupported` prints
per-file recommendations for image, audio, video, oversized, and secret-like skipped files.

Old `.doc` Word binaries are skipped by default. To index them directly, configure a local legacy
Word text extractor:

```json
{
  "legacyWordCommand": ["ragmir-doc-text", "{input}"],
  "legacyWordTimeoutMs": 120000
}
```

Or set `RAGMIR_LEGACY_WORD_COMMAND` to a JSON array. `.doc` files become supported only when this
command is configured. The command runs from the target project root without a shell, receives
`RAGMIR_LEGACY_WORD_PATH`, may use `{input}` for the source path, and must print UTF-8 text to
stdout. Prefer local extraction or conversion for confidential documents.

## Prompt Routing

`rgr route-prompt` is the opt-in router for agent hooks and wrappers that want to decide when a
prompt needs local Ragmir evidence:

```bash
echo "Audit this repository release plan from cited evidence" | rgr route-prompt --json
```

The router is deterministic and local. It does not store prompt text, call an LLM, read the vector
index, or run retrieval. It returns `shouldUseRagmir`, `confidence`, the suggested `tool`, a `query`
only when Ragmir should be used, matched routing signals, and privacy safeguards. Agents can then
call `ragmir_search`, `ragmir_ask`, or `ragmir_research` over MCP.

`rgr search` and `rgr ask` sanitize unusually long agent prompts before embedding them, so accidental
system/developer context is not treated as the retrieval query. Search results include line-aware
citations such as `docs/policy.md:L4-L8#2` after a schema v2 rebuild.

## Retrieval Evaluation Gates

`rgr evaluate` expects a JSON golden query file with queries and expected relative source paths.
Use `expectedPaths` for file-level `recall@k`, and add `expectedCitations` when the benchmark must
verify exact `relative/path:Lx-Ly#chunkIndex` citations. Older indexes without line metadata fall back
to `relative/path#chunkIndex` until they are rebuilt. When citations are present, a query only counts
as a hit if the expected citation is retrieved. A query may also set `includePaths` and
`excludePaths` to benchmark a specific evidence tier:

```json
{
  "queries": [
    {
      "query": "Which primary source supports the finding?",
      "expectedPaths": [".ragmir/raw/primary/report.pdf"],
      "includePaths": [".ragmir/raw/primary"],
      "excludePaths": [".ragmir/raw/research"]
    }
  ]
}
```

Use the default strict behavior for synthetic examples and release checks:

```bash
rgr evaluate --golden golden-queries.json
```

For private dogfooding, keep the real corpus and golden query file outside Git or under an ignored
local path, then choose an explicit recall threshold:

```bash
rgr --project-root /path/to/workspace evaluate --golden .ragmir/evaluations/golden-queries.json --fail-under 0.8 --json
```

The JSON output includes `embeddingProvider` and `embeddingModel`. Use those fields when comparing a
default local-hash run with a private Transformers semantic run. Per-case and aggregate output
separates hit rate, true Recall@K, Precision@K, `meanReciprocalRank`, bounded `ndcg`, and p50/p95
latency so regressions can distinguish incomplete, late, and slow retrieval.

`rgr usage-report` keeps the legacy overall result-count average and also reports
`averageResultCountByAction`, so ingest chunk counts no longer obscure search, ask, research, and
evaluation behavior.

Fresh setup and docs use a single `.ragmir/` project folder.
