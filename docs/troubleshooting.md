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

Commit only safe scaffolding if this is a real repository. Do not commit private documents,
`.kb/storage`, `.mimir/`, env files, or credentials.

## No Files Are Indexed

Check that supported files exist under `private/`:

```bash
find private -maxdepth 2 -type f
pnpm exec mimir ingest
pnpm exec mimir doctor
```

If documents live elsewhere, add one path per line to `.kb/sources.txt`. Relative paths resolve from
the project root.

If files exist but are not supported yet, inspect the skipped inventory:

```bash
pnpm exec mimir audit --unsupported
```

Then either convert them to a supported format, OCR/transcribe them, or add a safe custom UTF-8 text
extension with `includeExtensions` / `KB_INCLUDE_EXTENSIONS`.

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
pnpm exec mimir models pull
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

- `.kb/`, `.mimir/`, or `private/**` are not ignored by Git.
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

For a first online setup on non-sensitive text:

```bash
pnpm exec mimir-tts render /tmp/test.txt --out .mimir/audio/test.wav
```

Then reuse the cached files with:

```bash
pnpm exec mimir-tts render /tmp/test.txt --offline --out .mimir/audio/test.wav
```
