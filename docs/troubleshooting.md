# Troubleshooting

Start with the smallest diagnostic:

```bash
rgr doctor
rgr doctor --deep
rgr audit --unsupported
rgr security-audit
```

The first command reads the last successful manifest health snapshot. Use `--deep` only when you
need a live O(corpus) inventory and executable security probes. `rgr audit` is also O(corpus).

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

If the durable ingestion state is invalid or inconsistent with the current configuration, Ragmir
ignores it and starts a new safe run. It does not resume from untrusted table names or staged
manifest paths.

## The activation manifest was recovered

If `rgr doctor` reports that the canonical activation manifest is missing or invalid, Ragmir uses
the last validated previous generation and keeps readiness false. Run `rgr ingest --rebuild` to
write a new canonical manifest. If both canonical and previous manifests are invalid, retrieval
does not fall back to an unverified default table.

## A PDF or image has no text

`rgr ingest --json` reports `emptyTextFiles`. For scanned PDFs, run:

```bash
rgr ocr doctor
rgr ocr setup
rgr ingest
```

OCR is local and opt-in. Generated PDF OCR runs in bounded page groups and resumes from private
content-addressed cache entries. The OCR metrics in `rgr ingest --json` and `rgr preview --json`
report cache hits, batches, subprocesses, and duration without page text. The full preview output
also includes extracted chunk text, so review it before sharing. Images and legacy `.doc` files
need explicitly configured local extractors.

## Search is weak

First confirm source coverage with `rgr audit`. Then try a specific query, `--context-radius 1`, or a higher `--top-k`. For semantic retrieval, install optional `@huggingface/transformers`, then run `rgr models pull --enable` followed by `rgr ingest --rebuild`.

## Search stops after updating Ragmir

Run `rgr upgrade --check` to see whether the active index predates the current schema or policy,
then run `rgr upgrade`. The new runtime refuses an incompatible index rather than returning unsafe
results, and the error points to this command. A required rebuild is written to an isolated
generation while the previous valid index remains untouched. Only a fully validated replacement
activates. If the process is interrupted, rerun the command to resume; do not delete
`.ragmir/storage/` first. A long-running host can keep its already loaded runtime serving during the
rebuild, then restart or cut over once the upgrade reports `status=current` and `ready=true`. Use
`rgr doctor --fix` for current-config setup repairs. Retired configuration fields require
`rgr upgrade` first.
`advisory=...` can accompany `status=current`: retrieval is compatible,
but a separate local security control still needs review. Run `rgr security-audit` for the exact
follow-up instead of deleting a healthy index.


## Old configuration is rejected

Run `rgr upgrade --check` then `rgr upgrade`. It backs up retired masking/profile/logging settings
and stages the required index rebuild. Source text is now preserved. See [migration](./migration.md).

## A security audit warning remains

`rgr security-audit --strict` exits with an error when warnings are present. Inspect the named file
permissions, Git exclusions, or external extractor. Warnings are separate from operational readiness.
OCR remains usable while its explicit external-process advisory is reported.

## Two workstations return different results

Compare source revisions, configured globs, package versions, model identity, and chunk settings.
Update sources through your normal Git workflow, then run `rgr ingest` on each machine. Use
`rgr audit` to check live coverage. Keep each actively written index local to its workstation.

## An environment override is rejected

Correct or remove the variable named in the error. Unknown JSON keys and invalid bounds are errors,
so a typo never silently selects a different behavior.
