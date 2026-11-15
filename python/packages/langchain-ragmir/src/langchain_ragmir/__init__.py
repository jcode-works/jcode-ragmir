"""LangChain and LangGraph integration for Ragmir: cited local retrieval as a retriever or tools."""

from importlib import metadata

from ._documents import passage_to_document
from .retrievers import RagmirRetriever
from .tools import (
    RagmirExpandInput,
    RagmirExpandTool,
    RagmirSearchInput,
    RagmirSearchTool,
    RagmirToolkit,
)

try:
    __version__ = metadata.version("langchain-ragmir")
except metadata.PackageNotFoundError:
    __version__ = "0.0.0"

__all__ = [
    "RagmirExpandInput",
    "RagmirExpandTool",
    "RagmirRetriever",
    "RagmirSearchInput",
    "RagmirSearchTool",
    "RagmirToolkit",
    "__version__",
    "passage_to_document",
]
