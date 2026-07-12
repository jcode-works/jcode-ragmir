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

Ragmir extracts embedded PDF text page by page. For blank scanned pages, detect and configure a
supported local OCR engine:

```bash
rgr ocr doctor
rgr ocr setup --language eng+fra
rgr ingest
```

Setup prefers OCRmyPDF 12.6 or newer, then Tesseract plus Poppler. It does not install those tools or
language packs, and it never calls a cloud OCR API. If `ocr doctor` reports missing languages, install
the required Tesseract packs and retry. The command runs only for pages where embedded extraction
returns no text. It is executed without a shell and with a minimal environment. The `strict` privacy
profile disables external extractors.

Advanced users can still set `pdfOcrCommand` or `RAGMIR_PDF_OCR_COMMAND` to a custom local wrapper.
It receives `RAGMIR_PDF_PATH` and `RAGMIR_PDF_PAGE`, may use `{input}` and `{page}`, and must print
UTF-8 text to stdout.

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
  "embeddingModel": "intfloat/multilingual-e5-small",
  "embeddingModelRevision": "main",
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

Ragmir incrementally reuses unchanged files and mutates only removed or replaced paths on normal
`rgr ingest`. A no-op does not create a new LanceDB table version. Index-policy changes trigger a
safe full rebuild automatically. Use `rgr ingest --rebuild` when you intentionally want to discard
and recreate an otherwise compatible index.

## Doctor Reports Incomplete Coverage

Doctor keeps `ready=false` when supported sources are missing, stale, oversized, or produced no
indexable text. Start with:

```bash
npx rgr limits
npx rgr audit --unsupported
npx rgr ingest --json
```

Split or convert oversized files, configure an approved local OCR/extractor for empty scans, and
re-ingest. Ragmir has no hard file-count or total-corpus-byte ceiling, but that does not guarantee
acceptable performance: benchmark ingestion and retrieval on the target corpus and machine.

If research notes or duplicate mirrors dominate results, constrain the evidence tier before ranking:

```bash
npx rgr search "primary finding" --include-path ".ragmir/raw/primary"
npx rgr research "remaining gaps" --exclude-path ".ragmir/raw/research" --exclude-path ".ragmir/raw/archive"
```

## `security-audit --strict` Fails

Read the warning lines. Common causes:

- `.ragmir/` is not ignored by Git.
- generated local state is not ignored by Git.
- Redaction was disabled.
- Transformers.js remote model loading was enabled.
- An existing config, raw directory, index directory, or access log exposes group/other POSIX bits.

Run the safe repair command if Git ignore entries or local modes need repair:

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

## `rgr chat doctor` Reports The Model Is Not Ready

Run doctor for the profile you intend to use:

```bash
npx rgr chat doctor --profile lite
npx rgr chat doctor --profile fast
npx rgr chat doctor --profile quality --verify --json
```

The `lite` profile requires the 491 MB Qwen2.5 0.5B GGUF. The default `fast` profile requires the
3.35 GB Gemma 4 E2B GGUF, and `quality` requires the 5.15 GB Gemma 4 E4B GGUF. Normal doctor verifies all of the following before reporting the profile
ready:

- the `node-llama-cpp` 3.19 runtime is available;
- `.ragmir/models/chat/<profile>/manifest.json` exists and selects the requested profile;
- the manifest refers to a relative GGUF path, not an absolute project path;
- the GGUF exists and has the exact recorded byte size.

Normal doctor intentionally avoids hashing the selected model on every readiness refresh. Add
`--verify` to recompute the full SHA-256. JSON output exposes the result as `modelHashValid`.

If the manifest or GGUF is missing, run explicit setup:

```bash
npx rgr chat setup --profile lite
npx rgr chat setup --profile fast
```

Use `--profile lite` on an older or low-memory computer and `--profile quality` only when you
intentionally want the larger model. The lite profile forces thinking off and produces shorter,
lower-quality synthesis. If size validation or a
full `--verify` SHA-256 check fails, the file is incomplete or does not match the expected artifact.
Run setup again on a trusted network rather than editing the manifest or bypassing verification.

## `rgr chat --offline` Cannot Answer

Normal chat answers never download a model. They require a profile that already passes doctor:

```bash
npx rgr chat doctor --profile fast
npx rgr chat "Which evidence supports offline operation?" --profile fast --thinking standard --offline
```

If `rgr chat` returns no context, the model is not the first problem to solve. Run
`npx rgr doctor --fix`, then inspect retrieval directly:

```bash
npx rgr search "Which evidence supports offline operation?"
```

If the `quality` profile cannot start because the computer lacks local resources, prepare and use the
default `fast` profile. Runtime speed and memory use vary with hardware, context size, and thinking
mode; the documented 3.35 GB and 5.15 GB values are model-file download sizes.

Ragmir Chat currently supports desktop and CLI workflows only. Android chat is future work; do not
try to fix an Android failure by installing Ollama, Python, or a hosted model API.

## Chat Does Not Show Raw Thinking

This is intentional. `--thinking off`, `standard`, and `deep` control bounded local reasoning, but
raw thought text is never displayed, returned, persisted, or written to logs. Only the user-visible
question and final answer may be retained in local chat history.

`rgr-chat serve` is the persistent internal stdio JSONL transport for desktop integration. Do not
launch it as the user chat interface; use `rgr chat ...` and `rgr chat doctor`. Core `rgr chat` uses
the package API directly for one-shot answers.

## A Cited Chat Answer Is Still Wrong

Ragmir validates generated citation markers against the passages retrieved for that answer. This
prevents references to nonexistent entries in the supplied source list, but it does not guarantee
that Gemma interpreted a real passage correctly or that the source itself is true.

Open the cited files, compare the claim with the cited lines or chunks, and use `rgr search` with a
more specific query when the evidence is ambiguous. Important legal, financial, medical, security,
or operational claims still require appropriate human or professional review.

The full setup and air-gapped transfer workflow is documented in
[`offline-chat-preload.md`](./offline-chat-preload.md).
