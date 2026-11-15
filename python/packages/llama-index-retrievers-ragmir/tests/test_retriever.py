from __future__ import annotations

from pathlib import Path

from llama_index.core import Settings
from llama_index.core.llms.mock import MockLLM
from llama_index.core.query_engine import RetrieverQueryEngine
from llama_index.core.schema import MetadataMode
from llama_index.retrievers.ragmir import RagmirRetriever


def test_nodes_keep_their_citation(indexed_project: Path) -> None:
    retriever = RagmirRetriever(indexed_project, similarity_top_k=2)

    nodes = retriever.retrieve("who approves refund requests")

    assert nodes[0].node.metadata["source"] == "docs/refunds.md"
    assert nodes[0].node.metadata["citation"].startswith("docs/refunds.md:L")
    assert nodes[0].score is None
    llm_view = nodes[0].node.get_content(metadata_mode=MetadataMode.LLM)
    assert "citation: docs/refunds.md:L" in llm_view
    assert "line_start" not in llm_view
    assert retriever.retrieve("chocolate cake baking temperature") == []


async def test_async_retrieval_with_globs(indexed_project: Path) -> None:
    retriever = RagmirRetriever(indexed_project, include_paths=["**/*.txt"])

    nodes = await retriever.aretrieve("refund portal")

    assert [node.node.metadata["source"] for node in nodes] == ["notes/refund-faq.txt"]


def test_query_engine_answers_from_cited_nodes(indexed_project: Path) -> None:
    Settings.llm = MockLLM(max_tokens=16)
    engine = RetrieverQueryEngine.from_args(RagmirRetriever(indexed_project, similarity_top_k=2))

    response = engine.query("Who approves refund requests?")

    assert response.source_nodes[0].node.metadata["source"] == "docs/refunds.md"
