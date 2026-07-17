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
| `topK` | `8` | Change the default number of returned passages, up to the hard limit of 100. |
| `mcpMaxTopK` | `10` | Bound MCP passage requests; values above 100 are rejected. |
| `mcpMaxOutputBytes` | `32768` | Cap variable-size MCP tool and resource JSON; the server also enforces an absolute 1 MiB ceiling. |
| `chunkSize` / `chunkOverlap` | `1200` / `200` | Tune chunking, then rebuild the index. |
| `maxFileBytes` | `50000000` | Lower the per-file parser budget; 50 MB is the hard ceiling. |
| `ingestConcurrency` | `4` | Bound concurrent parsers; values above `8` are rejected. |
| `embeddingBatchSize` | `32` | Bound one model call; values above `128` are rejected. |
| `sourceFingerprintMode` | `fast` | Use `strict` to hash every source on every inventory instead of reusing unchanged private fingerprints. |
| `incrementalFailurePolicy` | `preserve-last-good` | Use `remove-stale` only when failed changed files must disappear immediately. |
| `hybridTextScanLimit` | `5000` | Bound lexical fallback candidates; values above 10,000 are rejected. Search applies a smaller profile-aware candidate budget when possible. |
| `includeExtensions` | `[]` | Add safe custom text extensions. |

### Retrieval profiles and ranking policy

Profiles bound retrieval work. They are candidate and diversification budgets, not a guarantee that
a larger budget improves every corpus. Evaluate the profile against a representative golden set
before changing production configuration.

| Profile | Quality intent | Latency intent | Default `topK` | Lexical scan cap | Vector candidates | Lexical candidates | Chunks per source | Context radius |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `fast` | Narrow, diverse evidence | Lowest work budget | 5 | 2,000 | max(40, 3 x `topK`) | max(100, 10 x `topK`) | 1 | 0 |
| `balanced` | General-purpose evidence | Default work budget | 8 | 5,000 | max(80, 4 x `topK`) | max(250, 20 x `topK`) | 2 | 0 |
| `quality` | Broader multi-section evidence | Highest work budget | 12 | 10,000 | max(200, 8 x `topK`) | max(500, 40 x `topK`) | 4 | 1 |
| `custom` | Golden-set validated | Operator-defined | configured | configured | max(80, 4 x `topK`) | max(250, 20 x `topK`) | 2 | 0 |

Vector candidates are capped at 1,000 and lexical candidates never exceed
`hybridTextScanLimit`. Hybrid ranking uses deterministic reciprocal-rank fusion with `k = 60` and
equal vector and lexical weights. Stable source and chunk keys break score ties before ranks are
assigned. The active provider, profile, and ranking parameters form a policy fingerprint stored in
quality reports and exposed by score explanations.

Abstention is provider-aware. `local-hash` requires lexical evidence and gives query identifiers
precedence over coincidental section numbers. Transformers results require lexical evidence or a
normalized L2 distance no greater than 1.1. That distance was calibrated against the bundled
quality corpus with `mixedbread-ai/mxbai-embed-xsmall-v1`; every other model and corpus still needs
its own golden-query evaluation. The benchmark keeps experimental rank weights in its report and
does not promote them automatically.

Changing an embedding provider, model, or chunking field requires `rgr ingest --rebuild`.
Ragmir also preserves Markdown heading paths and JSON or JSONL structure as retrieval-only context.
Rebuild indexes created by an older Ragmir version to populate that structural context.

Fast source fingerprints reuse SHA-256 only when path identity, size, high-resolution modification
and change times, inode, device, and mode still match. Suspicious metadata or a cache older than 30
days forces a full hash. A corrupt cache falls back to full hashing. Strict mode always reads and
hashes every included file.

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
Close every client during shutdown. Ragmir serializes writers across local OS processes with a
private heartbeat lock under `storageDir`; readers stay available. This is not a distributed lock,
so do not place one writable index on a shared network filesystem.

## Parser safety limits

Run `rgr limits` to inspect the fixed parser ceilings. Office archives, including DOCX and XLSX,
allow at most 512 text entries, 25 MB per entry, and 50 MB of expanded text in total. PDF extraction
is capped at 1,000 pages and 25 million text characters. Combined stdout and stderr from a local
external extractor are capped at 25 MB. Files above `maxFileBytes` are skipped and reported instead
of being partially indexed. Ingestion also caps a parse window at 50 MB and 8,192 estimated chunks,
one file at 65,536 chunks and 256 MiB of vectors, the CLI file batch at 128, parser concurrency at
8, and embedding batches at 128. Each file is committed separately, so restart repeats at most one
bounded commit.
