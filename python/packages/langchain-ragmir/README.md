# langchain-ragmir

**LangChain and LangGraph retrieval with exact citations, on your infrastructure.**

[Ragmir](https://ragmir.com) gives LangChain chains and agents cited local retrieval over a
project's code, PDFs, Office files, scans, and more. Every document carries its citation, and a
question the documents cannot answer returns nothing, so the agent can say so instead of guessing.

- **Any model:** the index does not depend on the LLM that writes the answer, so you can switch
  between Claude, GPT, Gemini, Mistral, or a local model without re-indexing.
- **No GPU, no vector database:** the default retrieval runs offline on the CPU, and the index is an
  embedded store in the project's git-ignored `.ragmir/` folder.
- **Your data stays where you run it:** no account, telemetry, or hosted store.
- **Measured:** `rgr evaluate` scores retrieval on your own questions and fails CI when it regresses.

```bash
pip install langchain-ragmir
```

Requires Python 3.11 or later; Ragmir runs through Node.js 22.12 or later or Docker. See
[`ragmir`](https://pypi.org/project/ragmir/) to index a project from Python, and the [system
requirements](https://github.com/jcode-works/ragmir#system-requirements) for semantic models and
OCR.

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
tool message artifact; the model may add `searches`, its own keyword, paraphrase, or likely-answer
formulations of the question. `ragmir_expand` reads a citation with its neighbours and the citation
to read on, and answers a citation the index no longer holds with the nearest passage or the files
with a close name. Retrievers and tools over the same project share one Ragmir server; pass
`client=ragmir.Ragmir(...)` to manage it yourself.

Read the [Python guide](https://github.com/jcode-works/ragmir/blob/main/docs/python.md).
Open source under AGPL-3.0-only, with a commercial license available from JCode Works.
