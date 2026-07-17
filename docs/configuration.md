# Configuration

Ragmir reads `.ragmir/config.json` from the current directory or an ancestor. Start with `rgr setup`;
edit JSON only for a real need.

```json
{
  "sources": ["docs/**/*.md", "src", "!docs/archive/**"],
  "privacyProfile": "private",
  "retrievalProfile": "balanced",
  "embeddingProvider": "local-hash"
}
```

## Common fields

| Field | Default | Why change it |
| --- | --- | --- |
| `sources` | `[]` | Add project paths, globs, and `!` exclusions. |
| `privacyProfile` | `private` | Use `strict` for the strongest local floor. |
| `retrievalProfile` | `balanced` | Use `fast`, `quality`, or `custom` for different search budgets. |
| `embeddingProvider` | `local-hash` | Set `transformers` only after an explicit preload. |
| `topK` | `8` | Change the default number of returned passages. |
| `mcpMaxOutputBytes` | `32768` | Cap variable-size MCP tool and resource JSON; the server also enforces an absolute 1 MiB ceiling. |
| `chunkSize` / `chunkOverlap` | `1200` / `200` | Tune chunking, then rebuild the index. |
| `maxFileBytes` | `50000000` | Raise only when the target corpus justifies it. |
| `incrementalFailurePolicy` | `preserve-last-good` | Use `remove-stale` only when failed changed files must disappear immediately. |
| `includeExtensions` | `[]` | Add safe custom text extensions. |

Changing an embedding provider, model, or chunking field requires `rgr ingest --rebuild`.
Ragmir also preserves Markdown heading paths and JSON or JSONL structure as retrieval-only context.
Rebuild indexes created by an older Ragmir version to populate that structural context.

Incremental ingestion preserves the last indexed rows when parsing, embedding, or LanceDB writing
fails for a changed file. The result, manifest, durable ingestion state, and `rgr audit` mark that
file as stale until a later ingest repairs it. Set `incrementalFailurePolicy` to `remove-stale`, or
pass `rgr ingest --incremental-failure-policy remove-stale`, only when serving stale evidence is
less acceptable than temporarily serving no evidence for that file. Actual source deletion always
removes its rows.

## Privacy profiles

- `private` defaults remote model loading to disabled and keeps built-in redaction enabled; remote
  Transformers loading still requires an explicit opt-in.
- `strict` also bounds MCP output and disables every external extractor.
- `trusted` and `custom` are for operators who explicitly accept different local controls.

`privacyProfile` is a safety floor, separate from retrieval quality.

## Semantic retrieval

```bash
rgr setup --semantic
rgr ingest --rebuild
```

This preloads the configured Transformers model once and leaves normal remote model loading disabled.
Use `rgr models pull --enable` for the same change after initial setup.

## Local extractors

```bash
rgr ocr doctor
rgr ocr setup --language eng+fra
```

PDF OCR is optional and page-aware. Ragmir calls it only for blank extracted pages. Custom
`pdfOcrCommand`, `imageOcrCommand`, and `legacyWordCommand` values must be JSON argument arrays;
they run without a shell and must print text to stdout.

## Environment overrides

Use `RAGMIR_*` variables for local experiments, for example:

```bash
RAGMIR_TOP_K=5 rgr search "migration"
RAGMIR_MCP_MAX_OUTPUT_BYTES=16384 rgr serve-mcp
```

Environment overrides cover selected runtime settings such as models, retrieval limits, access logs,
and extractor commands. Run `rgr status --json` to inspect the effective result.

For a long-running process that hosts more than one isolated project workflow, create one
`RagmirClient` per project root and keep process-wide environment overrides stable after startup.
Close every client during shutdown. If several OS processes can ingest the same storage directory,
the host must coordinate a single writer.

## Parser safety limits

Run `rgr limits` to inspect the fixed parser ceilings. Office archives, including DOCX and XLSX,
allow at most 512 text entries, 25 MB per entry, and 50 MB of expanded text in total. PDF extraction
is capped at 1,000 pages and 25 million text characters. Combined stdout and stderr from a local
external extractor are capped at 25 MB. Files above `maxFileBytes` are skipped and reported instead
of being partially indexed.
