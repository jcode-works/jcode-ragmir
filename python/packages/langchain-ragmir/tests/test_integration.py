from __future__ import annotations

from pathlib import Path

from langchain_core.documents import Document
from langchain_core.messages import ToolMessage
from langchain_ragmir import RagmirRetriever, RagmirToolkit
from ragmir import Ragmir


def test_documents_keep_their_citation(indexed_project: Path) -> None:
    retriever = RagmirRetriever(project_root=str(indexed_project), k=2)

    documents = retriever.invoke("who approves refund requests")

    assert documents[0].metadata["source"] == "docs/refunds.md"
    assert documents[0].metadata["citation"].startswith("docs/refunds.md:L")
    assert documents[0].metadata["weak_evidence"] is False
    assert "billing team" in documents[0].page_content
    assert retriever.invoke("chocolate cake baking temperature") == []


async def test_async_retrieval_with_a_shared_client(indexed_project: Path) -> None:
    with Ragmir(indexed_project) as client:
        retriever = RagmirRetriever(client=client, include_paths=["notes"])
        documents = await retriever.ainvoke("refund portal")

    assert [document.metadata["source"] for document in documents] == ["notes/refund-faq.txt"]


def test_toolkit_answers_with_citations_and_keeps_documents(indexed_project: Path) -> None:
    search, expand = RagmirToolkit(project_root=str(indexed_project), top_k=2).get_tools()
    assert (search.name, expand.name) == ("ragmir_search", "ragmir_expand")

    message = search.invoke(
        {
            "type": "tool_call",
            "id": "call-1",
            "name": "ragmir_search",
            "args": {"query": "return label expiry"},
        }
    )
    assert isinstance(message, ToolMessage)
    assert "[1] docs/returns.md:L" in str(message.content)
    documents = message.artifact
    assert isinstance(documents[0], Document)

    expanded = expand.invoke(
        {
            "type": "tool_call",
            "id": "call-2",
            "name": "ragmir_expand",
            "args": {"citation": documents[0].metadata["citation"]},
        }
    )
    assert "Return labels for refund requests expire" in str(expanded.content)
    assert expanded.artifact["found"] is True

    silent = search.invoke({"query": "chocolate cake baking temperature"})
    assert "No passage in the indexed documents" in silent

    fused = search.invoke(
        {"query": "refund", "searches": [{"type": "lex", "query": '"billing team" -portal'}]}
    )
    assert "[1] docs/refunds.md:L" in fused
    assert "refund-faq.txt" not in fused
