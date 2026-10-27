# Configuration

Ragmir reads its configuration from the current directory or an ancestor. Start with `rgr setup`;
edit JSON only for a real need.

```json
{
  "name": "Payments platform",
  "description": "Specifications, ADRs, and code of the payments platform.",
  "sources": ["docs/**/*.md", "src", "!docs/archive/**"],
  "retrievalProfile": "balanced",
  "embeddingProvider": "local-hash"
}
```

Two files can hold it:

| File | Committed | Role |
| --- | --- | --- |
| `ragmir.config.json` | Yes | Team settings shared through Git: name, sources, scopes, ranking weights. |
| `.ragmir/config.json` | No (ignored) | Machine-local settings. Its top-level keys override the shared file. |

With only `ragmir.config.json`, CLI changes such as `rgr sources add` write to it and `rgr init`
does not create a local copy. With both files, CLI changes go to `.ragmir/config.json`. A local
`sources` array replaces the shared one as a whole, like every other key.

## Common fields

| Field | Default | Why change it |
| --- | --- | --- |
| `sources` | `[]` | Add project paths, globs, and `!` exclusions. |
| `retrievalProfile` | `balanced` | Use `fast`, `quality`, or `custom` for different search budgets. |
| `embeddingProvider` | `local-hash` | Set `transformers` only after an explicit preload. |
| `embeddingModel` | `intfloat/multilingual-e5-small` | Select the local Transformers embedding model. Rebuild after changing it. |
| `embeddingModelRevision` | Pinned commit for bundled profiles | Use an immutable 40-character commit for reproducible model artifacts. Unknown custom models default to the mutable `main` revision until explicitly pinned. |
| `embeddingModelDigest` | `null` | `rgr models pull --enable` records a SHA-256 identity for the resolved local artifact tree. Do not set it by hand unless the local files were verified independently. |
| `topK` | `8` | Change the CLI and TypeScript default, up to the hard limit of 100. MCP requests without `topK` start at the lower of this value and 3. |
| `maxChunksPerDocument` | `1` | Limit primary ranked passages from one document before final `topK` truncation, up to 100. Ranked backfill preserves the requested result count when the candidate set has too few documents. |
| `mcpMaxTopK` | `10` | Bound explicit MCP passage requests; values above 100 are rejected. |
| `mcpMaxOutputBytes` | `32768` | Cap variable-size MCP tool and resource JSON; the server also enforces an absolute 1 MiB ceiling. |
| `chunkSize` / `chunkOverlap` | `1200` / `200` | Tune chunking, then rebuild the index. Chunk size is capped at 1,000,000 characters. |
| `maxFileBytes` | `50000000` | Lower the per-file parser budget; 50 MB is the hard ceiling. |
| `ingestConcurrency` | `4` | Bound concurrent parsers; values above `8` are rejected. |
| `embeddingBatchSize` | `32` | Bound one model call; values above `128` are rejected. |
| `sourceFingerprintMode` | `fast` | Use `strict` to hash every source on every inventory instead of reusing unchanged private fingerprints. |
| `incrementalFailurePolicy` | `preserve-last-good` | Use `remove-stale` only when failed changed files must disappear immediately. |
| `hybridTextScanLimit` | `5000` | Set the batch size for the complete lexical scan used when FTS is unavailable; values above 10,000 are rejected. The fallback scans every matching chunk across as many batches as the corpus requires. |
| `workloadLimits` | See below | Bound active search, embedding, and ingestion work plus their queues and queue deadlines. |
| `includeExtensions` | `[]` | Add safe custom text extensions. |
| `name` | Folder name | Name agents see in MCP instructions, tool descriptions, and status. |
| `description` | `null` | One sentence on what the base answers, shown to agents. |
| `defaultExcludes` | `true` | Skip tool state, dependency caches, lockfiles, and minified bundles (see Sources). |
| `scopes` | `{}` | Named path filters that searches select with `scope` (see Scopes). |
| `sourceWeights` | `{}` | Ranking multipliers by glob, for example `{ "archive/**": 0.5 }`. |
| `pathPriors` | `true` | Built-in mild demotion of tests and snapshots (see Ranking). |
| `collapseLocaleVariants` | `true` | Give translations of one file (`fr.json`, `en.json`, `docs/fr/...`) one result slot. |
| `maxChunksPerDataFile` | `null` | Keep a bounded sample of large JSON, CSV, log, and spreadsheet files. Rebuild after changing it. |
| `mcpAllowedRoots` | `[]` | Workspaces allowed to use this base over MCP. Empty warns instead of refusing. |
| `mcpSeenResults` | `collapse` | MCP repeats: `collapse` to short stubs, `exclude`, or `include` in full. |
| `mcpAutoIngest` | `false` | Start one background incremental ingest when MCP results cite changed files. |

