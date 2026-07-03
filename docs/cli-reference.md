# CLI Reference

Ragmir ships two CLIs:

- `ragmir`: the main local RAG, MCP, skills, security, and audio command. `kb` remains a legacy alias.
- `ragmir-tts`: the standalone text-to-speech renderer used by `ragmir audio`.

## Main Workflow

| Command | Use it when |
| --- | --- |
| `ragmir setup` | Initialize Ragmir, install the agent kit, run doctor, and ingest when safe. |
| `ragmir setup --semantic` | Run first setup and explicitly download the configured Transformers.js embedding model for higher-quality semantic retrieval. |
| `ragmir init` | Create `.ragmir/config.json` (with a `sources` array), `.ragmir/raw/`, and Git ignore rules. |
| `ragmir doctor` | Diagnose setup, index freshness, security warnings, and the next command to run. |
| `ragmir doctor --fix` | Create missing scaffolding, install skills/MCP config, and update stale indexes when safe. |
| `ragmir models pull` | Download the configured Transformers.js embedding model into `embeddingModelPath`. |
| `ragmir models pull --enable` | Download the embedding model and switch Ragmir config to safe Transformers embeddings. |
| `ragmir sources add "../apps/*/docs/**/*.md"` | Add source paths, glob patterns, or `!` exclusions to the `sources` array in `.ragmir/config.json`. |
| `ragmir sources list` | List active extra source entries (merged from `config.json` and any legacy `sources.txt`). |
| `ragmir ingest` | Parse changed source files, redact, chunk, embed, and update the local LanceDB index. |
| `ragmir ingest --rebuild` | Force a full re-index, required after switching embedding provider or model. |
| `ragmir audit` | Check whether supported source files are missing from or stale in the index. |
| `ragmir audit --unsupported` | List files skipped because they are unsupported, too large, or secret-like. |
| `ragmir search "<query>"` | Retrieve ranked passages without asking an LLM to write an answer. |
| `ragmir ask "<question>"` | Return cited retrieval context for an agent or trusted model runtime. |
| `ragmir research "<topic>"` | Run audit, security, multi-query retrieval, source diagnostics, and lightweight code matching for broad agent tasks. |
| `ragmir evaluate --golden golden-queries.json` | Measure retrieval recall against expected source paths. |
| `ragmir security-audit` | Inspect privacy posture: telemetry, providers, redaction, Git ignore, MCP. |
| `ragmir usage-report` | Summarize metadata-only local access-log activity for recent private dogfooding without query text or local paths. |
| `ragmir status` | Print raw config paths, provider settings, and indexed chunk count. |

## Agent Integration

| Command | Use it when |
| --- | --- |
| `ragmir install-skill` | Copy portable agent skills and an MCP config snippet into `.ragmir/`. |
| `ragmir install-agent --agents <list>` | Expose Ragmir skills in native Claude, Codex, Kimi, OpenCode, or Cline discovery folders. |
| `ragmir skill-path` | Print the package-bundled skill path for agents that load installed package skills. |
| `ragmir serve-mcp` | Start the MCP stdio server for compatible agents. |

## Maintenance And Safety

| Command | Use it when |
| --- | --- |
| `ragmir destroy-index --yes` | Delete generated `.ragmir/storage` index files. |
| `ragmir security-audit --strict` | Fail the command when privacy warnings are present. |

## Audio

| Command | Use it when |
| --- | --- |
| `ragmir audio --doctor` | Check TTS runtime readiness. |
| `ragmir audio /tmp/preload.txt --engine transformers --allow-remote-models --model-path .ragmir/models/tts --out .ragmir/audio/preload-check.wav` | Preload the TTS model with non-sensitive text. |
| `ragmir audio <file> --engine transformers --offline --out .ragmir/audio/name.wav` | Render a confidential/offline WAV. |
| `ragmir audio <file> --engine edge --out .ragmir/audio/name.mp3` | Render a higher-quality online Edge MP3. |
| `ragmir-tts doctor --json` | Inspect the standalone TTS package. |
| `ragmir-tts render <file> --offline --out .ragmir/audio/name.wav` | Render directly through the TTS package. |

## Important Options

| Option | Applies to | Meaning |
| --- | --- | --- |
| `--project-root <path>` | all project-scoped `ragmir` commands | Run against a specific local workspace instead of the current directory. |
| `--agents <list>` | `setup`, `install-skill`, `install-agent` | Select agent helpers or native skill folders: `all`, `claude`, `codex`, `kimi`, `opencode`, `cline`, or a comma-separated list. |
| `--mcp-name <name>` | `setup`, `install-skill` | Set the MCP server name used in generated helper files. |
| `--mcp-command <command>` | `setup`, `install-skill` | Use a repository wrapper or custom executable as the generated MCP stdio command. |
| `--mcp-arg <arg>` | `setup`, `install-skill` | Add one argument to `--mcp-command`; repeat for multiple arguments. Use `--mcp-arg=--flag` for dash-prefixed values. |
| `--semantic` | `setup` | Explicitly download the configured Transformers.js embedding model once, enable `embeddingProvider: "transformers"`, and keep remote model loading disabled for normal indexing. |
| `--top-k <number>` | `search`, `ask`, `research`, `evaluate` | Number of passages to return or keep. |
| `--fail-under <recall>` | `evaluate` | Exit non-zero only when recall is below a threshold from `0` to `1`; without this option evaluation remains strict and fails on any miss. |
| `--days <number>` | `usage-report` | Number of recent days to include in the metadata-only usage summary. |
| `--json` | `doctor`, `ingest`, `search`, `ask`, `research`, `evaluate`, `audit`, `usage-report`, `status`, `security-audit`, `audio --doctor`, `ragmir-tts doctor` | Print machine-readable JSON. |
| `--compact` | `search`, `research` | Return short snippets instead of full retrieved passages. |
| `--no-code` | `research` | Skip the lightweight repository code scan. |
| `--unsupported` | `audit` | List skipped file paths and reasons. |
| `--strict` | `security-audit` | Exit non-zero when warnings exist. |
| `--offline` | `audio`, `ragmir-tts render` | Disable remote model downloads and force the local Transformers.js path. |
| `--allow-remote-models` | `audio`, `ragmir-tts render` | Explicitly allow model downloads for Transformers.js. |
| `--engine edge` | `audio`, `ragmir-tts render` | Use online Edge TTS for MP3 output. |
| `--lang <en\|es\|fr>` | `audio`, `ragmir-tts render` | Select the TTS language; picks the offline model and Edge voice. Default `fr`. |

See [`offline-tts-preload.md`](./offline-tts-preload.md) before using `--offline` on a fully
air-gapped machine.

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
`ragmir ingest --json` reports the relative paths under `emptyTextFiles`.

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
must print UTF-8 text to stdout. Keep OCR tooling local for confidential documents. `ragmir audit
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

## Retrieval Evaluation Gates

`ragmir evaluate` expects a JSON golden query file with queries and expected relative source paths.
Use the default strict behavior for synthetic examples and release checks:

```bash
ragmir evaluate --golden golden-queries.json
```

For private dogfooding, keep the real corpus and golden query file outside Git or under an ignored
local path, then choose an explicit recall threshold:

```bash
ragmir --project-root /path/to/workspace evaluate --golden .ragmir/evaluations/golden-queries.json --fail-under 0.8 --json
```

The JSON output includes `embeddingProvider` and `embeddingModel`. Use those fields when comparing a
default local-hash run with a private Transformers semantic run.

Legacy projects can still use `.kb/config.json`, `.kb/storage`, and `KB_*` environment aliases.
Fresh setup and docs use a single `.ragmir/` project folder.
