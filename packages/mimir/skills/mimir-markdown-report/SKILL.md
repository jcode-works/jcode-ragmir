---
name: mimir-markdown-report
description: >-
  Create a cited Markdown report from a Mimir local knowledge base. Use when the user asks for a
  report, dossier, audit memo, planning note, evidence summary, or Markdown deliverable grounded in
  private repository documents indexed by Mimir.
---

# Mimir Markdown Report

Use this skill to write a Markdown report from local Mimir evidence without leaking raw documents.
Generated reports are derived artifacts and should stay local unless the user explicitly decides a
sanitized report is safe to commit or share.

## Confidentiality Rules

- Treat source documents, retrieved passages, notes, drafts, and generated reports as sensitive.
- Prefer writing reports under `.mimir/reports/`, which is ignored by Git when Mimir is installed.
- Do not commit generated reports by default.
- Do not paste long raw passages into the report. Use summaries, short cited extracts when needed,
  and source references.
- Separate proven facts, inference, uncertainty, and missing evidence.
- For legal, tax, medical, immigration, financial, or compliance reports, include a professional
  review section instead of presenting the report as final advice.

## 1. Verify The Knowledge Base

From the repository root:

```bash
pnpm exec kb doctor
pnpm exec kb audit
pnpm exec kb security-audit
```

If files are missing, stale, or setup is incomplete:

```bash
pnpm exec kb doctor --fix
pnpm exec kb audit --unsupported
```

Do not write a final report from stale evidence unless the user explicitly accepts that limitation.

## 2. Build An Evidence Plan

For a broad report, use multiple targeted retrieval passes instead of one generic query:

```bash
pnpm exec kb search "<main report topic>" --top-k 8
pnpm exec kb search "<people, dates, amounts, obligations, risks, decisions>" --top-k 8
pnpm exec kb ask "<specific synthesis question>" --top-k 8
```

When MCP is available, prefer `mimir_search`, `mimir_ask`, `mimir_audit`, and
`mimir_security_audit` over shell commands.

Keep a working note of source paths and chunk numbers for each claim you plan to include.

## 3. Write The Report

Default report structure:

```markdown
# <Report Title>

## Scope

## Executive Summary

## Evidence Inventory

## Findings

## Risks And Open Questions

## Recommended Next Actions

## Sources
```

Use tables only when they make comparisons easier. Keep each finding tied to one or more source
paths and chunk numbers when possible.

## 4. Save Locally

Create the report directory:

```bash
mkdir -p .mimir/reports
```

Write the report to:

```plain text
.mimir/reports/<subject-kebab>.md
```

If the user explicitly wants a tracked report, create a sanitized file outside `.mimir/` and state
which private details were excluded.

## 5. Report The Result

After writing the report, tell the user:

- the report path;
- whether the index was ready;
- how many source paths were used;
- any unsupported, stale, or missing files that weaken the report;
- whether the report is safe to commit or should remain local.
