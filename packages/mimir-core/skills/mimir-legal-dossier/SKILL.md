---
name: mimir-legal-dossier
description: >-
  Prepare cited legal-dossier work products from a local Mimir knowledge base. Use when the user asks
  for a legal chronology, clause search, dossier summary, evidence table, redaction review, or
  professional-review handoff grounded in confidential local documents.
---

# Mimir Legal Dossier

Use this skill for legal or quasi-legal dossiers where confidentiality, evidence separation, and
professional review matter. This skill does not provide final legal advice. It prepares structured,
cited work products for review by the user or a qualified professional.

## Safety Rules

- Treat source documents, retrieved passages, party names, dates, amounts, identifiers, and draft
  outputs as confidential.
- Keep generated work under `.mimir/reports/` unless the user explicitly asks for a sanitized
  tracked artifact.
- Do not upload documents, snippets, queries, vector stores, or generated drafts to hosted services.
- Do not present conclusions as legal advice. Separate evidence, inference, uncertainty, and review
  items.
- Prefer short cited summaries over long raw extracts.
- Flag missing documents, unsupported files, stale indexes, and ambiguous source passages.

## Recommended Redaction Patterns

If a legal dossier includes professional secrecy, case identifiers, or French personal identifiers,
add project-local redaction patterns in `.mimir/config.json` before indexing. Keep patterns scoped to the
dossier and test them on non-sensitive samples first.

```json
{
  "redaction": {
    "enabled": true,
    "builtIn": true,
    "patterns": [
      {
        "name": "case_reference",
        "pattern": "\\b(?:RG|N°\\s*RG|No\\s*RG)\\s*[:\\-]?\\s*[0-9A-Z/\\-]{4,}\\b",
        "replacement": "[CASE_REFERENCE]"
      },
      {
        "name": "french_nir",
        "pattern": "\\b[12]\\s?\\d{2}\\s?\\d{2}\\s?\\d{2}\\s?\\d{3}\\s?\\d{3}\\s?\\d{2}\\b",
        "replacement": "[FRENCH_NIR]"
      },
      {
        "name": "iban",
        "pattern": "\\b[A-Z]{2}\\d{2}(?:\\s?[A-Z0-9]){11,30}\\b",
        "replacement": "[IBAN]"
      }
    ]
  }
}
```

After changing redaction rules, rebuild the index:

```bash
pnpm exec mimir ingest --rebuild
pnpm exec mimir security-audit --strict
```

## Retrieval Workflow

Start from readiness checks:

```bash
pnpm exec mimir doctor
pnpm exec mimir audit
pnpm exec mimir audit --unsupported
pnpm exec mimir security-audit --strict
```

Then run targeted retrieval passes:

```bash
pnpm exec mimir search "parties obligations dates amounts" --top-k 8
pnpm exec mimir search "termination clause liability indemnity notice" --top-k 8
pnpm exec mimir search "timeline meeting decision approval refusal" --top-k 8
pnpm exec mimir ask "Which documents support the chronology of events?" --top-k 8
```

When MCP is available, prefer `mimir_status`, `mimir_search`, `mimir_ask`, `mimir_audit`, and
`mimir_security_audit` so the agent can keep retrieval bounded and cited.

## Output Formats

### Dossier Summary

```markdown
# Legal Dossier Summary

## Scope

## Evidence Inventory

## Key Facts

## Main Legal Or Contractual Questions

## Risks And Unknowns

## Professional Review Items

## Sources
```

### Chronology

```markdown
| Date | Event | Evidence | Confidence | Review item |
| --- | --- | --- | --- | --- |
| YYYY-MM-DD |  | source.md chunk=0 | High/Medium/Low |  |
```

### Clause Review

```markdown
| Clause topic | Source | Extract summary | Risk | Follow-up |
| --- | --- | --- | --- | --- |
| Termination | contract.docx chunk=3 |  |  |  |
```

### Evidence Gap List

```markdown
| Missing or weak evidence | Why it matters | Suggested next document |
| --- | --- | --- |
|  |  |  |
```

## Final Response Checklist

Before handing back the work:

- state where the report was saved;
- list source paths used, not private full passages;
- mention unsupported, stale, or missing files;
- include a professional-review section;
- state whether the artifact is safe to commit or must remain local.
