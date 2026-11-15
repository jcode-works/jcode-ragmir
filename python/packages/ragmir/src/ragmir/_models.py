"""Typed results of the Ragmir client. Each keeps the server's full JSON in ``raw``."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Literal


def _int(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _str(value: object) -> str | None:
    return value if isinstance(value, str) else None


@dataclass(frozen=True, slots=True)
class Passage:
    """One cited passage of an indexed document."""

    citation: str
    """Exact citation to quote and expand, such as ``docs/runbook.md:L12-L18#4``."""
    path: str
    """Project-relative path of the cited file."""
    text: str
    """The passage text."""
    chunk_index: int
    context_path: str
    """Heading or structural path of the passage inside its file."""
    line_start: int | None
    line_end: int | None
    page_start: int | None
    page_end: int | None
    weak_evidence: bool
    """The passage shares few distinctive words with the question: verify before relying on it."""
    source_status: Literal["modified", "missing"] | None
    """Set when the file changed or disappeared after indexing; run ``ingest`` to refresh it."""
    evidence_id: str | None
    """Identity of the indexed text; pass it to ``expand`` to detect a changed passage."""
    distance: float | None
    raw: Mapping[str, Any] = field(repr=False, compare=False)

    @classmethod
    def from_json(cls, value: Mapping[str, Any]) -> Passage:
        evidence = value.get("evidence")
        status = value.get("sourceStatus")
        distance = value.get("distance")
        return cls(
            citation=str(value.get("citation", "")),
            path=str(value.get("relativePath") or value.get("path") or ""),
            text=str(value.get("text") or value.get("snippet") or ""),
            chunk_index=_int(value.get("chunkIndex")) or 0,
            context_path=str(value.get("contextPath") or ""),
            line_start=_int(value.get("lineStart")),
            line_end=_int(value.get("lineEnd")),
            page_start=_int(value.get("pageStart")),
            page_end=_int(value.get("pageEnd")),
            weak_evidence=value.get("weakEvidence") is True,
            source_status=status if status in ("modified", "missing") else None,
            evidence_id=_str(evidence.get("id")) if isinstance(evidence, Mapping) else None,
            distance=float(distance) if isinstance(distance, int | float) else None,
            raw=value,
        )


@dataclass(frozen=True, slots=True)
class ExpandedCitation:
    """A cited passage with its neighbours, and the citations to read the document further."""

    citation: str
    found: bool
    path: str
    passages: tuple[Passage, ...]
    document_chunks: int | None
    """Number of indexed chunks of the document."""
    next_citation: str | None
    """Expand it with the same radius to read on; absent at the end of the document."""
    previous_citation: str | None
    raw: Mapping[str, Any] = field(repr=False, compare=False)

    @property
    def text(self) -> str:
        """The passages joined in document order."""
        return "\n\n".join(passage.text for passage in self.passages)

    @classmethod
    def from_json(cls, value: Mapping[str, Any]) -> ExpandedCitation:
        passages = value.get("passages")
        return cls(
            citation=str(value.get("requestedCitation", "")),
            found=value.get("found") is True,
            path=str(value.get("relativePath") or ""),
            passages=tuple(
                Passage.from_json(passage)
                for passage in (passages if isinstance(passages, list) else [])
                if isinstance(passage, Mapping)
            ),
            document_chunks=_int(value.get("documentChunks")),
            next_citation=_str(value.get("nextCitation")),
            previous_citation=_str(value.get("previousCitation")),
            raw=value,
        )


@dataclass(frozen=True, slots=True)
class IndexedFile:
    path: str
    chunks: int


@dataclass(frozen=True, slots=True)
class SourceCatalog:
    """One page of the indexed documents."""

    files: tuple[IndexedFile, ...]
    total_files: int
    """Indexed files in the whole base."""
    matched_files: int | None
    """Indexed files matching the ``paths`` filter, when one was given."""
    next_offset: int | None
    """Pass it as ``offset`` to read the next page; ``None`` on the last page."""
    missing_from_index: tuple[str, ...]
    stale_in_index: tuple[str, ...]
    raw: Mapping[str, Any] = field(repr=False, compare=False)

    @classmethod
    def from_json(cls, value: Mapping[str, Any]) -> SourceCatalog:
        files = value.get("indexedFiles")
        totals = value.get("totals")
        page = value.get("page")
        filter_ = value.get("filter")
        return cls(
            files=tuple(
                IndexedFile(path=str(item.get("source", "")), chunks=_int(item.get("chunks")) or 0)
                for item in (files if isinstance(files, list) else [])
                if isinstance(item, Mapping)
            ),
            total_files=(_int(totals.get("indexedFiles")) or 0)
            if isinstance(totals, Mapping)
            else 0,
            matched_files=_int(filter_.get("matchedFiles"))
            if isinstance(filter_, Mapping)
            else None,
            next_offset=_int(page.get("nextOffset")) if isinstance(page, Mapping) else None,
            missing_from_index=_strings(value.get("missingFromIndex")),
            stale_in_index=_strings(value.get("staleInIndex")),
            raw=value,
        )


@dataclass(frozen=True, slots=True)
class Status:
    """Identity and readiness of the knowledge base."""

    name: str
    project_root: str
    ready: bool
    indexed_files: int
    chunks: int
    missing_from_index: int
    stale_in_index: int
    next_steps: tuple[str, ...]
    raw: Mapping[str, Any] = field(repr=False, compare=False)

    @classmethod
    def from_json(cls, value: Mapping[str, Any]) -> Status:
        base = value.get("knowledgeBase")
        coverage = value.get("coverage")
        coverage_map: Mapping[str, Any] = coverage if isinstance(coverage, Mapping) else {}
        return cls(
            name=str(base.get("name", "")) if isinstance(base, Mapping) else "",
            project_root=str(base.get("projectRoot", "")) if isinstance(base, Mapping) else "",
            ready=value.get("ready") is True,
            indexed_files=_int(coverage_map.get("indexedFiles")) or 0,
            chunks=_int(value.get("chunksIndexed")) or 0,
            missing_from_index=_int(coverage_map.get("missingFromIndex")) or 0,
            stale_in_index=_int(coverage_map.get("staleInIndex")) or 0,
            next_steps=_strings(value.get("nextSteps")),
            raw=value,
        )


@dataclass(frozen=True, slots=True)
class IngestReport:
    """Outcome of an incremental ingest."""

    status: Literal["completed", "completed_with_errors", "running"]
    indexed_files: int
    rebuilt_files: int
    reused_files: int
    chunks: int
    errors: tuple[Mapping[str, Any], ...]
    raw: Mapping[str, Any] = field(repr=False, compare=False)

    @classmethod
    def from_json(cls, value: Mapping[str, Any]) -> IngestReport:
        status = value.get("status")
        errors = value.get("errors")
        return cls(
            status=status if status in ("completed", "completed_with_errors") else "running",
            indexed_files=_int(value.get("indexedFiles")) or 0,
            rebuilt_files=_int(value.get("rebuiltFiles")) or 0,
            reused_files=_int(value.get("reusedFiles")) or 0,
            chunks=_int(value.get("chunks")) or 0,
            errors=tuple(item for item in errors if isinstance(item, Mapping))
            if isinstance(errors, list)
            else (),
            raw=value,
        )


def _strings(value: object) -> tuple[str, ...]:
    return tuple(item for item in value if isinstance(item, str)) if isinstance(value, list) else ()
