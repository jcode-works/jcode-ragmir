"""One client per project root and process, shared by retrievers and tools created without one."""

from __future__ import annotations

import atexit
import os
import threading
from collections.abc import Sequence
from pathlib import Path

from ._client import Ragmir

_clients: dict[tuple[Path, tuple[str, ...] | str | None], Ragmir] = {}
_lock = threading.Lock()


def shared_client(
    project_root: str | os.PathLike[str] = ".",
    *,
    command: Sequence[str] | str | None = None,
) -> Ragmir:
    """The process-wide client of a project root, started on first use and closed at exit.

    Integrations call it when no client is passed, so many retrievers and tools over one project
    share one MCP server. Pass your own ``Ragmir`` to control its lifetime instead.
    """
    root = Path(project_root).expanduser().resolve()
    key = (
        root,
        tuple(command) if command is not None and not isinstance(command, str) else command,
    )
    with _lock:
        client = _clients.get(key)
        if client is None or client.closed:
            client = Ragmir(root, command=command)
            _clients[key] = client
        return client


@atexit.register
def _close_shared_clients() -> None:
    with _lock:
        clients = list(_clients.values())
        _clients.clear()
    for client in clients:
        client.close()
