# Private Dogfooding Protocol

Use this protocol to complete real Mimir dogfooding without committing client documents, private
paths, prospect names, contracts, invoices, screenshots, transcripts, or raw retrieval output.

This is the evidence path for the plan items that cannot be proven with synthetic fixtures:

- real-agent MCP use against a private brief;
- mixed-corpus ingestion with PDF, DOCX, XLSX, and meeting notes;
- semantic recall quality on natural-language questions;
- weekly usage proof for a real client project.

## Scope

Run the protocol in the private target repository or workspace, not in `jcode-mimir`, unless the
target workspace is synthetic and safe to commit.

Required private workspace shape:

```plain text
client-workspace/
  private/          # real source documents, ignored by Git
  .kb/              # local config and generated index, ignored by Git
  .mimir/           # agent helpers, reports, and local notes, ignored by Git
```

Before indexing, verify that the private workspace ignores generated and raw state:

```bash
pnpm exec mimir setup --no-ingest
git check-ignore private .kb .mimir
pnpm exec mimir security-audit --strict
```

Do not continue if `private/`, `.kb/`, or `.mimir/` are not ignored.

## Corpus Mix

Use a representative but bounded corpus:

| Document type | Minimum proof |
| --- | --- |
| PDF | One text PDF and, if relevant, one scanned PDF with explicit OCR decision. |
| DOCX | One document with headings, paragraphs, and at least one table. |
| XLSX | One workbook with multiple sheets or empty columns. |
| Meeting notes | One Markdown, text, or exported note file. |
| Optional extras | Only include formats the current project actually uses. |

Record only aggregate counts in the public repo. Keep filenames, customer names, exact topics, and
raw passages in the private ledger.

## Ingest And Audit

From the private workspace root:

```bash
pnpm exec mimir models pull --enable
pnpm exec mimir ingest --rebuild --json > .mimir/dogfood-ingest.json
pnpm exec mimir audit --json > .mimir/dogfood-audit.json
pnpm exec mimir audit --unsupported --json > .mimir/dogfood-unsupported.json
pnpm exec mimir doctor --json > .mimir/dogfood-doctor.json
pnpm exec mimir security-audit --strict --json > .mimir/dogfood-security.json
```

The JSON files stay inside `.mimir/` and must not be committed. If a command fails, keep the full
output private and copy only a sanitized summary to `docs/dogfooding-frictions.md`.

## MCP Agent Proof

Install only the agent you are testing:

```bash
pnpm exec mimir install-agent --agents claude
claude mcp add-json --scope local mimir "$(cat .mimir/claude-mcp-server.json)"
```

For Codex or another MCP client, use the matching generated helper from `.mimir/` and keep the scope
project-local.

For Cursor or an MCP client without a dedicated Mimir helper, start from `.mimir/mcp.json` and adapt
only the client-specific wrapper outside the public repo. Keep the command pointed at
`mimir serve-mcp` for the private workspace.

Run the agent against the private corpus with a prompt like:

```plain text
Use Mimir only for local evidence. First call mimir_status and mimir_audit. Then answer three
specific questions about this dossier with citations. If the local index does not contain enough
evidence, say so instead of guessing.
```

Record whether the agent:

- found the MCP tools without manual path edits;
- called `mimir_status` and `mimir_audit` before answering;
- returned useful citations;
- exposed any confusing UX around setup, stale indexes, unsupported files, or model preload;
- avoided hallucinating when retrieval was weak.

Do not copy raw agent answers into the public repository.

## Recall Check

Prepare a private set of 8 to 12 natural-language questions. Include:

- direct fact lookup;
- cross-document comparison;
- date or obligation lookup;
- missing-evidence question where the correct answer is "not enough evidence";
- at least one question that should retrieve from DOCX/XLSX/PDF rather than plain Markdown.

For each question, record privately:

| Field | Meaning |
| --- | --- |
| Question ID | Stable local ID, not the raw question if sensitive. |
| Expected source | Private filename or note link, kept out of Git. |
| `search` hit | Whether `mimir search` returned the expected source in top 3 / top 8. |
| `ask` citation | Whether `mimir ask` returned a useful cited passage. |
| Agent result | Pass, partial, fail, or refused due to missing evidence. |
| Friction | Sanitized summary only. |

Public summary format:

```plain text
Private corpus recall run, YYYY-MM-DD:
- corpus: 23 files; PDF 8, DOCX 4, XLSX 3, notes 8
- unsupported: 2 files, both expected proprietary binaries
- top-3 source recall: 7/10
- top-8 source recall: 9/10
- agent citation pass: 8/10
- main frictions: scanned PDF OCR setup, one spreadsheet sheet name lost
```

## Weekly Usage Proof

For A1, record a weekly private note with:

- date;
- private project identifier;
- number of Mimir searches / asks;
- whether the answer changed a real decision or saved time;
- blockers encountered;
- sanitized follow-up to add to `docs/dogfooding-frictions.md`.

Only aggregate weekly status should be reflected in the public repo.

## Public Update Rules

Safe to commit:

- aggregate counts;
- pass/partial/fail counts;
- unsupported extension categories;
- sanitized product frictions;
- new tests using synthetic fixtures that reproduce the issue.

Never commit:

- raw documents;
- raw retrieved passages;
- client, prospect, company, matter, invoice, or contract names;
- exact private paths;
- screenshots of private documents or agent answers;
- generated `.kb/`, `.mimir/`, audio, reports, or vector stores.
