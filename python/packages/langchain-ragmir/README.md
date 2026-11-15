# langchain-ragmir

LangChain and LangGraph integration for [Ragmir](https://github.com/jcode-works/jcode-ragmir):
cited local retrieval over a project's code, PDFs, Office files, and more. Every document carries
its citation, and a question the documents cannot answer returns nothing.

```bash
pip install langchain-ragmir
```

Ragmir runs through Node.js 22.12 or later or Docker; see [`ragmir`](https://pypi.org/project/ragmir/)
to index a project from Python.

## Retriever

```python
from langchain_ragmir import RagmirRetriever

retriever = RagmirRetriever(project_root="my-project", k=4, include_paths=["docs"])
for document in retriever.invoke("Who approves a production release?"):
    print(document.metadata["citation"], document.page_content)
```

Each document's metadata holds `source`, `citation`, `context_path`, line or page ranges,
`weak_evidence`, and `source_status` when the file changed after indexing.

## Agent tools

Let the agent decide what to search and which passages to read:

```python
from langchain.agents import create_agent
from langchain_ragmir import RagmirToolkit

tools = RagmirToolkit(project_root="my-project").get_tools()
agent = create_agent(
    "anthropic:claude-sonnet-5-5",
    tools=tools,
    system_prompt="Answer from the project documents and cite every claim.",
)
agent.invoke({"messages": [{"role": "user", "content": "What is the refund policy?"}]})
```

`ragmir_search` answers with numbered citations and passage text, and keeps the documents as the
tool message artifact. `ragmir_expand` reads a citation with its neighbours and the citation to
read on. Retrievers and tools over the same project share one Ragmir server; pass
`client=ragmir.Ragmir(...)` to manage it yourself.

Read the [Python guide](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/python.md).
Open source under AGPL-3.0-only, with a commercial license available from JCode Works.
