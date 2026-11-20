---
name: ragmir-wiki
description: Maintain a Markdown knowledge base, an LLM wiki, on top of Ragmir as its evidence layer. Compile raw sources into cited pages with front matter sources, find the pages that already cover a topic, link pages with wikilinks, and lint the wiki with rgr audit --knowledge for broken links, missing pages, changed citations, and stale sources. Use when an agent writes or updates pages from documents, keeps a project wiki current, or asks what changed since its last pass.
license: AGPL-3.0-only
---

# Maintain a knowledge base with Ragmir

The agent writes the pages; Ragmir keeps them honest. Raw sources stay untouched and indexed,
the wiki pages are ordinary Markdown in the repository, and every claim in a page cites a
passage Ragmir can expand. Ragmir never writes a page: it searches, cites, lists, and audits.

## Layout

- `raw/` holds the sources as received: exports, transcripts, specifications, PDFs. Never edit
  them; replace a file when a new version arrives.
- `wiki/` holds the pages the agent maintains, one topic per page, Markdown with front matter.
- Index both folders (`rgr sources add "raw/**" "wiki/**"`, then `rgr ingest`). A scope keeps the
  two apart in searches:

```json
{
  "scopes": [
    { "name": "wiki", "includePaths": ["wiki"], "description": "Pages the agent maintains" },
    { "name": "raw", "includePaths": ["raw"], "description": "Sources as received", "searchByDefault": false }
  ]
}
```

## Compile a source into pages

1. Read the source with `ragmir_expand`, following `nextCitation` to the end, or list it with
   `ragmir_sources` and `outline: true` to read section by section.
2. Find the pages that already cover its topics: `ragmir_search` with the source's main titles as
   `queries` and `scope: "wiki"`. Update a page before creating a new one.
3. Write or update the page. Cite every claim with the citation `ragmir_search` returned, such as
   `raw/incident-42.md:L12-L18#3`, and record what the page was written from:

```markdown
---
title: Payment retries
summary: How failed payments are retried and when they stop.
sources:
  - citation: raw/incident-42.md:L12-L18#3
    evidence: 4b1e...
  - path: raw/vendor-sla.pdf
    sha256: 9f2c...
---
# Payment retries

Retries back off 2, 4, then 8 minutes (raw/incident-42.md:L12-L18#3). See [[Chargebacks]].
```

   `evidence` is the `evidence.id` of the search result; `sha256` is the source's checksum when
   the page draws on a whole file. Link related pages with `[[wikilinks]]` or relative links.
4. Run `rgr ingest`, then `rgr audit --knowledge`, and fix what it reports.

A link is navigation, never evidence: support each claim with a citation, not with the page it
links to. Judge contradictions and outdated claims yourself, from the cited passages.

## Lint the wiki

`rgr audit --knowledge --path wiki` (or `ragmir_audit` with `knowledge: true`) reports, without
changing anything:

| Finding | Fix |
| --- | --- |
| `brokenLinks` | Point the link at `suggestion` when one is given, or remove it. |
| `missingPages` | Write the most referenced missing pages, or unlink them. |
| `unlinkedPages` | Link the page from a related page or from an index page. |
| `duplicateTitles` | Merge the pages, or retitle one. |
| `brokenCitations` | Search again and cite the passage as it reads now. |
| `stalePages` | Re-read the changed sources and update the page and its `sha256`. |
| `lostSources` | Find the sources again, or mark the page obsolete. |

Before deleting a page, `rgr audit --knowledge --assume-removed wiki/old-page.md` lists the links
the removal would break and the pages it would leave unlinked.

## Keep up with new sources

At the start of a session, `ragmir_sources` with `changedSince` set to the end of the last
session lists the sources added, edited, or removed since then: compile those first. In CI, the
same call summarises what changed in the documentation since the last run.

## Navigate

`ragmir_expand` on a page's citation returns its outgoing links (broken ones with `path: null`)
and the pages linking to it, each with a citation to expand. `ragmir_sources` lists each page's
`title` and `description` (or `summary`) from its front matter, the index a reader browses.

Optional conventions such as an `index.md` that lists every page, or a `log.md` of what was
compiled when, work as ordinary pages: Ragmir indexes and audits them like the others.
