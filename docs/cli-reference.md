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
| `mimir ingest` | Parse changed source files, redact, chunk, embed, and update the local LanceDB index. |
| `mimir ingest --rebuild` | Force a full re-index, required after switching embedding provider or model. |
| `mimir audit` | Check whether supported source files are missing from or stale in the index. |
| `mimir audit --unsupported` | List files skipped because they are unsupported, too large, or secret-like. |
| `mimir search "<query>"` | Retrieve ranked passages without asking an LLM to write an answer. |
| `mimir ask "<question>"` | Return cited retrieval context for an agent or trusted model runtime. |
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
| `mimir audio <file> --engine transformers --offline --out .mimir/audio/name.wav` | Render a confidential/offline WAV. |
| `mimir audio <file> --engine edge --out .mimir/audio/name.mp3` | Render a higher-quality online Edge MP3. |
| `mimir-tts doctor --json` | Inspect the standalone TTS package. |
| `mimir-tts render <file> --offline --out .mimir/audio/name.wav` | Render directly through the TTS package. |

## Important Options

| Option | Applies to | Meaning |
| --- | --- | --- |
| `--project-root <path>` | all project-scoped `mimir` commands | Run against a specific local workspace instead of the current directory. |
| `--top-k <number>` | `search`, `ask` | Number of passages to return. |
| `--json` | `doctor`, `ingest`, `search`, `ask`, `audit`, `status`, `security-audit`, `audio --doctor`, `mimir-tts doctor` | Print machine-readable JSON. |
| `--unsupported` | `audit` | List skipped file paths and reasons. |
| `--strict` | `security-audit` | Exit non-zero when warnings exist. |
| `--offline` | `audio`, `mimir-tts render` | Disable remote model downloads and force the local Transformers.js path. |
| `--allow-remote-models` | `audio`, `mimir-tts render` | Explicitly allow model downloads for Transformers.js. |
| `--engine edge` | `audio`, `mimir-tts render` | Use online Edge TTS for MP3 output. |
