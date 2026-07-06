# CLI Reference

Ragmir ships three CLIs:

- `rgr`: the main local RAG, MCP, skills, security, and audio command.
- `rgr-chat`: the standalone optional local chat add-on used by `rgr chat`.
- `rgr-tts`: the standalone text-to-speech renderer used by `rgr audio`.

## Main Workflow

| Command | Use it when |
| --- | --- |
| `rgr setup` | Initialize Ragmir, install the agent kit, run doctor, and ingest when safe. |
| `rgr setup --semantic` | Run first setup and explicitly download the configured Transformers.js embedding model for higher-quality semantic retrieval. |
| `rgr init` | Create `.ragmir/config.json` (with a `sources` array), `.ragmir/raw/`, and Git ignore rules. |
| `rgr doctor` | Diagnose setup, index freshness, security warnings, and the next command to run. |
| `rgr doctor --fix` | Create missing scaffolding, install skills/MCP config, and update stale indexes when safe. |
| `rgr models pull` | Download the configured Transformers.js embedding model into `embeddingModelPath`. |
| `rgr models pull --enable` | Download the embedding model and switch Ragmir config to safe Transformers embeddings. |
| `rgr sources add "../apps/*/docs/**/*.md"` | Add source paths, glob patterns, or `!` exclusions to the `sources` array in `.ragmir/config.json`. |
| `rgr sources list` | List active extra source entries from `.ragmir/config.json`. |
| `rgr ingest` | Parse changed source files, redact, chunk, embed, and update the local LanceDB index. |
| `rgr ingest --rebuild` | Force a full re-index, required after switching embedding provider or model. |
| `rgr audit` | Check whether supported source files are missing from or stale in the index. |
| `rgr audit --unsupported` | List files skipped because they are unsupported, too large, or secret-like. |
| `rgr search "<query>"` | Retrieve ranked passages without asking an LLM to write an answer. |
| `rgr ask "<question>"` | Return cited retrieval context for an agent or trusted model runtime. |
| `rgr chat setup` | Download the optional local Transformers.js chat model into `.ragmir/models/chat`. |
| `rgr chat "<question>" --offline` | Answer from retrieved Ragmir passages with the local chat add-on. |
| `rgr chat doctor --json` | Inspect optional local chat readiness without generating an answer. |
| `rgr research "<topic>"` | Run audit, security, multi-query retrieval, source diagnostics, and lightweight code matching for broad agent tasks. |
| `rgr route-prompt "..."` | Classify a prompt and suggest whether an agent should use Ragmir local context. |
| `rgr evaluate --golden golden-queries.json` | Measure retrieval recall against expected source paths. |
| `rgr security-audit` | Inspect privacy posture: telemetry, providers, redaction, Git ignore, MCP. |
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

## Audio

| Command | Use it when |
| --- | --- |
| `rgr audio --doctor` | Check TTS runtime readiness. |
| `rgr audio /tmp/preload.txt --engine transformers --allow-remote-models --model-path .ragmir/models/tts --out .ragmir/audio/preload-check.wav` | Preload the TTS model with non-sensitive text. |
| `rgr audio <file> --engine transformers --offline --out .ragmir/audio/name.wav` | Render a confidential/offline WAV. |
| `rgr audio <file> --engine edge --out .ragmir/audio/name.mp3` | Render a higher-quality online Edge MP3. |
| `rgr-chat doctor --json` | Inspect the standalone chat package. |
| `rgr-chat setup --model-path .ragmir/models/chat` | Preload a Transformers.js chat model directly through the add-on. |
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
| `--top-k <number>` | `search`, `ask`, `chat`, `research`, `evaluate` | Number of passages to return or keep. |
| `--fail-under <recall>` | `evaluate` | Exit non-zero only when recall is below a threshold from `0` to `1`; without this option evaluation remains strict and fails on any miss. |
| `--days <number>` | `usage-report` | Number of recent days to include in the metadata-only usage summary. |
| `--json` | `doctor`, `ingest`, `search`, `ask`, `chat`, `research`, `route-prompt`, `evaluate`, `audit`, `usage-report`, `status`, `security-audit`, `audio --doctor`, `rgr-chat doctor`, `rgr-tts doctor` | Print machine-readable JSON. |
| `--compact` | `search`, `research` | Return short snippets instead of full retrieved passages. |
| `--no-code` | `research` | Skip the lightweight repository code scan. |
| `--unsupported` | `audit` | List skipped file paths and reasons. |
| `--strict` | `security-audit` | Exit non-zero when warnings exist. |
| `--offline` | `chat`, `audio`, `rgr-chat answer`, `rgr-tts render` | Disable remote model downloads and force the local Transformers.js path. |
| `--allow-remote-models` | `chat`, `audio`, `rgr-chat answer`, `rgr-tts render` | Explicitly allow model downloads for Transformers.js. |
| `--engine edge` | `audio`, `rgr-tts render` | Use online Edge TTS for MP3 output. |
| `--lang <en\|es\|fr>` | `audio`, `rgr-tts render` | Select the TTS language; picks the offline model and Edge voice. Default `fr`. |

See [`offline-chat-preload.md`](./offline-chat-preload.md) and
[`offline-tts-preload.md`](./offline-tts-preload.md) before using `--offline` on a fully air-gapped
machine.

## External Text Extraction Configuration

OCR and legacy binary extraction are intentionally configuration-based rather than default CLI flags.
For scanned/image-only PDFs, add a local wrapper that prints OCR text to stdout:

```json
{
  "pdfOcrCommand": ["ragmir-pdf-ocr", "{input}"],
  "pdfOcrTimeoutMs": 120000
}
```

Or set `RAGMIR_PDF_OCR_COMMAND` to a JSON array. Ragmir only invokes it for PDFs where embedded-text
extraction returns no text. When a supported document still yields no indexable text,
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
is configured. OCR commands are executed from the target project root without a shell, receive
`RAGMIR_PDF_PATH` or `RAGMIR_IMAGE_PATH`, replace `{input}` placeholders with the source path, and
must print UTF-8 text to stdout. Keep OCR tooling local for confidential documents. `rgr audit
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

## Retrieval Evaluation Gates

`rgr evaluate` expects a JSON golden query file with queries and expected relative source paths.
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
default local-hash run with a private Transformers semantic run.

Fresh setup and docs use a single `.ragmir/` project folder.
