# llama-index-retrievers-ragmir

**A LlamaIndex retriever with exact citations, on your infrastructure.**

[Ragmir](https://ragmir.com) gives LlamaIndex query engines cited local retrieval over a project's
code, PDFs, Office files, scans, and more. Every node carries its citation, and a question the
documents cannot answer returns no node, so the engine can say so instead of guessing.

- **Any model:** the index does not depend on the LLM that writes the answer, so you can switch
  between Claude, GPT, Gemini, Mistral, or a local model without re-indexing.
- **No GPU, no vector database:** the default retrieval runs offline on the CPU, and the index is an
  embedded store in the project's git-ignored `.ragmir/` folder.
- **Your data stays where you run it:** no account, telemetry, or hosted store.
- **Measured:** `rgr evaluate` scores retrieval on your own questions and fails CI when it regresses.

```bash
pip install llama-index-retrievers-ragmir
```

Requires Python 3.11 or later; Ragmir runs through Node.js 22.12 or later or Docker. See
[`ragmir`](https://pypi.org/project/ragmir/) to index a project from Python, and the [system
requirements](https://github.com/jcode-works/ragmir#system-requirements) for semantic models and
OCR.

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