Configuration arrays and strings have hard size ceilings. Sources are capped at 10,000 entries,
custom extensions at 128, and external commands at 128 arguments.
`mcpMaxOutputBytes` cannot exceed 1 MiB. Invalid environment overrides fail configuration loading
with the variable name instead of silently reverting to a different value.

### Workload admission

Ragmir keeps independent process-local queues per project root. Search defaults to 8 active and 64
queued operations, embedding to 1 active and 64 queued operations, and ingestion to 1 active and 4
queued operations. Search and embedding wait at most 30 seconds in their queue; ingestion waits at
most 120 seconds. Each workload accepts `concurrency`, `maxQueue`, and `queueTimeoutMs` under
`workloadLimits.search`, `.embedding`, or `.ingestion`.

Concurrency is capped at 16, queue length at 1,000, and queue time at 900,000 ms. A full queue
returns the retryable `OVERLOADED` error. An expired queue entry returns retryable `TIMEOUT`, and an
aborted entry never starts. `explain: true` exposes `workloadQueueMs` on every returned search score.
The defaults come from the 100-request XS scorecard: search concurrency 8 kept throughput and p95
within measurement noise while reducing Transformers peak RSS. Change these limits only after a
representative concurrency benchmark.

### Retrieval profiles and ranking policy

Profiles bound retrieval work. They are candidate and diversification budgets, not a guarantee that
a larger budget improves every corpus. Evaluate the profile against a representative golden set
before changing production configuration. An explicit `topK` or `hybridTextScanLimit` overrides the
profile value. `rgr setup` leaves both unset; configs created by earlier versions contain the
`balanced` values, so remove them when a profile should choose.

| Profile | Quality intent | Latency intent | Default `topK` | Fallback batch size | Vector candidates | FTS candidates | Document cap | Context radius |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `fast` | Narrow, diverse evidence | Lowest work budget | 5 | 2,000 | `depth` | `depth` | configured, default 1 | 0 |
| `balanced` | General-purpose evidence | Default work budget | 8 | 5,000 | 1.25 x `depth` | 1.25 x `depth` | configured, default 1 | 0 |
| `quality` | Broader multi-section evidence | Highest work budget | 12 | 10,000 | 1.5 x `depth` | 1.5 x `depth` | configured, default 1 | 1 |
| `custom` | Golden-set validated | Operator-defined | configured | configured | 1.25 x `depth` | 1.25 x `depth` | configured, default 1 | 0 |

`demand` is `topK * ceil(4 / maxChunksPerDocument)`, with a minimum multiplier of one. This internal
over-retrieval gives the diversity pass enough lower-ranked documents before final truncation.
`depth` is `60 + 2 x demand`, rounded up after the profile margin. With reciprocal-rank fusion at
`k = 60`, a passage outside that depth in every candidate list cannot outrank the `demand`-th fused
passage, so deeper pools only add reads. For example, `topK = 10` with the default document cap
retrieves 210 vector and 210 FTS candidates in the `quality` profile. Vector candidates are capped
at 1,000 and FTS candidates at 4,000, independently from the complete-scan batch size. Exact file
paths use a bounded scalar variant. Controlled exact-phrase, identifier, and fuzzy rare-term queries
expand only a primary pool that cannot fill the demand, preserving established ranks. A query
identifier with a digit, underscore, or dot, such as `AUTH_REDIRECT_ORIGIN_X17`, must match exactly;
a hyphen-only word such as "T-score" or the French "est-elle" only boosts the passages that contain
it, so natural-language questions keep their keyword matches.

