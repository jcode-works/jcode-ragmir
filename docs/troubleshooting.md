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
content-addressed cache entries. Use `rgr ingest --json` or `rgr preview --json` to inspect OCR cache
hits, batches, subprocesses, and duration without exposing page text in diagnostics. Images and
legacy `.doc` files need explicitly configured local extractors.

## Search is weak

First confirm source coverage with `rgr audit`. Then try a specific query, `--context-radius 1`, or a higher `--top-k`. For semantic retrieval, run `rgr models pull --enable` followed by `rgr ingest --rebuild`.

## Team members get different results

For a Git-backed repository, start with the single safe path:

```bash
rgr team sync --json
```

`current` and `updated` mean the fetched upstream and local index are aligned. `dirty`, `ahead`,
`diverged`, `detached`, and `no-upstream` never modify the branch; follow the first
`recommendedActions` item through the normal Git or merge-request workflow. `fetch-failed` keeps
the last valid local index, but its upstream freshness is unverified. Use `--no-pull` when branch
updates must remain manual and `--check` for a no-worktree-change preview.

The active `.ragmir/config.json` is intentionally local and ignored. If results still differ after
Git is current, verify that both workstations use the same reviewed source-contract template and
Ragmir version. For an exact diagnosis or a non-Git authority, use the advanced snapshot flow:

```bash
rgr team snapshot --label local --output .ragmir/team/local.json
rgr team compare .ragmir/team/local.json --local-label peer
```

The comparison names configuration drift plus local-only, peer-only, and changed files. Do not pick
the side with more files automatically. Confirm the declared Drive revision, shared folder, or Git
commit, apply the recommended ingest or rebuild command, and compare fresh snapshots. Never share
an actively written `.ragmir/storage/` directory.

If the comparison reports `status=synchronized` together with security advisories, the indexed
bytes and operational configuration match. Review each side with `rgr security-audit`; do not run a
repair or rebuild only because an extractor or permission advisory remains. Ragmir also interprets
v2.19.0 through v2.19.2 snapshots from their stored health fields, so an older snapshot that marked
an advisory as `ready=false` can still be compared after upgrading.

The lower-level `corpusFingerprint` in `rgr status --json` remains a quick equality signal. A
different value identifies divergence, not which machine is correct.
If an index created before corpus fingerprints were introduced reports `null`, run `rgr ingest`
once with the current Ragmir version to write the fingerprint into its local manifest.

## Search stops after updating Ragmir

Run `rgr upgrade --check` to see whether the active index predates the current schema or policy,
then run `rgr upgrade`. The new runtime refuses an incompatible index rather than returning unsafe
results, and the error points to this command. A required rebuild is written to an isolated
generation while the previous valid index remains untouched. Only a fully validated replacement
activates. If the process is interrupted, rerun the command to resume; do not delete
`.ragmir/storage/` first. A long-running host can keep its already loaded runtime serving during the
rebuild, then restart or cut over once the upgrade reports `status=current` and `ready=true`. Use
`rgr doctor --fix` for the same repair flow when setup or agent helpers also need attention.
`privacyCompliant=false` and `advisory=...` can accompany `status=current`: retrieval is compatible,
but a separate local security control still needs review. Run `rgr security-audit` for the exact
follow-up instead of deleting a healthy index.

## Strict audit fails

Run `rgr security-audit --strict`. It reports the exact local control that conflicts with the strict profile. Strict mode requires ignored local state, redaction, bounded MCP output, and no external extractors.

The audit also reports tracked private paths and local extractor authority. Move tracked private
data out of Git, add the containing path to `.gitignore`, and rotate any credential that reached a
remote. External extractors run with the current operator's filesystem and process permissions;
strict privacy disables them.

## Configuration rejects a regex or environment variable

Custom redaction expressions that are invalid or may cause catastrophic backtracking are rejected
before content processing. Replace nested or ambiguous repetition with bounded, linear patterns.
Invalid `RAGMIR_*` values now name the failing variable instead of silently falling back; correct or
unset the override and rerun the command.

## Chat or audio is not ready

Run `rgr chat doctor` or `rgr audio --doctor`. Setup commands download optional public model files explicitly; normal offline use requires those files to be present already. See the dedicated local chat and TTS guides for model preparation.
