# Troubleshooting

Use `mimir doctor` first. It is the shortest path to the next useful action:

```bash
pnpm exec mimir doctor
```

Use `doctor --fix` when you want Mimir to repair safe setup issues automatically:

```bash
pnpm exec mimir doctor --fix
```

## `mimir doctor` Says The Project Is Not Initialized

Run:

```bash
pnpm exec mimir setup
pnpm exec mimir doctor
```

Commit only safe scaffolding if this is a real repository. Do not commit local Mimir state, env
files, credentials, indexes, reports, audio, model caches, or raw documents.

## No Files Are Indexed

Check that supported files exist under `.mimir/raw/`:

```bash
find .mimir/raw -maxdepth 2 -type f
pnpm exec mimir ingest
pnpm exec mimir doctor
```

If documents live elsewhere, add one path per line to `.mimir/sources.txt`. Relative paths resolve from
the project root.

If files exist but are not supported yet, inspect the skipped inventory:

```bash
pnpm exec mimir audit --unsupported
```

Then follow the per-file recommendation: convert unsupported binaries to a supported format,
OCR/transcribe them, or add a safe custom UTF-8 text extension with `includeExtensions` /
`MIMIR_INCLUDE_EXTENSIONS`.

## Scanned PDFs Or Images Produce No Text

Mimir extracts embedded PDF text by default. For scanned/image-only PDFs, configure an explicit local
OCR wrapper that prints UTF-8 text to stdout:

```json
{
  "pdfOcrCommand": ["mimir-pdf-ocr", "{input}"],
  "pdfOcrTimeoutMs": 120000
}
```

The command runs only when normal PDF extraction returns no text. It is executed without a shell,
receives `MIMIR_PDF_PATH`, and may use `{input}` in its arguments for the PDF path. Keep OCR tooling
local for confidential documents.

Standalone image files such as `.png`, `.jpg`, `.heic`, and `.tiff` are skipped by default. To index
them directly, configure an explicit local image OCR wrapper:

```json
{
  "imageOcrCommand": ["mimir-image-ocr", "{input}"],
  "imageOcrTimeoutMs": 120000
}
```

The command runs from the target project root, receives `MIMIR_IMAGE_PATH`, may use `{input}` in its
arguments for the image path, and must print UTF-8 text to stdout. Images become supported only when
`imageOcrCommand` is configured.

If ingestion finishes but a scanned PDF still has no text, `mimir ingest --json` lists it under
`emptyTextFiles`. If you do not want direct image OCR, OCR images to text or convert them to OCRed
PDFs before ingesting.

## Legacy `.doc` Files Are Skipped

Old Word `.doc` binaries are skipped by default because they need a trusted local extractor. Convert
them to `.docx`, PDF, HTML, or text, or configure an explicit wrapper:

```json
{
  "legacyWordCommand": ["mimir-doc-text", "{input}"],
  "legacyWordTimeoutMs": 120000
}
```

The command runs from the target project root without a shell, receives `MIMIR_LEGACY_WORD_PATH`,
may use `{input}` in its arguments for the source path, and must print UTF-8 text to stdout. `.doc`
files become supported only when `legacyWordCommand` is configured.

## Search Returns Weak Results

The default `local-hash` provider is dependency-light and offline, but it is lexical/hash retrieval,
not semantic retrieval.

For better semantic retrieval, configure Transformers.js embeddings and preload the model when
working offline:

```json
{
  "embeddingProvider": "transformers",
  "embeddingModel": "mixedbread-ai/mxbai-embed-xsmall-v1",
  "embeddingModelPath": ".mimir/models",
  "transformersAllowRemoteModels": false
}
```

When remote download is acceptable, preload the configured embedding model first:

```bash
pnpm exec mimir models pull --enable
```

Switching providers requires a full re-ingest:

```bash
pnpm exec mimir ingest --rebuild
pnpm exec mimir doctor
```

## `mimir audit` Reports Missing Or Stale Files

Run:

```bash
pnpm exec mimir ingest
pnpm exec mimir audit
```

Or let doctor perform the safe incremental update:

```bash
pnpm exec mimir doctor --fix
```

Mimir incrementally reuses unchanged indexed rows on normal `mimir ingest`. Use `mimir ingest --rebuild`
after switching embedding provider/model, after changing chunking settings, or when you want to
discard and recreate the whole local index.

## `security-audit --strict` Fails

Read the warning lines. Common causes:

- `.mimir/` is not ignored by Git.
- Legacy projects using `.kb/` or `private/**` are missing the matching legacy Git ignore entries.
- Redaction was disabled.
- Transformers.js remote model loading was enabled.

Run the safe repair command if Git ignore entries are missing:

```bash
pnpm exec mimir doctor --fix
pnpm exec mimir security-audit --strict
```

## MP3 Audio Fails Without `--engine edge`

This is intentional. MP3 output uses online Edge TTS and requires explicit consent:

```bash
pnpm exec mimir audio /tmp/summary.txt \
  --engine edge \
  --out .mimir/audio/summary.mp3
```

For confidential or offline work, use WAV:

```bash
pnpm exec mimir audio /tmp/summary.txt \
  --engine transformers \
  --offline \
  --out .mimir/audio/summary.wav
```

## Edge TTS Is Not Installed

Install the external CLI:

```bash
pipx install edge-tts
pnpm exec mimir audio --doctor
```

Only use Edge TTS when sending narration text to the online service is acceptable.

## `mimir-tts --offline` Cannot Render

Offline rendering requires model files to already exist under `.mimir/models/tts` or the path passed
with `--model-path`.

For a first online setup, use non-sensitive text:

```bash
printf 'Mimir offline speech preload check.' > /tmp/mimir-tts-preload.txt
pnpm exec mimir-tts render /tmp/mimir-tts-preload.txt \
  --engine transformers \
  --allow-remote-models \
  --model-path .mimir/models/tts \
  --out .mimir/audio/preload-check.wav
```

Then reuse the cached files with:

```bash
pnpm exec mimir-tts render /tmp/mimir-tts-preload.txt \
  --offline \
  --model-path .mimir/models/tts \
  --out .mimir/audio/offline-check.wav
```

The full workflow is documented in [`offline-tts-preload.md`](./offline-tts-preload.md).
