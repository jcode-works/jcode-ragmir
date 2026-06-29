# CLI Reference

Mimir ships two CLIs:

- `kb`: the main local RAG, MCP, skills, security, and audio command.
- `mimir-tts`: the standalone text-to-speech renderer used by `kb audio`.

## Main Workflow

| Command | Use it when |
| --- | --- |
| `kb setup` | Initialize Mimir, install the agent kit, run doctor, and ingest when safe. |
| `kb init` | Create `.kb/config.json`, `.kb/sources.txt`, `private/`, and Git ignore rules. |
| `kb doctor` | Diagnose setup, index freshness, security warnings, and the next command to run. |
| `kb doctor --fix` | Create missing scaffolding, install skills/MCP config, and update stale indexes when safe. |
| `kb models pull` | Download the configured Transformers.js embedding model into `embeddingModelPath`. |
| `kb ingest` | Parse changed source files, redact, chunk, embed, and update the local LanceDB index. |
| `kb ingest --rebuild` | Force a full re-index, required after switching embedding provider or model. |
| `kb audit` | Check whether supported source files are missing from or stale in the index. |
| `kb audit --unsupported` | List files skipped because they are unsupported, too large, or secret-like. |
| `kb search "<query>"` | Retrieve ranked passages without asking an LLM to write an answer. |
| `kb ask "<question>"` | Return cited retrieval context for an agent or trusted model runtime. |
| `kb security-audit` | Inspect privacy posture: telemetry, providers, redaction, Git ignore, MCP. |
| `kb status` | Print raw config paths, provider settings, and indexed chunk count. |

## Agent Integration

| Command | Use it when |
| --- | --- |
| `kb install-skill` | Copy portable agent skills and an MCP config snippet into `.mimir/`. |
| `kb skill-path` | Print the package-bundled skill path for agents that load installed package skills. |
| `kb serve-mcp` | Start the MCP stdio server for compatible agents. |

## Maintenance And Safety

| Command | Use it when |
| --- | --- |
| `kb destroy-index --yes` | Delete generated `.kb/storage` index files. |
| `kb security-audit --strict` | Fail the command when privacy warnings are present. |

## Audio

| Command | Use it when |
| --- | --- |
| `kb audio --doctor` | Check TTS runtime readiness. |
| `kb audio <file> --engine transformers --offline --out .mimir/audio/name.wav` | Render a confidential/offline WAV. |
| `kb audio <file> --engine edge --out .mimir/audio/name.mp3` | Render a higher-quality online Edge MP3. |
| `mimir-tts doctor --json` | Inspect the standalone TTS package. |
| `mimir-tts render <file> --offline --out .mimir/audio/name.wav` | Render directly through the TTS package. |

## Important Options

| Option | Applies to | Meaning |
| --- | --- | --- |
| `--top-k <number>` | `search`, `ask` | Number of passages to return. |
| `--json` | `doctor`, `ingest`, `search`, `ask`, `audit`, `status`, `security-audit`, `audio --doctor`, `mimir-tts doctor` | Print machine-readable JSON. |
| `--unsupported` | `audit` | List skipped file paths and reasons. |
| `--strict` | `security-audit` | Exit non-zero when warnings exist. |
| `--offline` | `audio`, `mimir-tts render` | Disable remote model downloads and force the local Transformers.js path. |
| `--allow-remote-models` | `audio`, `mimir-tts render` | Explicitly allow model downloads for Transformers.js. |
| `--engine edge` | `audio`, `mimir-tts render` | Use online Edge TTS for MP3 output. |
