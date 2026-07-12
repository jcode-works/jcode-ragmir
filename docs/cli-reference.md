# CLI reference

Use `rgr` in the repository that owns the knowledge base. `rgr --help` and `rgr <command> --help`
are the source of truth for option details.

## First use

```bash
rgr setup
rgr ingest
rgr search "release decision"
```

| Command | Purpose |
| --- | --- |
| `setup [--semantic]` | Initialize `.ragmir/`, agent helpers, and optionally preload embeddings. |
| `init` | Create basic local configuration only. |
| `doctor [--fix]` | Check setup, index freshness, and safe repairs. |
| `ingest [--rebuild]` | Index configured sources; rebuild after provider or chunking changes. |
| `search <query>` | Return ranked cited passages. |
| `ask <query>` | Return cited context without model synthesis. |
| `research <query>` | Run an audit-backed multi-query retrieval pass. |
| `audit [--unsupported]` | Compare sources with the index and list skipped files. |
| `status` | Show configuration and indexed chunk count. |
| `security-audit [--strict]` | Check local privacy and Git-ignore posture. |

## Sources and retrieval

```bash
rgr sources add "docs/**/*.md" "!docs/archive/**"
rgr sources list
rgr search "migration" --top-k 5 --context-radius 1
rgr search "migration" --include-path docs --exclude-path docs/archive
```

`sources add` accepts paths, globs, and `!` exclusions. Search, ask, and research accept `--top-k`,
`--include-path`, and `--exclude-path`. Use `--compact` on search or research when agent context is
limited.

## Optional local features

```bash
rgr models pull --enable
rgr ocr doctor
rgr ocr setup --language eng+fra
rgr chat setup --profile fast
rgr audio ./brief.md --offline --out .ragmir/audio/brief.wav
```

| Command | Purpose |
| --- | --- |
| `models pull [--enable]` | Preload the configured embedding model and optionally enable semantic retrieval. |
| `ocr doctor` / `ocr setup` | Detect and configure local page-aware PDF OCR. |
| `chat setup|doctor|<question>` | Prepare, inspect, or use the optional local chat add-on. |
| `audio <file>` | Render text with the optional TTS add-on. |

OCR runs only for PDF pages without embedded text. The strict privacy profile disables external
extractors. Normal chat and offline audio rendering do not download models.

## Agents, maintenance, and JSON

```bash
rgr install-agent --agents codex,claude
rgr serve-mcp
rgr evaluate --golden .ragmir/golden.json --fail-under 0.8
rgr usage-report --days 30
rgr destroy-index --yes
```

- `install-skill` and `install-agent` install the bundled project helpers.
- `serve-mcp` starts the local stdio MCP server.
- `route-prompt` classifies whether a prompt should use Ragmir without storing it.
- `evaluate` measures retrieval against a local golden-query file.
- `usage-report`, `limits`, and `destroy-index` expose local operations.
- Add `--json` to machine-readable commands. Do not parse human-readable output in automation.
