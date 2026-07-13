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
| `preview` | Parse, redact, and chunk selected sources without writing the index. |
| `ingest [--rebuild]` | Index configured sources; rebuild after provider or chunking changes. |
| `search <query>` | Return ranked cited passages. |
| `ask <query>` | Return cited context without model synthesis. |
| `research <query>` | Run an audit-backed multi-query retrieval pass. |
| `audit [--unsupported]` | Compare sources with the index and list skipped files. |
| `bases` | List root and nested monorepo bases and mark the active one. |
| `status` | Show configuration and indexed chunk count. |
| `security-audit [--strict]` | Check local privacy and Git-ignore posture. |

## Sources and retrieval

```bash
rgr sources add "docs/**/*.md" "!docs/archive/**"
rgr sources list
rgr preview --path docs --max-files 5 --max-chunks 3
rgr search "migration" --top-k 5 --context-radius 1
rgr search "migration" --include-path docs --exclude-path docs/archive
rgr search "migration" --context-path "Guide > Migration" --explain
```

`sources add` accepts paths, globs, and `!` exclusions. Search, ask, and research accept `--top-k`,
`--include-path`, `--exclude-path`, and repeatable `--context-path`. Search and ask accept
`--explain`; the optional score object reports RRF contributions, retriever ranks, raw backend
scores, and matched query terms without changing ranking. Use `--compact` on search or research when
agent context is limited.

`preview` uses the active redaction and chunking configuration but never writes storage. `audit`
reports min, mean, p50, p95, and max chunk sizes plus structural-context coverage.

## Monorepos

```bash
cd apps/web/src
rgr bases --json
rgr search "app-specific contract"
rgr --project-root /absolute/path/to/monorepo search "shared architecture"
```

Commands resolve the nearest configured ancestor. Use the root base for shared or cross-app
knowledge and an app base for app-specific evidence. `--project-root` overrides the working
directory deterministically. Root and nested bases use separate storage and never share index rows.

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

- `setup` installs canonical skills, native project links, a local runner, and selected MCP helpers.
- `install-skill` refreshes only the canonical kit; `install-agent` changes native scope or link mode.
- `install-agent --force` replaces a conflicting same-name skill only when explicitly requested.
- `serve-mcp` starts the local stdio MCP server.
- `route-prompt` classifies whether a prompt should use Ragmir without storing it.
- `evaluate` measures retrieval against a local golden-query file.
- `usage-report`, `limits`, and `destroy-index` expose local operations.
- Add `--json` to machine-readable commands. Do not parse human-readable output in automation.
