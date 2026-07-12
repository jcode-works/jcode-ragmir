# Configuration

Ragmir works out of the box after `rgr setup`. Most users only edit configuration when they need
extra source folders, semantic embeddings, larger files, or local OCR/extraction tools.

The project config lives in `.ragmir/config.json` in the repository being indexed.

## Common Fields

| Field | Default | Purpose |
| --- | --- | --- |
| `privacyProfile` | `private` | Privacy floor: `strict`, `private`, `trusted`, or `custom`. |
| `retrievalProfile` | `balanced` | Retrieval latency/recall preset: `fast`, `balanced`, `quality`, or `custom`. |
| `acceptedRisks` | `[]` | Documented risk identifiers. They are reported by doctor and do not disable safeguards or warnings. |
| `rawDir` | `.ragmir/raw` | Local corpus folder, indexed recursively. |
| `sources` | `[]` | Extra files, directories, glob patterns, or `!` exclusions to index from the project root. |
| `storageDir` | `.ragmir/storage` | LanceDB vector store location. |
| `accessLogPath` | `.ragmir/access.log` | Metadata-only access log path. |
| `embeddingModelPath` | `.ragmir/models` | Local cache for Transformers.js embedding files. |
| `embeddingProvider` | `local-hash` | `local-hash` for fully local lexical retrieval, or `transformers` for semantic embeddings. |
| `embeddingModel` | `intfloat/multilingual-e5-small` | Multilingual model used when `embeddingProvider` is `transformers`. |
| `embeddingModelRevision` | `main` | Hugging Face revision used for model loading. Pin an immutable revision for reproducible deployments. |
| `transformersAllowRemoteModels` | `false` | Allows model downloads at runtime. Keep false for confidential indexing. |
| `redaction.enabled` | `true` | Redacts secrets and identifiers before indexing. |
| `redaction.patterns` | `[]` | Extra `{ name, pattern, flags?, replacement? }` redaction rules. |
| `accessLog` | `true` | Records query metadata, not raw queries. |
| `mcpMaxTopK` | `10` | Hard cap on results any MCP tool may return. |
| `topK` | `8` | Default number of passages returned by `search` and `ask`. |
| `chunkSize` | `1200` | Characters per chunk. |
| `chunkOverlap` | `200` | Overlapping characters between chunks. Must be lower than `chunkSize`. |
| `maxFileBytes` | `50000000` | Per-file size cap. Larger files are skipped and reported. |
| `ingestConcurrency` | `4` | Files processed in parallel during ingest. |
| `embeddingBatchSize` | `32` | Chunks embedded per batch. |
| `hybridTextScanLimit` | `5000` | Maximum lexical fallback scan when a usable FTS index is unavailable. |
| `includeExtensions` | `[]` | Extra UTF-8 text extensions to index. |
| `pdfOcrCommand`, `imageOcrCommand`, `legacyWordCommand` | `[]` | Opt-in local extractors. |
| `pdfOcrTimeoutMs`, `imageOcrTimeoutMs`, `legacyWordTimeoutMs` | `120000` | Extractor timeouts. |

## Ingestion And Corpus Limits

Run `rgr limits` or `rgr limits --json` to inspect the effective values. Ragmir intentionally has no
hard file-count or total-corpus-byte ceiling, so JSON reports `maxFiles: null` and
`maxCorpusBytes: null`. Practical capacity depends on available disk and memory, document parsing,
embedding throughput, index size, and exact flat-vector search latency. Benchmark the target machine
and corpus instead of treating the absence of a hard ceiling as unlimited performance.

| Boundary | Default or hard limit | Behavior |
| --- | ---: | --- |
| Source file size | 50,000,000 bytes, configurable with `maxFileBytes` | Larger files are skipped before parsing and reported by ingest, audit, and doctor. |
| PDF pages | 1000 | Parsing fails rather than processing an unbounded document. |
| PDF extracted text | 25,000,000 characters | Parsing fails when the safety bound is exceeded. |
| Office/archive text entries | 512 | Extra archive entries are not processed silently. |
| One Office XML text entry | 25,000,000 bytes | Parsing fails on an oversized entry. |
| Total Office XML text | 50,000,000 bytes | Parsing fails on excessive extracted XML text. |
| External extractor stdout or stderr | 25,000,000 bytes | The extractor is terminated and ingestion reports an error. |