The full-text index covers each passage's structural context, cited header text, and body, plus its
relative source path and the parts of camelCase, PascalCase, acronym, and letter-digit identifiers.
A question about "login attempts" can therefore reach `LoginAttemptService.java`, while embeddings
keep using the passage text without these keyword terms. Ragmir folds case, accents, and other
diacritics in this text exactly as it folds query terms, then the LanceDB analyzer applies English
stemming and removes English stop words. Folding first keeps "Réfraction" and "refraction" on the
same indexed term, because the analyzer stems words before it folds their accents.

After scoring and abstention, the deterministic diversity pass keeps at most
`maxChunksPerDocument` primary passages per relative path while preserving rank order. It then
backfills ranked, non-duplicate, non-overlapping chunks only when too few documents or candidates
remain to fill `topK`. Neighbor chunks requested through `contextRadius` are attached afterward and
do not consume the primary document cap. MMR is not part of the default policy: pairwise similarity
adds more work and corpus-dependent ordering, and the current golden benchmark does not show an
advantage over the simple cap default. It can be evaluated later as an explicit opt-in strategy
without changing this predictable default.

Hybrid ranking uses deterministic reciprocal-rank fusion with `k = 60`. Transformers vectors and
full-text results have equal weights. The `local-hash` vector is a hashed lexical signal without
inverse document frequency, so it receives a weight of 0.01: BM25 evidence leads, and hashed
vectors only break ties or append passages that the full-text index did not return. On three code
and documentation corpora, this raised local-hash nDCG@10 by 1% to 35% compared with equal weights.
Stable source and chunk keys break score ties before ranks are assigned. The active provider,
profile, document cap, and ranking parameters form a policy fingerprint stored in quality reports
and exposed by score explanations.

Abstention is provider- and model-aware. With a current keyword index, Ragmir counts how many
passages contain each query word and weighs the words by inverse document frequency, so a
distinctive word counts more than a common one:

- When no query word occurs in the corpus at all, not even as a typo that a fuzzy keyword query
  still matches, only a strong vector match can support a passage. Nonsense and unrelated
  questions then return nothing instead of the nearest noise. Words in scripts written without
  spaces (Thai, Chinese, Japanese, Korean) are not measured this way.
- `local-hash` otherwise requires lexical evidence and gives query identifiers precedence over
  coincidental section numbers.
- Calibrated Transformers models need a normalized L2 distance within the model's limit, or
  passages holding at least 30% of the question's IDF-weighted words. `multilingual-e5-small`
  packs every text into a narrow distance band and uses a limit of 0.4;
  `mxbai-embed-xsmall-v1` uses 1.1. Other models keep the previous rule: any related query word,
  or a distance up to 1.1.

Each result whose passage holds few of the question's distinctive words and has no strong vector
match carries `weakEvidence: true`. It is still returned; agents should verify it first. On a
French and English golden set over a Java and TypeScript monorepo, these rules kept every
answerable question's source, and with `mxbai-embed-xsmall-v1` they rejected 16 of 30 unrelated
questions instead of 3. Evaluate your own corpus with `rgr evaluate`.

Changing an embedding provider, model, revision, digest, or chunking field requires
`rgr ingest --rebuild`. Revision and artifact digest participate in the index, vector-index, and
quality-report fingerprints, so an index built from different weights is never treated as
compatible.
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

## Sources

`sources` lists folders, files, and globs relative to the project root. A leading `!` excludes.
`.ragmir/raw/` is always a source.

```json
{
  "sources": ["docs", "specs/**/*.{md,docx,pdf}", "src/**/*.ts", "!docs/archive/**"]
}
```

Paths behave the same on macOS, Linux, and Windows:

- Ragmir stores and cites every path with forward slashes and in Unicode NFC. A configured name
  such as `Études` matches a folder that an archive, a sync client, or an older Mac volume stored
  decomposed (NFD). Linux and Windows compare names byte for byte, so without this a rule typed on
  a keyboard silently missed those files.
