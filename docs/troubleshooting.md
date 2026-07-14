# Troubleshooting

Start with the smallest diagnostic:

```bash
rgr doctor
rgr audit --unsupported
rgr security-audit
```

## The project is not initialized

Run `rgr setup`. It creates `.ragmir/config.json`, local ignore rules, and optional agent helpers.

## No files or stale files are indexed

Check `sources` with `rgr sources list`, then run `rgr ingest`. Use `rgr audit` to compare supported files with the index. Use `rgr ingest --rebuild` after changing embedding provider, model, or chunking.

## Ingestion was interrupted

Run `rgr status --json`, then start `rgr ingest` again. A compatible run resumes from its last
committed file batch. Files in `parsed` or `embedded` state without a committed index write are
retried; files already in `indexed` state are not parsed or embedded again. If source checksums or
the indexing policy changed, Ragmir starts a new safe run instead.

An interrupted `rgr ingest --rebuild` leaves the previous complete index active. Re-run the rebuild
to continue its isolated generation.

## A PDF or image has no text

`rgr ingest --json` reports `emptyTextFiles`. For scanned PDFs, run:

```bash
rgr ocr doctor
rgr ocr setup
rgr ingest
```

OCR is local and opt-in. Images and legacy `.doc` files need explicitly configured local extractors.

## Search is weak

First confirm source coverage with `rgr audit`. Then try a specific query, `--context-radius 1`, or a higher `--top-k`. For semantic retrieval, run `rgr models pull --enable` followed by `rgr ingest --rebuild`.

## Strict audit fails

Run `rgr security-audit --strict`. It reports the exact local control that conflicts with the strict profile. Strict mode requires ignored local state, redaction, bounded MCP output, and no external extractors.

## Chat or audio is not ready

Run `rgr chat doctor` or `rgr audio --doctor`. Setup commands download optional public model files explicitly; normal offline use requires those files to be present already. See the dedicated local chat and TTS guides for model preparation.
