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
| `ingest [--rebuild] [--batch-size N] [--incremental-failure-policy POLICY]` | Index configured sources in resumable batches; rebuild after provider or chunking changes. |
| `search <query>` | Return ranked cited passages. |
| `ask <query>` | Return cited context without model synthesis. |
| `research <query>` | Run an audit-backed multi-query retrieval pass. |
| `audit [--unsupported]` | Compare sources with the index and list skipped files. |
| `bases` | List root and nested monorepo bases and mark the active one. |
| `status` | Show configuration, indexed chunk count, and the latest ingestion progress. |
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

## Resumable ingestion

```bash
rgr ingest
rgr status --json
rgr ingest --batch-size 10
```

The default file window contains up to 25 files, within stricter source-byte and estimated-chunk
budgets. After each file commit, Ragmir atomically records per-file state and the current manifest
under `.ragmir/storage/`. Starting `rgr ingest` again resumes a compatible
interrupted run and processes only pending, failed, or changed files. Files already committed to
the index are not parsed or embedded again.

Every inventory pass recalculates each file's SHA-256, so a content change is detected even when a
sync tool preserves both file size and modification time. A committed file atomically replaces that
changed source's chunks. Run `rgr limits` for the active 50-MB parse window, chunk, vector,
concurrency, embedding-batch and file-batch ceilings.

Maintainers can reproduce the 25-file, 50-MB-per-file memory gate with
`pnpm bench:ingest-memory -- --stress` from the repository root.

If a changed file fails during parsing, embedding, or its LanceDB write, incremental ingestion keeps
the previous rows searchable and records the current error, last-good checksum, and stale state.
Repairing the source replaces those rows once; deleting the source removes them. The default is
`--incremental-failure-policy preserve-last-good`. Select `remove-stale` explicitly when a failed
changed file must have no searchable rows.

`rgr status --json` exposes the run ID, mode, status, resume flag, last activity, batch size, chunk
count, and file counts for `pending`, `parsed`, `embedded`, `indexed`, and `error` states. The human
output shows the same progress in a compact form.

`rgr ingest --rebuild` writes batches into an isolated LanceDB generation. The existing index stays
active until the new table and manifest pass row-count, checksum, and duplicate-ID validation. The
final atomic manifest replacement activates the generation. Re-run the command after interruption
to resume the staged generation. Older generated tables remain available for searches that already
opened them; `rgr destroy-index` removes all generated index storage.

Ingestion, generation activation, quality-report persistence, and index destruction share one
private local writer lock. Concurrent readers remain available. Contention waits for a bounded
period and then returns retryable `INDEX_BUSY`; a dead owner is recovered from its PID and heartbeat.
The lock coordinates processes on one machine only, not hosts sharing a network filesystem.

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
printf '%s\n' "Non-sensitive model preload text." > /tmp/ragmir-tts-preload.txt
rgr audio /tmp/ragmir-tts-preload.txt --lang en --allow-remote-models --out .ragmir/audio/preload.wav
rgr audio ./brief.md --lang en --offline --out .ragmir/audio/brief.wav
```

Keep the same Chat profile across `setup`, `doctor`, and answers: `lite` is the ~0.49 GB Qwen option,
`fast` is the default ~3.35 GB Gemma option, and `quality` is the explicit ~5.15 GB Gemma option.
For offline TTS, keep the same `--lang` across preload and render: `en`, `fr`, and `es` select their
own local model automatically. Edge additionally supports `ja`, `th`, and `zh` when explicitly
selected.

| Command | Purpose |
| --- | --- |
| `models pull [--enable]` | Preload the configured embedding model and optionally enable semantic retrieval. |
| `ocr doctor` / `ocr setup` | Detect and configure local page-aware PDF OCR. |
| `chat setup|doctor|<question>` | Prepare, inspect, or use the optional local chat add-on. |
| `audio <file>` | Render text with the optional TTS add-on. |

OCR runs only for PDF pages without embedded text. The strict privacy profile disables external
extractors. The first audio command above explicitly downloads the model from non-sensitive text;
the second uses the prepared cache and does not download anything. See the
[offline TTS guide](./offline-tts-preload.md) for model paths and verification.
See [offline Chat](./offline-chat-preload.md) for profile selection and air-gapped preparation.

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
- `evaluate` measures retrieval against a local golden-query file of at most 16 MiB and 1,000
  cases. Wrapped files can declare graded `relevanceJudgments`, `answerable: false` hard negatives,
  categories, locales, exact citations, and independent thresholds for Recall@1/3/5/10,
  Precision@5, MRR@10, nDCG@10, citation accuracy, and false-positive rate.
- A passing suite with at least 100 cases, graded relevance, exact citations, hard negatives, and
  every threshold stores a fingerprint in the active manifest. `rgr doctor` reports retrieval
  quality as verified only while that report still matches the golden file, corpus, model revision,
  retrieval profile, and index policy.
- `usage-report --days` accepts an integer from 1 to 3650; `limits` and `destroy-index` expose the
  other local maintenance operations.
- Add `--json` to machine-readable commands. Do not parse human-readable output in automation.