- On case-insensitive volumes (default macOS and Windows), exclusions and includes ignore case,
  as the operating system and Git do there.
- Write forward slashes in shared configs. Search filters such as `--include-path docs\specs`
  accept backslashes on every platform.
- Two files whose names differ only by Unicode form, which Linux can hold, are reported as a
  `path-collision` instead of one silently shadowing the other.

`rgr audit` reports source rules that select nothing: missing folders, include globs that match no
indexable file, and exact `!path` exclusions that name no file. It also flags an excluded file whose
byte-identical copy is still indexed under another path, and absolute or backslash entries that
break on other machines.

With `defaultExcludes` (on by default), Ragmir skips agent and editor state (`.claude`, `.codex`,
`.agents`, `.cursor`, `.windsurf`, `.cline`, `.kimi`, `.opencode`, `.gitnexus`, `.idea`),
dependency and build caches (`.venv`, `__pycache__`, `.pnpm-store`, `.yarn`, `.gradle`,
`.terraform`, `.dart_tool`, `Pods`, `DerivedData`, `.next`, `.nuxt`, `.svelte-kit`, `.turbo`,
`.cache`, `.parcel-cache`, `.angular`, `.expo`, `bower_components`, `coverage`, `.nyc_output`,
`.mypy_cache`, `.pytest_cache`, `.ruff_cache`, `.tox`), lockfiles, source maps, and minified
bundles. A source entry that names one of these folders, such as `.claude/**/*.md`, still indexes
it. Set `defaultExcludes: false` to index everything the globs match.

## Scopes

Scopes name path filters that agents and scripts can select instead of repeating paths:

```json
{
  "scopes": {
    "docs": { "includePaths": ["docs", "README.md"], "description": "Product documentation" },
    "backend": { "includePaths": ["services/api"], "excludePaths": ["services/api/fixtures"] }
  }
}
```

`rgr search --scope docs`, `search(query, { scope: "docs" })`, and MCP `scope: "docs"` apply them.
A scope combines with explicit `includePaths` (both must match) and `excludePaths`. MCP
instructions and tool descriptions list the scope names and descriptions.

## Ranking weights, translations, and large data files

Ranking multiplies each candidate's fused score by:

- **Path priors** (`pathPriors: true`): tests (`*.test.*`, `*.spec.*`, `__tests__/`, `test/`,
  `tests/`, `*Test.java`, `*_test.go`, `test_*.py`, ...) by 0.85, snapshots by 0.7. Tests restate
  the code they cover; the prior only reorders close candidates.
- **Source weights**: each matching `sourceWeights` glob, for example
  `{ "archive/**": 0.5, "docs/adr/**": 1.2 }` (0 < weight <= 10). A pattern equal to a prior
  replaces it.
- **Code definitions**: a code passage that declares a class, interface, function, or method
  named after the question's words gains up to 20%, so "how are permissions checked" reaches the
  class that defines `PermissionService` before tests and notes that only mention it.

`collapseLocaleVariants` gives one result slot to the translations of one document:
`messages/fr.json` and `messages/en.json`, `locales/pt-BR/common.json`, `README.fr.md`,
`messages_fr.properties`, `values-fr/strings.xml`, or `fr.lproj/`. Bare two-letter folders only
count as languages under a translation folder (`locales/`, `i18n/`, `messages/`, ...), so `src/id/`
stays a normal folder.

When one file fills a quarter or more of the vector candidates and the pool reaches too few
documents, search runs a second vector pass without that file. An export or a log can then no
longer crowd out the other documents, and nothing is dropped from the index. To shrink such files
in the index itself, set `maxChunksPerDataFile`: Ragmir keeps the first half of the budget
(headers, schema, first records) and evenly spaced records from the rest of each large JSON,
JSONL, CSV, TSV, log, or spreadsheet file. `rgr audit` and `rgr doctor` warn when one file holds
more than a fifth of the index, or three files more than half.

## Semantic retrieval

Install the optional runtime first:

