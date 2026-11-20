# Use Ragmir from Python

Python applications get the same index, citations, and refusals as Claude Code or Codex through
three PyPI packages. They drive Ragmir's own engine, so a passage cited in Python is the passage
your coding agent cites.

| Package | For |
| --- | --- |
| [`ragmir`](https://pypi.org/project/ragmir/) | A typed client for scripts, services, and notebooks, sync or async |
| [`langchain-ragmir`](https://pypi.org/project/langchain-ragmir/) | A LangChain retriever and agent tools for LangChain and LangGraph |
| [`llama-index-retrievers-ragmir`](https://pypi.org/project/llama-index-retrievers-ragmir/) | A LlamaIndex retriever |

```bash
pip install ragmir                          # or: uv add ragmir
pip install langchain-ragmir                # LangChain and LangGraph
pip install llama-index-retrievers-ragmir   # LlamaIndex
```

The packages need Python 3.11 or later, and Node.js 22.12 or later or Docker. The client runs the
project's own npm install of `@jcode.labs/ragmir` when there is one, else a global `rgr`, else the
npm release matching the package version through `npx`, else the `ghcr.io/jcode-works/ragmir`
image. Set `RAGMIR_COMMAND` to choose another command.

## Index a project

```python
from ragmir import Ragmir, add_sources, init_project

init_project("/path/to/project")
add_sources("/path/to/project", ["docs/**/*.md", "specs/**/*.pdf", "contracts/**/*.docx"])

with Ragmir("/path/to/project") as rag:
    report = rag.ingest()
    print(report.indexed_files, report.chunks)
```

The same steps work from a terminal: `npx @jcode.labs/ragmir init`, then
`npx @jcode.labs/ragmir sources add "docs/**/*.md"` and `npx @jcode.labs/ragmir ingest`. Name the
package: `npx rgr` only works once a project installs `@jcode.labs/ragmir` with npm. `ingest()` is
incremental: unchanged files are reused and the previous index stays searchable until the new one
passes validation. Ragmir refuses an ingest started through the client while `rgr security-audit`
warns, for example when local OCR commands are configured; run
`run_cli("/path/to/project", "ingest")` from an operator script in that case.

## Search, read, and list documents

```python
from ragmir import Ragmir

with Ragmir("/path/to/project") as rag:
    passages = rag.search("termination notice period", top_k=3, include_paths=["contracts"])
    if not passages:
        print("The documents do not cover this question.")
    for passage in passages:
        flag = " (verify)" if passage.weak_evidence else ""
        print(f"{passage.citation}{flag}\n{passage.text}\n")

    window = rag.expand(passages[0].citation, context_radius=1)
    while window.next_citation:  # read the whole document, window by window
        window = rag.expand(window.next_citation, context_radius=1)

    for file in rag.sources(paths=["**/*.pdf"]).files:
        print(file.path, file.chunks)
```

`Passage` holds `citation`, `path`, `text`, line or page ranges, `context_path`, `weak_evidence`
(few of the question's distinctive words: verify it), `source_status` (`"modified"` or `"missing"`
when the file changed after indexing), and `evidence_id`. An empty list means the base holds no
evidence: let your application say so instead of answering from memory. `include_paths` and
`exclude_paths` take folders, files, or globs such as `"**/*.pdf"`; `scope` selects a named scope
from the project's configuration. `search_many()` answers up to five related questions in one call,
`status()` reports readiness, and `audit()` lists missing or stale sources.

When the question's own words may miss the answer, add `searches`: up to five formulations of the
same need (`SearchFormulation`), fused with the question into one ranking.

```python
passages = rag.search(
    "How are API requests throttled?",
    searches=[
        {"type": "lex", "query": '"rate limit" quota -deprecated'},
        {"type": "vec", "query": "limits on how many calls a client may send"},
        {"type": "hyde", "query": "Each API key may send 600 requests per minute."},
    ],
)
```

A `lex` search ranks by its words, keeps only passages holding each `"quoted phrase"`, and removes
every passage holding a `-word`. `vec` searches a paraphrase and `hyde` a short passage written as
the answer might be. An invalid formulation raises `RagmirToolError` with a message naming the
field.

One `Ragmir` keeps one MCP server running for its project and serves every call, from any thread,
a notebook, or a web framework. Use one client per project in a long-running process and close it
at shutdown. Retrievers and tools created without a client share one per project for the process.

## Async applications

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

`RagmirRetriever` returns LangChain documents whose metadata keeps the citation:

```python
from langchain_ragmir import RagmirRetriever

retriever = RagmirRetriever(project_root="/path/to/project", k=4, include_paths=["docs"])
for document in retriever.invoke("Who approves a production release?"):
    print(document.metadata["citation"], document.page_content)
```

For agentic RAG, give the agent tools and let it decide what to search and read:

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

`ragmir_search` answers the model with numbered citations and passage text, flags weak matches and
changed files, and keeps the documents as the tool message artifact; the model may add `searches`,
its own formulations of the question. `ragmir_expand` reads one
citation with its neighbours and the next citation to read on. Both support `invoke` and
`ainvoke`, and pass LangChain's standard retriever and tool test suites.

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

Only the citation and its context path reach the LLM prompt from the node metadata. Nodes keep
Ragmir's ranking order without a similarity score.

## Other MCP clients

Any Python MCP client can launch the server itself. With the MCP Python SDK 2.x:

```python
import json

from mcp import Client, StdioServerParameters

server = StdioServerParameters(
    command="npx", args=["rgr", "serve-mcp"], cwd="/path/to/project"
)
# Ragmir's server negotiates the 2025-11-25 protocol through the initialize handshake.
async with Client(server, mode="legacy") as client:
    result = await client.call_tool("ragmir_search", {"query": "attachment permissions"})
    for passage in json.loads(result.content[0].text):
        print(passage["citation"], passage["snippet"])
```

The server exposes `ragmir_search`, `ragmir_expand`, `ragmir_sources`, `ragmir_status`,
`ragmir_audit`, and `ragmir_ingest`; see [agent integration](./agent-integration.md). The
`langchain-mcp-adapters` package is no longer maintained: LangChain projects should use
`langchain-ragmir`, which keeps one server per project and supports synchronous calls.

## Without Node.js

Without Node.js, the client runs the official image, so Docker is enough. To choose it, or to pin
another image, set the command explicitly; keep `-i`, which the MCP server needs for its stdin:

```bash
export RAGMIR_COMMAND="docker run --rm -i -v $PWD:/workspace -w /workspace ghcr.io/jcode-works/ragmir"
```

## What your application owns

An empty result means the base holds no evidence for the question: let the agent say so instead
of answering from memory. Results flagged `weak_evidence` need checking. Ragmir calls no model and
opens no port; your application chooses the model and decides where passages go. For a service on
a server, see [Run Ragmir on a server](./server-deployment.md).
