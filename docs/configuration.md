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
| `mcpMaxOutputBytes` | `32768` | Cap each retrieval tool's serialized MCP text output. |
| `chunkSize` / `chunkOverlap` | `1200` / `200` | Tune chunking, then rebuild the index. |
| `maxFileBytes` | `50000000` | Raise only when the target corpus justifies it. |
| `includeExtensions` | `[]` | Add safe custom text extensions. |

Changing an embedding provider, model, or chunking field requires `rgr ingest --rebuild`.
Ragmir also preserves Markdown heading paths and JSON or JSONL structure as retrieval-only context.
Rebuild indexes created by an older Ragmir version to populate that structural context.

## Privacy profiles

- `private` keeps remote model loading disabled and built-in redaction enabled.
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
RAGMIR_MCP_MAX_OUTPUT_BYTES=16384 rgr mcp
```

Environment overrides cover selected runtime settings such as models, retrieval limits, access logs,
and extractor commands. Run `rgr status --json` to inspect the effective result.

For a long-running process that hosts more than one isolated project workflow, create one
`RagmirClient` per project root and keep process-wide environment overrides stable after startup.
Close every client during shutdown. If several OS processes can ingest the same storage directory,
the host must coordinate a single writer.