```bash
pnpm add -D @huggingface/transformers
rgr setup --semantic
rgr ingest --rebuild
```

This preloads the configured Transformers model once and leaves normal remote model loading disabled.
Use `rgr models pull --enable` for the same change after initial setup. Both commands download the
pinned revision into a private cache, install it under `embeddingModelPath` as the offline snapshot
that local loading reads, and persist the resolved immutable revision and artifact digest. Bundled
model profiles use pinned commits. Pin a custom model to a 40-character commit before relying on
reproducible search results; `main` remains mutable and therefore unverified.

`local-hash` never resolves Transformers.js, ONNX Runtime, or Sharp. In a long-running process,
Transformers pipelines are shared per exact model identity and disposed when the final
`RagmirClient` owner closes. Cache retirement waits for active inference leases, so a model switch
or shutdown does not dispose a session still serving a request.
Repeated single-query embeddings use a project-scoped, in-memory LRU cache tied to that model
identity, capped at 128 entries and 65,536 vector values. The cache retains hashed query keys and
vectors, never search results; each search still reads the current index generation. Every semantic
model call respects `embeddingBatchSize`, including callers that supply a larger input array.

## Local extractors

```bash
rgr ocr doctor
rgr ocr setup --language eng+fra --images --legacy-word
```

`rgr ocr doctor` reports the local engines it finds: OCRmyPDF or Tesseract with Poppler for scanned
PDFs, Tesseract for photos and scanned images (macOS also converts HEIC, HEIF, and AVIF through
`sips`), and textutil (macOS), antiword or catdoc (Linux), or LibreOffice (any platform) for
legacy Word `.doc` files. On Windows, Tesseract and LibreOffice are also found in their default
install folders when they are not on `PATH`. `rgr ocr setup` writes the scanned-PDF command;
`--images` and `--legacy-word` add Ragmir's built-in image and `.doc` extractors, and `--no-pdf`
leaves the PDF command unchanged. The written commands call the project runner by its relative path
(`node .ragmir/run.cjs ...`), so a committed config works on every clone and platform.

PDF OCR is optional and page-aware. Ragmir calls it only for blank extracted pages. Custom
`pdfOcrCommand`, `imageOcrCommand`, and `legacyWordCommand` values must be JSON argument arrays;
they run without a shell and must print text to stdout. They still execute with the operator's
filesystem and process authority. Their per-invocation timeout is capped at 900,000 ms.

`rgr ocr setup` writes the batched PDF contract. It replaces `{pages}` with up to 16 ordered page
numbers and expects JSON containing `subprocesses` plus an ordered `pages` array of `{ page, text }`
objects. Existing custom commands using `{page}` remain compatible and gain durable per-page cache,
but still launch once per missing page. Cache entries live under private `.ragmir/ocr-cache/` state
and are keyed by source checksum, page, engine and engine version, language, DPI, parser policy, and
command fingerprint. A changed source, executable, language, DPI, or parser policy cannot reuse stale
OCR text. `pdfOcrTimeoutMs` applies to one bounded batch.

## Environment overrides

Use `RAGMIR_*` variables for local experiments, for example:

```bash
RAGMIR_TOP_K=5 rgr search "migration"
RAGMIR_MCP_MAX_OUTPUT_BYTES=16384 rgr serve-mcp
```

Environment overrides cover selected runtime settings such as models, retrieval limits,
and extractor commands. Run `rgr status --json` to inspect the effective result.

`rgr security-audit` reports permission state plus Git-ignore and tracked-file state for the config,
raw documents, index storage, source list, and local model directory. Read-only status,
doctor, search, and audit operations do not create an absent index or change an existing shared
directory mode.

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

## Source fidelity and migration

Ragmir stores parsed source text without masking. The consuming application controls where passages
go. For confidential work, control its model endpoint, access, transport, and logs as well as the
index. See [local, self-hosted, and cloud integration](./agent-integration.md). Keep credentials
excluded at source selection. Retired redaction,
privacy-profile, and access-log fields require `rgr upgrade`; see [migration](./migration.md).
