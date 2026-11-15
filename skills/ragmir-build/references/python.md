# Ragmir in Python

Three PyPI packages, for Python 3.11+, drive Ragmir's own engine through its MCP server:

| Package | Import | For |
| --- | --- | --- |
| `ragmir` | `from ragmir import Ragmir, AsyncRagmir` | scripts, services, notebooks |
| `langchain-ragmir` | `from langchain_ragmir import RagmirRetriever, RagmirToolkit` | LangChain and LangGraph |
| `llama-index-retrievers-ragmir` | `from llama_index.retrievers.ragmir import RagmirRetriever` | LlamaIndex |

The client runs, in order: the command in `RAGMIR_COMMAND`, the project's own npm install of
`@jcode.labs/ragmir`, a global `rgr`, the matching npm release through `npx`, then the
`ghcr.io/jcode-works/ragmir` image. A host needs Node.js 22.12+ or Docker.

## Index a project

```python
from ragmir import Ragmir, add_sources, init_project

init_project("/path/to/project")
add_sources("/path/to/project", ["docs/**/*.md", "contracts/**/*.pdf"])

with Ragmir("/path/to/project") as rag:
    report = rag.ingest()  # incremental; waits for the run to finish
    print(report.indexed_files, report.chunks)
```

Ragmir refuses an ingest started through the client while `rgr security-audit` warns, for example
when local OCR commands are configured; run `run_cli("/path/to/project", "ingest")` from an
operator script then.

## Search, expand, list

```python
from ragmir import Ragmir

with Ragmir("/path/to/project") as rag:
    passages = rag.search("termination notice period", top_k=3, include_paths=["contracts"])
    if not passages:
        print("The documents do not cover this question.")
    for passage in passages:
        flag = " (verify)" if passage.weak_evidence else ""
        print(f"{passage.citation}{flag}\n{passage.text}\n")

    if passages:
        window = rag.expand(passages[0].citation, context_radius=1)
        while window.next_citation:  # read the whole document, window by window
            window = rag.expand(window.next_citation, context_radius=1)

    for file in rag.sources(paths=["**/*.pdf"]).files:
        print(file.path, file.chunks)
```

- `search()` accepts `top_k`, `include_paths`, `exclude_paths` (folders, files, or globs), `scope`,
  `max_chunks_per_document`, and `context_radius`. `search_many()` answers up to five related
  questions in one call.
- A `Passage` holds `citation`, `path`, `text`, line or page ranges, `context_path`,
  `weak_evidence`, `source_status`, and `evidence_id`.
- `status()` reports readiness and `audit()` lists missing or stale sources. Tool failures raise
  `RagmirToolError`; a missing runtime raises `RagmirNotFoundError`.

One `Ragmir` keeps one MCP server running for its project and serves every call, from any thread.
Open one per project in a long-running process and close it at shutdown.

## Async services

Every method has an async twin on `Ragmir` (`asearch`, `aexpand`, `asources`, `astatus`,
`aingest`), and `AsyncRagmir` serves asyncio applications directly:

```python
from contextlib import asynccontextmanager

from fastapi import FastAPI
from ragmir import AsyncRagmir

rag = AsyncRagmir("/srv/handbook")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await rag.connect()
    yield
    await rag.aclose()


app = FastAPI(lifespan=lifespan)


@app.get("/search")
async def search(q: str):
    # Authenticate and authorize the caller first: Ragmir does not filter results per user.
    return [{"citation": p.citation, "text": p.text} for p in await rag.search(q, top_k=5)]
```

## LangChain and LangGraph

```python
from langchain_ragmir import RagmirRetriever

retriever = RagmirRetriever(project_root="/path/to/project", k=4, include_paths=["docs"])
for document in retriever.invoke("Who approves a production release?"):
    print(document.metadata["citation"], document.page_content)
```

```python
from langchain.agents import create_agent
from langchain_ragmir import RagmirToolkit

agent = create_agent(
    "anthropic:claude-sonnet-5-5",
    tools=RagmirToolkit(project_root="/path/to/project").get_tools(),
    system_prompt="Answer from the project documents and cite every claim with its citation.",
)
result = agent.invoke({"messages": [{"role": "user", "content": "What is the refund policy?"}]})
```

`ragmir_search` answers the model with numbered citations and passage text and keeps the
documents as the tool message artifact; `ragmir_expand` reads one citation with its neighbours.
Both support `invoke` and `ainvoke`. Retrievers and toolkits created without a `client` share one
client per project for the process. Prefer these packages to `langchain-mcp-adapters`, which is no
longer maintained.

## LlamaIndex

```python
from llama_index.core.query_engine import RetrieverQueryEngine
from llama_index.retrievers.ragmir import RagmirRetriever

retriever = RagmirRetriever("/path/to/project", similarity_top_k=4)
engine = RetrieverQueryEngine.from_args(retriever)
response = engine.query("Who approves a production release?")
for node in response.source_nodes:
    print(node.node.metadata["citation"])
```

Nodes keep Ragmir's ranking order without a similarity score; only the citation and its context
path reach the LLM prompt from the node metadata.

## Choose the command

```bash
export RAGMIR_COMMAND="docker run --rm -i -v $PWD:/workspace -w /workspace ghcr.io/jcode-works/ragmir"
```

Keep `-i`, which the MCP server needs for stdin. Pass `command=[...]` to `Ragmir` to choose it in
code instead.

Reference: https://github.com/jcode-works/jcode-ragmir/blob/main/docs/python.md
