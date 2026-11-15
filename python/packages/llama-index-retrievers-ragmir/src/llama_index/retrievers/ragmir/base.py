from __future__ import annotations

import os
from collections.abc import Sequence
from typing import Any

from llama_index.core.callbacks import CallbackManager
from llama_index.core.retrievers import BaseRetriever
from llama_index.core.schema import NodeWithScore, QueryBundle, TextNode

from ragmir import Passage, Ragmir, shared_client

# The citation is what the LLM must quote; the other coordinates stay out of the prompt.
_LLM_HIDDEN_KEYS = [
    "chunk_index",
    "line_start",
    "line_end",
    "page_start",
    "page_end",
    "weak_evidence",
]


class RagmirRetriever(BaseRetriever):
    """Retriever over a local Ragmir knowledge base, with a citation on every node.

    Each node's metadata holds ``source``, ``citation``, ``context_path``, line or page ranges,
    ``weak_evidence``, and ``source_status`` when the file changed after indexing. A question the
    documents cannot answer returns no node, so the query engine can say so instead of guessing.

    .. code-block:: python

        from llama_index.retrievers.ragmir import RagmirRetriever

        retriever = RagmirRetriever(project_root="path/to/project", similarity_top_k=4)
        nodes = retriever.retrieve("Who approves a production release?")

    Without ``client``, retrievers over the same project share one Ragmir server for the process.
    ``include_paths`` and ``exclude_paths`` take folders, files, or globs such as ``"**/*.pdf"``.
    """

    def __init__(
        self,
        project_root: str | os.PathLike[str] = ".",
        *,
        similarity_top_k: int = 4,
        include_paths: Sequence[str] | None = None,
        exclude_paths: Sequence[str] | None = None,
        scope: str | None = None,
        client: Ragmir | None = None,
        command: Sequence[str] | str | None = None,
        callback_manager: CallbackManager | None = None,
        verbose: bool = False,
    ) -> None:
        self._project_root = project_root
        self._similarity_top_k = similarity_top_k
        self._include_paths = include_paths
        self._exclude_paths = exclude_paths
        self._scope = scope
        self._client = client
        self._command = command
        super().__init__(callback_manager=callback_manager, verbose=verbose)

    def _ragmir(self) -> Ragmir:
        return self._client or shared_client(self._project_root, command=self._command)

    def _options(self) -> dict[str, Any]:
        return {
            "top_k": self._similarity_top_k,
            "include_paths": self._include_paths,
            "exclude_paths": self._exclude_paths,
            "scope": self._scope,
        }

    def _retrieve(self, query_bundle: QueryBundle) -> list[NodeWithScore]:
        passages = self._ragmir().search(query_bundle.query_str, **self._options())
        return [_node(passage) for passage in passages]

    async def _aretrieve(self, query_bundle: QueryBundle) -> list[NodeWithScore]:
        passages = await self._ragmir().asearch(query_bundle.query_str, **self._options())
        return [_node(passage) for passage in passages]


def _node(passage: Passage) -> NodeWithScore:
    metadata: dict[str, Any] = {
        "source": passage.path,
        "citation": passage.citation,
        "context_path": passage.context_path,
        "chunk_index": passage.chunk_index,
        "line_start": passage.line_start,
        "line_end": passage.line_end,
        "page_start": passage.page_start,
        "page_end": passage.page_end,
        "weak_evidence": passage.weak_evidence,
    }
    if passage.source_status is not None:
        metadata["source_status"] = passage.source_status
    node = TextNode(
        id_=passage.evidence_id or passage.citation,
        text=passage.text,
        metadata=metadata,
        excluded_llm_metadata_keys=_LLM_HIDDEN_KEYS,
        excluded_embed_metadata_keys=list(metadata),
    )
    # Ragmir fuses keyword and vector ranks, which yields no calibrated similarity: nodes keep
    # Ragmir's order and no score, rather than a number a similarity cutoff would misread.
    return NodeWithScore(node=node, score=None)
