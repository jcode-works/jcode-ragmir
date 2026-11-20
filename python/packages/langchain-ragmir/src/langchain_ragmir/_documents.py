from __future__ import annotations

from typing import Any

from langchain_core.documents import Document
from ragmir import ExpandedCitation, Passage


def passage_to_document(passage: Passage) -> Document:
    """A LangChain document whose metadata keeps the citation and its coordinates."""
    metadata: dict[str, Any] = {
        "source": passage.path,
        "citation": passage.citation,
        "chunk_index": passage.chunk_index,
        "context_path": passage.context_path,
        "line_start": passage.line_start,
        "line_end": passage.line_end,
        "page_start": passage.page_start,
        "page_end": passage.page_end,
        "weak_evidence": passage.weak_evidence,
    }
    if passage.source_status is not None:
        metadata["source_status"] = passage.source_status
    return Document(
        page_content=passage.text,
        metadata=metadata,
        id=passage.evidence_id or passage.citation,
    )


def passages_text(passages: list[Passage]) -> str:
    """Numbered citations with their text, as an agent should quote them."""
    if not passages:
        return "No passage in the indexed documents supports an answer to this question."
    blocks = []
    for number, passage in enumerate(passages, start=1):
        notes = [
            note
            for note in (
                "weak match: verify before relying on it" if passage.weak_evidence else "",
                f"file {passage.source_status} since indexing" if passage.source_status else "",
            )
            if note
        ]
        suffix = f" ({'; '.join(notes)})" if notes else ""
        blocks.append(f"[{number}] {passage.citation}{suffix}\n{passage.text}")
    return "\n\n".join(blocks)


def expanded_text(expanded: ExpandedCitation) -> str:
    if not expanded.found:
        return f"{expanded.citation} is no longer in the index. {_missing_citation_hint(expanded)}"
    blocks = [f"[{passage.citation}]\n{passage.text}" for passage in expanded.passages]
    if expanded.next_citation:
        blocks.append(f"Continue reading: {expanded.next_citation}")
    return "\n\n".join(blocks)


def _missing_citation_hint(expanded: ExpandedCitation) -> str:
    """The agent's next step when a citation finds nothing: the hint Ragmir gave, or a search."""
    if expanded.suggested_citation:
        return f"Its document is still indexed: expand {expanded.suggested_citation} instead."
    if expanded.similar_paths:
        return f"Indexed files with a close name: {', '.join(expanded.similar_paths)}."
    return "Search again for current evidence."