Doctor treats missing, stale, empty-text, and oversized supported coverage as incomplete. Inspect
`rgr audit --unsupported`, configure a local extractor, split or convert the source, or raise
`maxFileBytes` only after reviewing local parsing and memory risk.

## Privacy And Retrieval Profiles

Privacy and retrieval are independent axes. For example, `strict` plus `quality` maximizes local
retrieval quality under the strict privacy floor, while `trusted` plus `fast` favors latency in an
already trusted environment.

| Privacy profile | Effective policy |
| --- | --- |
| `strict` | Applies after environment overrides. Remote Transformer model loading stays disabled, built-in redaction stays enabled, MCP `topK` is capped at 5, external OCR/legacy extractors are disabled, MCP output is compact by default, paths are project-relative, and research does not scan repository code outside retrieval sources. |
| `private` | Recommended default. Local models, redaction, bounded MCP retrieval, private filesystem modes, and explicit local extractors remain configurable. Security warnings block `doctor.ready`. |
| `trusted` | Allows explicitly trusted deployments to disable redaction or allow remote model loading without those choices becoming privacy warnings. The effective settings remain visible in status and security reports. |
| `custom` | Preserves field-level control without adding a profile floor. Security warnings still describe unsafe effective settings. |

| Retrieval profile | Default `topK` | Lexical fallback scan | Behavior |
| --- | ---: | ---: | --- |
| `fast` | 5 | 2000 | Smaller candidate pools and at most one result chunk per source. |
| `balanced` | 8 | 5000 | Default compromise between latency, diversity, and recall. |
| `quality` | 12 | 10000 | Larger candidate pools, up to four chunks per source, and one adjacent context chunk by default. |
| `custom` | 8 | 5000 | Uses explicit field values and balanced candidate behavior. |

Explicit `topK` and `hybridTextScanLimit` values override the retrieval profile defaults. The strict
privacy floor cannot be weakened by environment variables.

## Source Paths

Ragmir always indexes `rawDir`. Add other local files with `sources`:

```json
{
  "sources": [
    "../packages/*/README.md",
    "../docs",
    "./NOTES.md",
    "!../packages/**/node_modules/**"
  ]
}
```

Use the CLI to update the same array without editing JSON manually:

```bash
rgr sources add "../packages/*/README.md" "../docs" "!../packages/**/node_modules/**"
rgr sources list
```

## Environment Overrides

Use environment variables for machine-specific paths or CI experiments:

- `RAGMIR_RAW_DIR`
- `RAGMIR_STORAGE_DIR`
- `RAGMIR_ACCESS_LOG_PATH`
- `RAGMIR_EMBEDDING_PROVIDER`
- `RAGMIR_EMBEDDING_MODEL`
- `RAGMIR_EMBEDDING_MODEL_REVISION`
- `RAGMIR_EMBEDDING_MODEL_PATH`
- `RAGMIR_TRANSFORMERS_ALLOW_REMOTE_MODELS`
- `RAGMIR_REDACTION_ENABLED`
- `RAGMIR_REDACTION_BUILT_IN`
- `RAGMIR_ACCESS_LOG`
- `RAGMIR_MCP_MAX_TOP_K`
- `RAGMIR_TOP_K`
- `RAGMIR_CHUNK_SIZE`
- `RAGMIR_CHUNK_OVERLAP`
- `RAGMIR_MAX_FILE_BYTES`
- `RAGMIR_INGEST_CONCURRENCY`
- `RAGMIR_EMBEDDING_BATCH_SIZE`
- `RAGMIR_HYBRID_TEXT_SCAN_LIMIT`
- `RAGMIR_INCLUDE_EXTENSIONS`
- `RAGMIR_PDF_OCR_COMMAND`
- `RAGMIR_PDF_OCR_TIMEOUT_MS`
- `RAGMIR_IMAGE_OCR_COMMAND`
- `RAGMIR_IMAGE_OCR_TIMEOUT_MS`
- `RAGMIR_LEGACY_WORD_COMMAND`
- `RAGMIR_LEGACY_WORD_TIMEOUT_MS`

Extractor command variables are JSON arrays, for example:

```bash
RAGMIR_PDF_OCR_COMMAND='["my-pdf-ocr","{input}","{page}"]' rgr ingest
```

## Supported Files

Ragmir indexes common text, document, data, config, log, and source-code files:

- Markdown/text: `.md`, `.mdx`, `.txt`, `.text`, `.rst`, `.adoc`, `.tex`
- Data/config: `.json`, `.jsonl`, `.ndjson`, `.yaml`, `.yml`, `.toml`, `.ini`, `.csv`, `.tsv`,
  `.sql`, `.xml`, `.rss`, `.atom`
