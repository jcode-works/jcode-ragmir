"""Cited local retrieval for Python: search a project's indexed code and documents with Ragmir.

>>> from ragmir import Ragmir
>>> with Ragmir("path/to/project") as rag:
...     for passage in rag.search("who approves a production release?"):
...         print(passage.citation, passage.text)

Ragmir runs locally through Node.js (a project install, a global ``rgr``, or the pinned npm
release through npx) or the official Docker image. See https://github.com/jcode-works/jcode-ragmir.
"""

from ._client import DEFAULT_TIMEOUT, AsyncRagmir, Ragmir
from ._errors import (
    RagmirCommandError,
    RagmirError,
    RagmirNotFoundError,
    RagmirServerError,
    RagmirToolError,
)
from ._launcher import Launcher, resolve_launcher
from ._models import (
    ExpandedCitation,
    IndexedFile,
    IngestReport,
    Passage,
    SourceCatalog,
    Status,
)
from ._setup import add_sources, init_project, run_cli
from ._shared import shared_client
from ._version import __version__

__all__ = [
    "DEFAULT_TIMEOUT",
    "AsyncRagmir",
    "ExpandedCitation",
    "IndexedFile",
    "IngestReport",
    "Launcher",
    "Passage",
    "Ragmir",
    "RagmirCommandError",
    "RagmirError",
    "RagmirNotFoundError",
    "RagmirServerError",
    "RagmirToolError",
    "SourceCatalog",
    "Status",
    "__version__",
    "add_sources",
    "init_project",
    "resolve_launcher",
    "run_cli",
    "shared_client",
]
