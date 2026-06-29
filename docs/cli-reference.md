# CLI Reference

Mimir ships two CLIs:

- `mimir`: the main local RAG, MCP, skills, security, and audio command. `kb` remains a legacy alias.
- `mimir-tts`: the standalone text-to-speech renderer used by `mimir audio`.

## Main Workflow

| Command | Use it when |
| --- | --- |
| `mimir setup` | Initialize Mimir, install the agent kit, run doctor, and ingest when safe. |
| `mimir init` | Create `.kb/config.json`, `.kb/sources.txt`, `private/`, and Git ignore rules. |
| `mimir doctor` | Diagnose setup, index freshness, security warnings, and the next command to run. |
| `mimir doctor --fix` | Create missing scaffolding, install skills/MCP config, and update stale indexes when safe. |
| `mimir models pull` | Download the configured Transformers.js embedding model into `embeddingModelPath`. |
| `mimir models pull --enable` | Download the embedding model and switch `.kb/config.json` to safe Transformers embeddings. |
| `mimir ingest` | Parse changed source files, redact, chunk, embed, and update the local LanceDB index. |
| `mimir ingest --rebuild` | Force a full re-index, required after switching embedding provider or model. |
| `mimir audit` | Check whether supported source files are missing from or stale in the index. |
| `mimir audit --unsupported` | List files skipped because they are unsupported, too large, or secret-like. |
| `mimir search "<query>"` | Retrieve ranked passages without asking an LLM to write an answer. |
| `mimir ask "<question>"` | Return cited retrieval context for an agent or trusted model runtime. |
| `mimir evaluate --golden golden-queries.json` | Measure retrieval recall against expected source paths. |
| `mimir security-audit` | Inspect privacy posture: telemetry, providers, redaction, Git ignore, MCP. |
| `mimir status` | Print raw config paths, provider settings, and indexed chunk count. |

## Agent Integration

| Command | Use it when |
| --- | --- |
| `mimir install-skill` | Copy portable agent skills and an MCP config snippet into `.mimir/`. |
| `mimir skill-path` | Print the package-bundled skill path for agents that load installed package skills. |
| `mimir serve-mcp` | Start the MCP stdio server for compatible agents. |

## Maintenance And Safety

| Command | Use it when |
| --- | --- |
| `mimir destroy-index --yes` | Delete generated `.kb/storage` index files. |
| `mimir security-audit --strict` | Fail the command when privacy warnings are present. |

## Audio

| Command | Use it when |
| --- | --- |
| `mimir audio --doctor` | Check TTS runtime readiness. |
| `mimir audio /tmp/preload.txt --engine transformers --allow-remote-models --model-path .mimir/models/tts --out .mimir/audio/preload-check.wav` | Preload the TTS model with non-sensitive text. |
| `mimir audio <file> --engine transformers --offline --out .mimir/audio/name.wav` | Render a confidential/offline WAV. |
| `mimir audio <file> --engine edge --out .mimir/audio/name.mp3` | Render a higher-quality online Edge MP3. |
| `mimir-tts doctor --json` | Inspect the standalone TTS package. |
| `mimir-tts render <file> --offline --out .mimir/audio/name.wav` | Render directly through the TTS package. |

## Important Options

| Option | Applies to | Meaning |
| --- | --- | --- |
| `--project-root <path>` | all project-scoped `mimir` commands | Run against a specific local workspace instead of the current directory. |
| `--top-k <number>` | `search`, `ask`, `evaluate` | Number of passages to return. |
| `--fail-under <recall>` | `evaluate` | Exit non-zero only when recall is below a threshold from `0` to `1`; without this option evaluation remains strict and fails on any miss. |
| `--json` | `doctor`, `ingest`, `search`, `ask`, `evaluate`, `audit`, `status`, `security-audit`, `audio --doctor`, `mimir-tts doctor` | Print machine-readable JSON. |
| `--unsupported` | `audit` | List skipped file paths and reasons. |
| `--strict` | `security-audit` | Exit non-zero when warnings exist. |
| `--offline` | `audio`, `mimir-tts render` | Disable remote model downloads and force the local Transformers.js path. |
| `--allow-remote-models` | `audio`, `mimir-tts render` | Explicitly allow model downloads for Transformers.js. |
| `--engine edge` | `audio`, `mimir-tts render` | Use online Edge TTS for MP3 output. |

See [`offline-tts-preload.md`](./offline-tts-preload.md) before using `--offline` on a fully
air-gapped machine.

## OCR Configuration

PDF OCR is intentionally configuration-based rather than a default CLI flag. Add a local wrapper that
prints OCR text to stdout:

```json
{
  "pdfOcrCommand": ["mimir-pdf-ocr", "{input}"],
  "pdfOcrTimeoutMs": 120000
}
```

Or set `KB_PDF_OCR_COMMAND` to a JSON array. Mimir only invokes it for PDFs where embedded-text
extraction returns no text.

## Retrieval Evaluation Gates

`mimir evaluate` expects a JSON golden query file with queries and expected relative source paths.
Use the default strict behavior for synthetic examples and release checks:

```bash
mimir evaluate --golden golden-queries.json
```

For private dogfooding, keep the real corpus and golden query file outside Git or under an ignored
local path, then choose an explicit recall threshold:

```bash
mimir --project-root /path/to/workspace evaluate --golden private/golden-queries.json --fail-under 0.8 --json
```

The JSON output includes `embeddingProvider` and `embeddingModel`. Use those fields when comparing a
default local-hash run with a private Transformers semantic run.
