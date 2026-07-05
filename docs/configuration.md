# Configuration

Ragmir works out of the box after `rgr setup`. Most users only edit configuration when they need
extra source folders, semantic embeddings, larger files, or local OCR/extraction tools.

The project config lives in `.ragmir/config.json` in the repository being indexed.

## Common Fields

| Field | Default | Purpose |
| --- | --- | --- |
| `rawDir` | `.ragmir/raw` | Local corpus folder, indexed recursively. |
| `sources` | `[]` | Extra files, directories, glob patterns, or `!` exclusions to index from the project root. |
| `storageDir` | `.ragmir/storage` | LanceDB vector store location. |
| `accessLogPath` | `.ragmir/access.log` | Metadata-only access log path. |
| `embeddingModelPath` | `.ragmir/models` | Local cache for Transformers.js embedding files. |
| `embeddingProvider` | `local-hash` | `local-hash` for fully local lexical retrieval, or `transformers` for semantic embeddings. |
| `embeddingModel` | `mixedbread-ai/mxbai-embed-xsmall-v1` | Model used when `embeddingProvider` is `transformers`. |
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
| `includeExtensions` | `[]` | Extra UTF-8 text extensions to index. |
| `pdfOcrCommand`, `imageOcrCommand`, `legacyWordCommand` | `[]` | Opt-in local extractors. |
| `pdfOcrTimeoutMs`, `imageOcrTimeoutMs`, `legacyWordTimeoutMs` | `120000` | Extractor timeouts. |

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
- `RAGMIR_INCLUDE_EXTENSIONS`
- `RAGMIR_PDF_OCR_COMMAND`
- `RAGMIR_PDF_OCR_TIMEOUT_MS`
- `RAGMIR_IMAGE_OCR_COMMAND`
- `RAGMIR_IMAGE_OCR_TIMEOUT_MS`
- `RAGMIR_LEGACY_WORD_COMMAND`
- `RAGMIR_LEGACY_WORD_TIMEOUT_MS`

Extractor command variables are JSON arrays, for example:

```bash
RAGMIR_PDF_OCR_COMMAND='["ragmir-pdf-ocr","{input}"]' rgr ingest
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

Extractors are opt-in and run without a shell from the target project root. They must print UTF-8
text to stdout.

| Need | Config field | Environment path variable |
| --- | --- | --- |
| Scanned/image-only PDF OCR | `pdfOcrCommand` | `RAGMIR_PDF_PATH` |
| Direct image OCR | `imageOcrCommand` | `RAGMIR_IMAGE_PATH` |
| Old `.doc` Word extraction | `legacyWordCommand` | `RAGMIR_LEGACY_WORD_PATH` |

Example:

```json
{
  "pdfOcrCommand": ["ragmir-pdf-ocr", "{input}"],
  "pdfOcrTimeoutMs": 120000
}
```

Keep extractor tooling local when documents are confidential.
