"""LangChain's standard test suites for retrievers and tools."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from langchain_ragmir import RagmirRetriever, RagmirSearchTool
from langchain_tests.integration_tests import RetrieversIntegrationTests, ToolsIntegrationTests
from langchain_tests.unit_tests import ToolsUnitTests


@pytest.fixture(autouse=True)
def _project(request: pytest.FixtureRequest, indexed_project: Path) -> None:
    request.cls.project_root = str(indexed_project)


class TestRagmirRetrieverStandard(RetrieversIntegrationTests):
    project_root: str

    @property
    def retriever_constructor(self) -> type[RagmirRetriever]:
        return RagmirRetriever

    @property
    def retriever_constructor_params(self) -> dict[str, Any]:
        return {"project_root": self.project_root}

    @property
    def retriever_query_example(self) -> str:
        return "refund requests"


class TestRagmirSearchToolUnit(ToolsUnitTests):
    project_root: str

    @property
    def tool_constructor(self) -> type[RagmirSearchTool]:
        return RagmirSearchTool

    @property
    def tool_constructor_params(self) -> dict[str, Any]:
        return {"project_root": getattr(self, "project_root", ".")}

    @property
    def tool_invoke_params_example(self) -> dict[str, Any]:
        return {"query": "refund requests", "top_k": 2}


class TestRagmirSearchToolIntegration(ToolsIntegrationTests):
    project_root: str

    @property
    def tool_constructor(self) -> type[RagmirSearchTool]:
        return RagmirSearchTool

    @property
    def tool_constructor_params(self) -> dict[str, Any]:
        return {"project_root": self.project_root}

    @property
    def tool_invoke_params_example(self) -> dict[str, Any]:
        return {"query": "refund requests", "top_k": 2}