- Web and documents: `.html`, `.htm`, `.epub`, `.pdf`, `.docx`, `.pptx`, `.xlsx`, `.odt`, `.ods`,
  `.odp`, `.rtf`, `.ipynb`
- Logs and review text: `.log`, `.diff`, `.patch`, `.markdown`, `.mdown`, `.mmd`
- Source code and scripts: common JavaScript/TypeScript, Python, Go, Rust, Java, Ruby, PHP, C/C++,
  C#, CSS, Vue, Svelte, Astro, shell, batch, and PowerShell files
- Project metadata: `.gitignore`, `.dockerignore`, `.npmignore`, `.gitlab-ci.yml`,
  `.vscode/settings.json`, Maven wrapper `.properties`, `Dockerfile`, `Makefile`, `Procfile`,
  `Gemfile`, `Rakefile`, `mvnw`, and `gradlew`

Add custom UTF-8 text extensions with `includeExtensions`:

```json
{
  "includeExtensions": [".transcript", ".evidence"]
}
```

Audio, video, images, scans, old Office binaries, and unsupported proprietary formats need extraction
or conversion before indexing. `rgr audit --unsupported` prints per-file recommendations.

## External Extractors

Extractors are opt-in and run without a shell from the target project root. They receive a minimal
environment allowlist, must print UTF-8 text to stdout, and are terminated with an escalation when
their timeout expires. The `strict` privacy profile disables them.

| Need | Config field | Environment path variable |
| --- | --- | --- |
| Blank PDF page OCR | `pdfOcrCommand` | `RAGMIR_PDF_PATH`, `RAGMIR_PDF_PAGE` |
| Direct image OCR | `imageOcrCommand` | `RAGMIR_IMAGE_PATH` |
| Old `.doc` Word extraction | `legacyWordCommand` | `RAGMIR_LEGACY_WORD_PATH` |

For scanned PDFs, let Ragmir detect and configure supported local tools:

```bash
rgr ocr doctor
rgr ocr setup --language eng+fra
rgr ingest
```

`auto` prefers OCRmyPDF 12.6 or newer, then Tesseract plus Poppler. Setup only writes the local
command configuration. It does not install those tools, download language packs, or send files to a
remote OCR service. Use `--engine ocrmypdf` or `--engine tesseract` when the choice must be explicit.

The generated configuration remains the same public extractor contract and can be replaced with a
custom local wrapper when needed:

```json
{
  "pdfOcrCommand": ["my-pdf-ocr", "{input}", "{page}"],
  "pdfOcrTimeoutMs": 120000
}
```

Keep extractor tooling local when documents are confidential.

PDF extraction is page-aware. Embedded text is extracted sequentially, only blank pages use the
optional OCR command, and citations include the page, for example `brief.pdf:p2:L4-L8#3`. A PDF is
limited to 1000 pages and 25 million extracted characters. Use `{page}` in a PDF OCR argument when
the wrapper can process one page at a time. Ragmir does not reconstruct arbitrary visual columns or
tables and does not claim universal scanned-PDF support.

Chunking is character-bounded but structure-aware. It prefers paragraph breaks, then Latin or CJK
sentence endings, then line boundaries for code, lists, and tables, before falling back to whitespace
or the hard character limit. `chunkOverlap` still applies after the selected boundary.

## Index Policy And Incremental Ingestion

The index manifest fingerprints the embedding provider, model and revision, chunking settings and
adapter version, redaction, extractor configuration, parser version, and index schema. A policy
change triggers a safe full rebuild; search refuses a stale or incompatible index.

Normal ingestion hashes source files with bounded concurrency, reuses unchanged manifest entries,
deletes only removed or replaced paths, and inserts only changed chunks. A no-op ingestion leaves
the LanceDB table version unchanged. Ragmir uses exact flat vector search by default. Approximate
IVF-PQ indexing is not enabled automatically because it can reduce recall on small and medium
corpora.

Source diagnostics report duplicate candidates only when file contents have the same SHA-256. Files
that merely share a common basename such as `README.md` or `config.json` are not duplicates.

Retrieval diversity suppresses duplicate text and overlapping character spans from the same source
before applying the profile's per-source result limit. Distinct non-overlapping passages from one
document remain eligible, while chunk overlap cannot consume multiple top-K slots.
