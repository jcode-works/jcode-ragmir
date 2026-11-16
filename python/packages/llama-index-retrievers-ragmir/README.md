# llama-index-retrievers-ragmir

LlamaIndex retriever for [Ragmir](https://github.com/jcode-works/ragmir): cited local
retrieval over a project's code, PDFs, Office files, and more. Every node carries its citation,
and a question the documents cannot answer returns no node.

```bash
pip install llama-index-retrievers-ragmir
```

Ragmir runs through Node.js 22.12 or later or Docker; see [`ragmir`](https://pypi.org/project/ragmir/)
to index a project from Python.

```python
from llama_index.core.query_engine import RetrieverQueryEngine
from llama_index.retrievers.ragmir import RagmirRetriever

retriever = RagmirRetriever(project_root="my-project", similarity_top_k=4)
for node in retriever.retrieve("Who approves a production release?"):
    print(node.metadata["citation"], node.text)

query_engine = RetrieverQueryEngine.from_args(retriever)
print(query_engine.query("Who approves a production release?"))
```

Node metadata holds `source`, `citation`, `context_path`, line or page ranges, `weak_evidence`, and
`source_status` when the file changed after indexing; only the citation and its context reach the
LLM prompt. Nodes keep Ragmir's ranking order without a similarity score.

Read the [Python guide](https://github.com/jcode-works/ragmir/blob/main/docs/python.md).
Open source under AGPL-3.0-only, with a commercial license available from JCode Works.
