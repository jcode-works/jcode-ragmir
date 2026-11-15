from __future__ import annotations

from typing import Any, Literal

from langchain_core.callbacks import AsyncCallbackManagerForToolRun, CallbackManagerForToolRun
from langchain_core.documents import Document
from langchain_core.tools import BaseTool, BaseToolkit
from pydantic import BaseModel, ConfigDict, Field
from ragmir import Ragmir, shared_client

from ._documents import expanded_text, passage_to_document, passages_text

MAX_TOOL_TOP_K = 10


class RagmirSearchInput(BaseModel):
    query: str = Field(
        description="One focused question, in natural language or with exact identifiers."
    )
    top_k: int | None = Field(
        default=None, ge=1, le=MAX_TOOL_TOP_K, description="Passages to return, 1 to 10."
    )
    include_paths: list[str] | None = Field(
        default=None,
        description="Search only these folders, files, or globs such as docs/** or **/*.pdf.",
    )
    exclude_paths: list[str] | None = Field(
        default=None, description="Skip these folders, files, or globs."
    )


class RagmirExpandInput(BaseModel):
    citation: str = Field(
        description="A citation from ragmir_search, such as docs/runbook.md:L12-L18#4."
    )
    context_radius: int | None = Field(
        default=None, ge=0, le=3, description="Neighbouring passages on each side, 0 to 3."
    )


class _RagmirTool(BaseTool):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    project_root: str = "."
    command: list[str] | str | None = None
    client: Ragmir | None = None
    response_format: Literal["content", "content_and_artifact"] = "content_and_artifact"

    def _ragmir(self) -> Ragmir:
        return self.client or shared_client(self.project_root, command=self.command)


class RagmirSearchTool(_RagmirTool):
    """Agent tool that searches a local Ragmir base and answers with cited passages.

    The model reads numbered citations with their text, weak-match and changed-file flags, and an
    explicit no-evidence answer; the tool message artifact holds the LangChain documents.
    """

    name: str = "ragmir_search"
    description: str = (
        "Search the project's indexed documents and code for passages that answer a question. "
        "Each passage comes with a citation (file and lines, PDF page, slide, sheet cells, or "
        "section) to quote. No passage means the documents hold no evidence: say so instead of "
        "guessing. Use ragmir_expand to read a cited passage with its surroundings."
    )
    args_schema: type[BaseModel] = RagmirSearchInput
    top_k: int = Field(default=4, ge=1, le=MAX_TOOL_TOP_K)
    """Passages per search when the model does not choose."""

    def _run(
        self,
        query: str,
        top_k: int | None = None,
        include_paths: list[str] | None = None,
        exclude_paths: list[str] | None = None,
        run_manager: CallbackManagerForToolRun | None = None,
    ) -> tuple[str, list[Document]]:
        passages = self._ragmir().search(
            query,
            top_k=top_k or self.top_k,
            include_paths=include_paths,
            exclude_paths=exclude_paths,
        )
        return passages_text(passages), [passage_to_document(passage) for passage in passages]

    async def _arun(
        self,
        query: str,
        top_k: int | None = None,
        include_paths: list[str] | None = None,
        exclude_paths: list[str] | None = None,
        run_manager: AsyncCallbackManagerForToolRun | None = None,
    ) -> tuple[str, list[Document]]:
        passages = await self._ragmir().asearch(
            query,
            top_k=top_k or self.top_k,
            include_paths=include_paths,
            exclude_paths=exclude_paths,
        )
        return passages_text(passages), [passage_to_document(passage) for passage in passages]


class RagmirExpandTool(_RagmirTool):
    """Agent tool that reads one citation with its neighbours and the citation to read on."""

    name: str = "ragmir_expand"
    description: str = (
        "Read the full text of one citation returned by ragmir_search, with up to three "
        "neighbouring passages on each side. To read a long document through, call it again "
        "with the nextCitation it returns."
    )
    args_schema: type[BaseModel] = RagmirExpandInput

    def _run(
        self,
        citation: str,
        context_radius: int | None = None,
        run_manager: CallbackManagerForToolRun | None = None,
    ) -> tuple[str, dict[str, Any]]:
        expanded = self._ragmir().expand(citation, context_radius=_radius(context_radius))
        return expanded_text(expanded), dict(expanded.raw)

    async def _arun(
        self,
        citation: str,
        context_radius: int | None = None,
        run_manager: AsyncCallbackManagerForToolRun | None = None,
    ) -> tuple[str, dict[str, Any]]:
        expanded = await self._ragmir().aexpand(citation, context_radius=_radius(context_radius))
        return expanded_text(expanded), dict(expanded.raw)


class RagmirToolkit(BaseToolkit):
    """The ``ragmir_search`` and ``ragmir_expand`` tools over one Ragmir base.

    .. code-block:: python

        from langchain.agents import create_agent
        from langchain_ragmir import RagmirToolkit

        tools = RagmirToolkit(project_root="path/to/project").get_tools()
        agent = create_agent("anthropic:claude-sonnet-5-5", tools=tools)
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    project_root: str = "."
    command: list[str] | str | None = None
    client: Ragmir | None = None
    top_k: int = Field(default=4, ge=1, le=MAX_TOOL_TOP_K)

    def get_tools(self) -> list[BaseTool]:
        return [
            RagmirSearchTool(
                project_root=self.project_root,
                command=self.command,
                client=self.client,
                top_k=self.top_k,
            ),
            RagmirExpandTool(
                project_root=self.project_root, command=self.command, client=self.client
            ),
        ]


def _radius(value: int | None) -> int:
    return 1 if value is None else value
