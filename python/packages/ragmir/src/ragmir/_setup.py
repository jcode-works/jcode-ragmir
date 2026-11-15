"""Prepare a knowledge base from Python: initialize it, choose its sources, run any command."""

from __future__ import annotations

import os
import subprocess
from collections.abc import Sequence
from pathlib import Path

from ._errors import RagmirCommandError
from ._launcher import resolve_launcher


def run_cli(
    project_root: str | os.PathLike[str],
    *args: str,
    command: Sequence[str] | str | None = None,
    timeout: float = 900.0,
) -> str:
    """Run ``rgr <args>`` for the project and return its output.

    Use it for operator steps the MCP tools leave to a person, such as ``"ingest"`` with local OCR
    configured, ``"doctor"``, or ``"evaluate", "--golden", "golden.json"``.
    """
    root = Path(project_root).expanduser().resolve()
    launcher = resolve_launcher(root, command)
    completed = subprocess.run(
        launcher.command(*args),
        cwd=root,
        env=os.environ.copy(),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        check=False,
    )
    output = (completed.stdout + completed.stderr).strip()
    if completed.returncode != 0:
        raise RagmirCommandError(
            f"rgr {' '.join(args)} failed with exit code {completed.returncode}:\n{output}",
            returncode=completed.returncode,
            output=output,
        )
    return output


def init_project(
    project_root: str | os.PathLike[str] = ".",
    *,
    command: Sequence[str] | str | None = None,
) -> str:
    """Create the project's ``.ragmir/`` configuration; an existing configuration is kept."""
    Path(project_root).expanduser().mkdir(parents=True, exist_ok=True)
    return run_cli(project_root, "init", command=command)


def add_sources(
    project_root: str | os.PathLike[str],
    patterns: Sequence[str],
    *,
    command: Sequence[str] | str | None = None,
) -> str:
    """Add source folders, files, or globs such as ``docs/**/*.md``; ``!pattern`` excludes."""
    if isinstance(patterns, str):
        raise TypeError("patterns must be a list of strings, not one string.")
    return run_cli(project_root, "sources", "add", *patterns, command=command)
