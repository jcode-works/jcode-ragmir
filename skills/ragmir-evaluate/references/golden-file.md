# Golden file reference

`rgr evaluate --golden <file>` reads a JSON file: either an array of cases, or an object that wraps
the cases with run-wide settings. Unknown fields are errors, so a typo never changes a run
silently.

## Wrapped file

| Field | Type | Meaning |
| --- | --- | --- |
| `queries` | array, 1 to 1,000 cases | The cases. Required. |
| `topK` | integer, default 3 | Passages evaluated per case. `--top-k` overrides it, and a case's own `topK` overrides both. |
| `thresholds` | object | Quality gates; a run fails when one is not met. |
| `minimumCasesForVerification` | integer, default 100 | Cases a passing suite needs before its report is stored as verified. |

## Case

| Field | Type | Meaning |
| --- | --- | --- |
| `query` | string, up to 20,000 characters | The question, as a user asks it. Required. |
| `id` | string | Stable name shown in reports. |
| `expectedPaths` | array of paths | Project-relative files with forward slashes; any of them in the top `topK` is a hit. |
| `expectedCitations` | array of citations | Exact citations such as `docs/runbook.md:L12-L18#3`, copied from `rgr search --json`. When present, a case needs the exact citation to count as a hit. |
| `relevanceJudgments` | array | Graded relevance: `{ "kind": "path" or "citation", "value": "...", "relevance": 0 to 3 }`. Overrides `expectedPaths` or `expectedCitations` of the same kind and feeds nDCG. |
| `answerable` | boolean, default `true` | `false` marks a hard negative: the correct result is no passage at all. It cannot declare relevant evidence. |
| `category` | string | Groups results in the report, such as `process` or `negative`. |
| `locale` | string | Groups results by language, such as `fr`. |
| `topK` | integer | This case's passage count. |
| `includePaths`, `excludePaths` | arrays, up to 20 | Search filters for this case: folders, files, or globs. |
| `contextPaths` | array, up to 20 | Structural context filters, such as `"Guide > Migration"`. |
| `maximumVectorDistance` | number | Drops passages farther than this vector distance before scoring. |

An answerable case needs at least one expected path, expected citation, or positive relevance
judgment. Each case accepts up to 100 expected values of up to 500 characters. The file is
limited to 16 MiB.

Exact citations include the chunk number, so they change when the cited file is edited. Use them
for the facts that must be cited precisely, and paths for the rest.

## Thresholds

| Key | Gate |
| --- | --- |
| `recallAt1`, `recallAt3`, `recallAt5`, `recallAt10` | Minimum share of relevant evidence found in the top 1, 3, 5, or 10 |
| `precisionAt5` | Minimum share of relevant passages in the top 5 |
| `meanReciprocalRankAt10` | Minimum mean of 1 / rank of the first relevant passage |
| `ndcgAt10` | Minimum graded ranking quality |
| `exactCitationRate` | Minimum share of exact-citation cases whose citation was returned |
| `maximumFalsePositiveRate` | Maximum share of hard negatives that returned a passage |

All values are between 0 and 1. `--fail-under <recall>` adds a legacy average-recall gate.

## Report

`--json` prints the run settings (provider, model, revision, retrieval profile, document cap), the
fingerprints of the ranking policy, index, and golden file, every metric, `gates` with each
threshold's actual value, `passed`, `groups` by category and locale, latency percentiles, and one
entry per case with its returned paths and citations, matches, rank, and abstention.

Reference: https://github.com/jcode-works/ragmir/blob/main/docs/cli-reference.md
