---
name: ragmir-evaluate
description: Measure and improve the retrieval quality of a Ragmir index. Write a golden file of real questions with expected documents, exact citations, and unanswerable hard negatives, run rgr evaluate with quality gates, diagnose misses with rgr search --explain, and tune sources, ranking weights, the retrieval profile, chunking, or the embedding model. Use when Ragmir results look wrong, weak, or empty, before relying on a base, when comparing models or settings, or to add a retrieval-quality gate to CI.
license: AGPL-3.0-only
---

# Evaluate Ragmir retrieval

Retrieval quality depends on the corpus and on the questions people ask. Measure it on the
user's own questions, change one thing at a time, and keep a change only when the numbers say so.

## 1. Write a golden file

Collect 20 to 50 questions to start: real ones from users, tickets, or the agent's own sessions,
phrased the way people ask them rather than copied from headings. Mix exact identifiers,
paraphrases, questions whose answer spans several documents, and the languages people use. Add
hard negatives: plausible questions the documents do not answer, including near-domain ones that
share the vocabulary but miss the fact. Ragmir must return nothing for them.

```json
{
  "topK": 5,
  "thresholds": {
    "recallAt5": 0.8,
    "meanReciprocalRankAt10": 0.6,
    "maximumFalsePositiveRate": 0.2
  },
  "queries": [
    {
      "id": "release-approval",
      "query": "Who has to sign off before a production release?",
      "expectedPaths": ["docs/releases.md"],
      "category": "process"
    },
    {
      "id": "invoice-retention",
      "query": "How long do we keep invoices?",
      "relevanceJudgments": [
        { "kind": "path", "value": "policies/retention.pdf", "relevance": 3 },
        { "kind": "path", "value": "docs/finance-faq.md", "relevance": 1 }
      ]
    },
    {
      "id": "no-helm-chart",
      "query": "Which Helm chart deploys the billing API?",
      "answerable": false,
      "category": "negative"
    }
  ]
}
```

Commit it next to the configuration, for example as `ragmir.golden.json`, and exclude it from the
sources (`"!ragmir.golden.json"`) when a source glob would match it. Keep it under `.ragmir/`
instead when the questions themselves are confidential. Every field and limit is in
[golden-file.md](references/golden-file.md).

## 2. Run it

```bash
rgr evaluate --golden ragmir.golden.json
rgr evaluate --golden ragmir.golden.json --json > ragmir-evaluation.json
```

The first line summarizes the run: hit rate, Recall@1/3/5/10, Precision@5, MRR@10, nDCG@10, exact
citation rate, false-positive rate on hard negatives, `passed`, and p50 and p95 latency. Each case
follows with its rank; a miss lists the expected and returned citations. A failed threshold
prints `failedGate=<metric>` and exits with status 1, so the same command gates CI. The JSON report
adds per-category and per-locale `groups`, the `gates`, the fingerprints of the ranking policy,
index, and golden file, and `answerRateAt`: the share of answerable cases with a relevant passage
in the first 1, 3, 5, or 10 results.

A passing suite with at least 100 cases, graded relevance, exact citations, hard negatives, and
every threshold stores its report in the index: `rgr doctor --deep` then reports retrieval quality
as verified while the golden file, corpus, model, and ranking policy stay the same.

## 3. Diagnose each miss

1. Is the expected file indexed? Call `ragmir_sources` or run `rgr audit --unsupported`. It may be
   excluded, unsupported, too large, or a scanned PDF with no text (see OCR in the `ragmir-setup`
   skill).
2. Where did it rank? `rgr search "<query>" --explain --top-k 10` prints, per result, the fused
   score, `vectorRank` and `lexicalRank`, `matchedTerms`, the document cap, and backfill. A file
   absent from both ranks lacks the question's words and a close vector.
3. Does a chunk hold the answer? `rgr preview --path <file> --json` shows how the file was split
   and the citation each chunk gets.

| Cause | Lever |
| --- | --- |
| The file is not indexed | Add a source glob; enable OCR for scanned files. |
| Archives, exports, or tests outrank the source of truth | `sourceWeights`, such as `{ "archive/**": 0.5, "docs/adr/**": 1.2 }`, or a `!` exclusion. |
| One large data file crowds the results | `rgr audit` reports concentration; exclude it or set `maxChunksPerDataFile`. |
| Paraphrases or other languages miss | A semantic model: `rgr models list`, then `rgr setup --semantic` after approval. |
| The answer spans sections of one file | `maxChunksPerDocument` 2 or 3, `contextRadius` 1, or `retrievalProfile: "quality"`. |
| A fact is split across chunk boundaries | Larger `chunkSize` or `chunkOverlap`. |
| Hard negatives return passages | Narrow the sources or scopes; compare `local-hash` with a semantic model, whose abstention is calibrated per model. |
| Questions target one area | A named `scope`, or a nested base for that app. |

## 4. Tune one change at a time

1. Run the golden file and keep the JSON report as the baseline:
   `rgr evaluate --golden ragmir.golden.json --json > baseline.json`.
2. Change one setting in `ragmir.config.json`. Run `rgr ingest`: it stages and validates a rebuild
   when the change requires one, while the previous index keeps serving.
3. Run `rgr evaluate --golden ragmir.golden.json --baseline baseline.json`. It prints each metric
   before and after with the signed change, then the changes per category, and lists the
   settings that differ between the runs. Keep the change only if it improves them without new
   false positives.

To see what each channel contributes, run `rgr evaluate --golden ragmir.golden.json --retriever
lexical` or `--retriever vector`. A one-channel run is a diagnostic: it never stores a verified
quality report.

Never edit expectations or lower thresholds to make a change pass, and never add the golden
questions' wording to the documents. Report the baseline, each change, and its measured effect.

## CI gate

```yaml
- run: npx rgr ingest
- run: npx rgr evaluate --golden ragmir.golden.json
```

Pin the Ragmir version in the project's lockfile so CI measures the same engine as development.
