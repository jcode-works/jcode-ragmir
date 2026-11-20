# ragmir

**Agentic RAG on your infrastructure, with exact citations, for Python agents and RAG apps.**

[Ragmir](https://ragmir.com) indexes a project's code, PDFs, Office files, scans, mail, and design
files on your machine, and returns passages cited to lines, pages, slides, cells, or objects. A
question the documents cannot answer returns nothing, so your application can say so instead of
guessing.

- **Any model:** the index does not depend on the LLM that writes the answer, so you can switch
  between Claude, GPT, Gemini, Mistral, or a local model without re-indexing.
- **No GPU, no vector database:** the default retrieval runs offline on the CPU, and the index is an
  embedded store in the project's git-ignored `.ragmir/` folder.
- **Your data stays where you run it:** no account, telemetry, or hosted store.
- **Measured:** `rgr evaluate` scores retrieval on your own questions and fails CI when it regresses.

```bash
pip install ragmir
```

Requires Python 3.11 or later. Ragmir itself runs through Node.js 22.12 or later, or Docker, on
macOS, Windows, or Linux; the default retrieval needs no model, and the [system
requirements](https://github.com/jcode-works/ragmir#system-requirements) list what semantic models
and OCR add. The client uses the project's own npm
install of `@jcode.labs/ragmir` when there is one, else a global `rgr`, else the matching npm
release through `npx`, else the `ghcr.io/jcode-works/ragmir` image. Set `RAGMIR_COMMAND` to choose
another command.

## Index a project and search it

```python
from ragmir import Ragmir, add_sources, init_project

init_project("my-project")
add_sources("my-project", ["docs/**/*.md", "contracts/**/*.pdf"])

with Ragmir("my-project") as rag:
    rag.ingest()  # incremental: only new and changed files are read again
    for passage in rag.search("termination notice period", top_k=3):
        print(passage.citation, passage.weak_evidence)
        print(passage.text)
```

`Ragmir` keeps one MCP server running for the project and reuses it for every call. It works from
any thread, a notebook, or a web framework, and each method has an async twin (`asearch`,
`aexpand`, `asources`, `aknowledge_audit`, `aingest`, and so on). Asyncio services can use
`AsyncRagmir` directly.

- `search(query, top_k=, include_paths=, exclude_paths=, scope=, searches=)` returns `Passage`
  objects with `citation`, `path`, `text`, line or page ranges, `weak_evidence`, and
  `source_status`. Path filters take folders, files, or globs such as `"**/*.pdf"`. `searches` adds
  up to five of your own formulations, fused into one ranking: `lex` keywords (`"phrase"` required,
  `-word` excluded), a `vec` paraphrase, or a `hyde` likely answer.
- `search_many(queries)` answers up to five related questions in one call.
- `expand(citation, context_radius=1)` returns the passage with its neighbours; expand
  `next_citation` to read a long document through. A citation the index no longer holds comes back
  with `suggested_citation` or `similar_paths`, and a Markdown page with its `links`.
- `sources(paths=["contracts/**"])` lists the indexed documents with their front matter titles;
  `changed_since=` adds the files changed since a time, and `outline=True` one document's sections.
- `status()` and `audit()` report readiness and coverage; `knowledge_audit()` checks Markdown pages
  as a knowledge base: broken links, missing pages, changed citations, and stale sources.
- `run_cli(project, "doctor")` runs any `rgr` command, for example an ingest with local OCR, which
  Ragmir leaves to an explicit operator command.

## LangChain and LlamaIndex

- [`langchain-ragmir`](https://pypi.org/project/langchain-ragmir/): a retriever and agent tools.
- [`llama-index-retrievers-ragmir`](https://pypi.org/project/llama-index-retrievers-ragmir/): a
  LlamaIndex retriever.

Read the [Python guide](https://github.com/jcode-works/ragmir/blob/main/docs/python.md) and
[ragmir.com](https://ragmir.com). Ragmir is open source under AGPL-3.0-only, with a commercial
license available from JCode Works.
