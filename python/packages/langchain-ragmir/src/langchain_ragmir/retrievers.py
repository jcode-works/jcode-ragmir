from __future__ import annotations

from typing import Any

from langchain_core.callbacks import (
    AsyncCallbackManagerForRetrieverRun,
    CallbackManagerForRetrieverRun,
)
from langchain_core.documents import Document
from langchain_core.retrievers import BaseRetriever
from pydantic import ConfigDict, Field
from ragmir import Ragmir, shared_client

from ._documents import passage_to_document


class RagmirRetriever(BaseRetriever):
    """Retriever over a local Ragmir knowledge base, with a citation on every document.

    Each document's ``metadata`` holds ``source``, ``citation``, line or page ranges,
    ``context_path``, ``weak_evidence``, and ``source_status`` when the file changed after
    indexing. A question the documents cannot answer returns no document, so a chain can say so
    instead of answering from unrelated text.

    Setup:
        Index the project once (``rgr init``, ``rgr sources add``, ``rgr ingest``, or
        ``ragmir.init_project`` and ``ragmir.add_sources`` from Python), then:

        .. code-block:: python

            from langchain_ragmir import RagmirRetriever

            retriever = RagmirRetriever(project_root="path/to/project", k=4)
            documents = retriever.invoke("Who approves a production release?")

    Without ``client``, retrievers and tools over the same project share one Ragmir server for the
    process. ``include_paths`` and ``exclude_paths`` take folders, files, or globs such as
    ``"**/*.pdf"``.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    project_root: str = "."
    """Project whose Ragmir base answers, or a folder inside it."""
    k: int = Field(default=4, ge=1)
    """Passages to return; the base's ``mcpMaxTopK`` setting caps it (10 by default)."""
    include_paths: list[str] | None = None
    exclude_paths: list[str] | None = None
    scope: str | None = None
    """A named scope from the project's Ragmir configuration."""
    max_chunks_per_document: int | None = None
    command: list[str] | str | None = None
    """Command that runs ``rgr``, when neither a local install, npx, nor Docker fits."""
    client: Ragmir | None = None
    """A client you own and close; by default the project's shared client is used."""

    def _search_options(self, overrides: dict[str, Any]) -> dict[str, Any]:
        return {
            "top_k": overrides.get("k", self.k),
            "include_paths": overrides.get("include_paths", self.include_paths),
            "exclude_paths": overrides.get("exclude_paths", self.exclude_paths),
            "scope": overrides.get("scope", self.scope),
            "max_chunks_per_document": overrides.get(
                "max_chunks_per_document", self.max_chunks_per_document
            ),
        }

    def _ragmir(self) -> Ragmir:
        return self.client or shared_client(self.project_root, command=self.command)

    def _get_relevant_documents(
        self, query: str, *, run_manager: CallbackManagerForRetrieverRun, **kwargs: Any
    ) -> list[Document]:
        passages = self._ragmir().search(query, **self._search_options(kwargs))
        return [passage_to_document(passage) for passage in passages]

    async def _aget_relevant_documents(
        self, query: str, *, run_manager: AsyncCallbackManagerForRetrieverRun, **kwargs: Any
    ) -> list[Document]:
        passages = await self._ragmir().asearch(query, **self._search_options(kwargs))
        return [passage_to_document(passage) for passage in passages]
