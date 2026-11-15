"""Errors raised by the Ragmir Python client."""

from __future__ import annotations


class RagmirError(Exception):
    """Base class of every error the Ragmir client raises."""


class RagmirNotFoundError(RagmirError):
    """No way to run Ragmir was found: no local install, no Node.js with npx, and no Docker."""


class RagmirServerError(RagmirError):
    """The Ragmir MCP server could not start, or stopped answering."""


class RagmirToolError(RagmirError):
    """Ragmir refused or failed a request; the message says why and what to run instead."""


class RagmirCommandError(RagmirError):
    """A Ragmir command such as ``init`` or ``sources add`` failed."""

    def __init__(self, message: str, *, returncode: int, output: str) -> None:
        super().__init__(message)
        self.returncode = returncode
        self.output = output
