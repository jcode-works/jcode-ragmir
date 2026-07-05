# Troubleshooting

Use `rgr doctor` first. It is the shortest path to the next useful action:

```bash
npx rgr doctor
```

Use `doctor --fix` when you want Ragmir to repair safe setup issues automatically:

```bash
npx rgr doctor --fix
```

## `rgr doctor` Says The Project Is Not Initialized

Run:

```bash
npx rgr setup
npx rgr doctor
```

Commit only safe scaffolding if this is a real repository. Do not commit local Ragmir state, env
files, credentials, indexes, reports, audio, model caches, or raw documents.

## No Files Are Indexed

Check that supported files exist under `.ragmir/raw/`:

```bash
find .ragmir/raw -maxdepth 2 -type f
npx rgr ingest
npx rgr doctor
```

If documents live elsewhere, add paths or glob patterns with `rgr sources add` or edit the
`sources` array in `.ragmir/config.json`. Relative entries resolve from the project root, and `!`
excludes matched files:

```plain text
../apps/*/README.md
../apps/*/docs/**/*.md
!../apps/**/node_modules/**
```

If files exist but are not supported yet, inspect the skipped inventory:

```bash
npx rgr audit --unsupported
```

Then follow the per-file recommendation: convert unsupported binaries to a supported format,
OCR/transcribe them, or add a safe custom UTF-8 text extension with `includeExtensions` /
`RAGMIR_INCLUDE_EXTENSIONS`.

## Scanned PDFs Or Images Produce No Text

Ragmir extracts embedded PDF text by default. For scanned/image-only PDFs, configure an explicit local
OCR wrapper that prints UTF-8 text to stdout:

```json
{
  "pdfOcrCommand": ["ragmir-pdf-ocr", "{input}"],
  "pdfOcrTimeoutMs": 120000
}
```

The command runs only when normal PDF extraction returns no text. It is executed without a shell,
receives `RAGMIR_PDF_PATH`, and may use `{input}` in its arguments for the PDF path. Keep OCR tooling
local for confidential documents.

Standalone image files such as `.png`, `.jpg`, `.heic`, and `.tiff` are skipped by default. To index
them directly, configure an explicit local image OCR wrapper:

```json
{
  "imageOcrCommand": ["ragmir-image-ocr", "{input}"],
  "imageOcrTimeoutMs": 120000
}
```

The command runs from the target project root, receives `RAGMIR_IMAGE_PATH`, may use `{input}` in its
arguments for the image path, and must print UTF-8 text to stdout. Images become supported only when
`imageOcrCommand` is configured.

If ingestion finishes but a scanned PDF still has no text, `rgr ingest --json` lists it under
`emptyTextFiles`. If you do not want direct image OCR, OCR images to text or convert them to OCRed
PDFs before ingesting.

## Legacy `.doc` Files Are Skipped

Old Word `.doc` binaries are skipped by default because they need a trusted local extractor. Convert
them to `.docx`, PDF, HTML, or text, or configure an explicit wrapper:

```json
{
  "legacyWordCommand": ["ragmir-doc-text", "{input}"],
  "legacyWordTimeoutMs": 120000
}
```

The command runs from the target project root without a shell, receives `RAGMIR_LEGACY_WORD_PATH`,
may use `{input}` in its arguments for the source path, and must print UTF-8 text to stdout. `.doc`
files become supported only when `legacyWordCommand` is configured.

## Search Returns Weak Results

The default `local-hash` provider is dependency-light and offline, but it is lexical/hash retrieval,
not semantic retrieval.

For better semantic retrieval, choose Transformers.js embeddings during setup or preload the model
later. This requires an explicit one-time model download, but natural-language search quality is
usually better than the default lexical/hash mode.

```json
{
  "embeddingProvider": "transformers",
  "embeddingModel": "mixedbread-ai/mxbai-embed-xsmall-v1",
  "embeddingModelPath": ".ragmir/models",
  "transformersAllowRemoteModels": false
}
```

When remote download is acceptable during first setup, use:

```bash
npx rgr setup --semantic
```

Or preload the configured embedding model later:

```bash
npx rgr models pull --enable
```

Switching providers requires a full re-ingest:

```bash
npx rgr ingest --rebuild
npx rgr doctor
```

## `rgr audit` Reports Missing Or Stale Files

Run:

```bash
npx rgr ingest
npx rgr audit
```

Or let doctor perform the safe incremental update:

```bash
npx rgr doctor --fix
```

Ragmir incrementally reuses unchanged indexed rows on normal `rgr ingest`. Use `rgr ingest --rebuild`
after switching embedding provider/model, after changing chunking settings, or when you want to
discard and recreate the whole local index.

## `security-audit --strict` Fails

Read the warning lines. Common causes:

- `.ragmir/` is not ignored by Git.
- generated local state is not ignored by Git.
- Redaction was disabled.
- Transformers.js remote model loading was enabled.

Run the safe repair command if Git ignore entries are missing:

```bash
npx rgr doctor --fix
npx rgr security-audit --strict
```

## MP3 Audio Fails Without `--engine edge`

This is intentional. MP3 output uses online Edge TTS and requires explicit consent:

```bash
npx rgr audio /tmp/summary.txt \
  --engine edge \
  --out .ragmir/audio/summary.mp3
```

For confidential or offline work, use WAV:

```bash
npx rgr audio /tmp/summary.txt \
  --engine transformers \
  --offline \
  --out .ragmir/audio/summary.wav
```

## Edge TTS Is Not Installed

Install the external CLI:

```bash
pipx install edge-tts
npx rgr audio --doctor
```

Only use Edge TTS when sending narration text to the online service is acceptable.

## `rgr-tts --offline` Cannot Render

Offline rendering requires model files to already exist under `.ragmir/models/tts` or the path passed
with `--model-path`.

For a first online setup, use non-sensitive text:

```bash
printf 'Ragmir offline speech preload check.' > /tmp/ragmir-tts-preload.txt
npx rgr-tts render /tmp/ragmir-tts-preload.txt \
  --engine transformers \
  --allow-remote-models \
  --model-path .ragmir/models/tts \
  --out .ragmir/audio/preload-check.wav
```

Then reuse the cached files with:

```bash
npx rgr-tts render /tmp/ragmir-tts-preload.txt \
  --offline \
  --model-path .ragmir/models/tts \
  --out .ragmir/audio/offline-check.wav
```

The full workflow is documented in [`offline-tts-preload.md`](./offline-tts-preload.md).
