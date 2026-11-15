"""Find how to run the Ragmir CLI for a project, without a shell.

Order: an explicit command or ``RAGMIR_COMMAND``, the project's own npm install, a global ``rgr``,
the pinned npm release through npx, then the official Docker image. Each candidate runs as an
argument list; Windows ``.cmd`` shims are replaced by ``node`` and the script they wrap.
"""

from __future__ import annotations

import os
import shlex
import shutil
import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from ._errors import RagmirNotFoundError
from ._version import __version__

NPM_PACKAGE = "@jcode.labs/ragmir"
DOCKER_IMAGE = "ghcr.io/jcode-works/ragmir"
CONTAINER_ROOT = "/workspace"
_CLI_ENTRY = Path("node_modules") / "@jcode.labs" / "ragmir" / "dist" / "cli-entry.js"

LauncherKind = Literal["command", "project", "global", "npx", "docker"]


@dataclass(frozen=True)
class Launcher:
    """A way to run ``rgr``: the argument prefix and where the project appears to it."""

    kind: LauncherKind
    prefix: tuple[str, ...]
    project_root: Path
    """The project as the Ragmir process sees it: the host path, or ``/workspace`` in Docker."""

    def command(self, *args: str, interactive: bool = False) -> list[str]:
        """The full argument list for ``rgr <args>``."""
        if self.kind != "docker":
            return [*self.prefix, *args]
        docker, *rest = self.prefix
        flags = ["-i"] if interactive else []
        image = rest[-1]
        return [docker, *rest[:-1], *flags, image, *args]


def npm_package_spec() -> str:
    """The npm release this package launches: its own version, or the latest in development."""
    return NPM_PACKAGE if __version__ == "0.0.0" else f"{NPM_PACKAGE}@{__version__}"


def resolve_launcher(
    project_root: Path,
    command: Sequence[str] | str | None = None,
    *,
    environ: Mapping[str, str] | None = None,
) -> Launcher:
    """Pick the first available way to run Ragmir for ``project_root``."""
    env = os.environ if environ is None else environ
    explicit = command if command is not None else env.get("RAGMIR_COMMAND")
    if explicit:
        parts = _split(explicit)
        if not parts:
            raise RagmirNotFoundError("The Ragmir command is empty.")
        return Launcher("command", tuple(parts), project_root)

    node = shutil.which("node", path=env.get("PATH"))
    if node:
        entry = _project_cli_entry(project_root)
        if entry:
            return Launcher("project", (node, str(entry)), project_root)
        global_entry = _global_cli_entry(env)
        if global_entry:
            return Launcher("global", global_entry, project_root)
        npx = _npx(node, env)
        if npx:
            return Launcher("npx", (*npx, "--yes", npm_package_spec()), project_root)

    docker = shutil.which("docker", path=env.get("PATH"))
    if docker:
        return Launcher("docker", _docker_prefix(docker, project_root), Path(CONTAINER_ROOT))

    raise RagmirNotFoundError(
        "Ragmir needs Node.js 22.12 or later, or Docker. Install the npm package in the project "
        f"(npm install -D {NPM_PACKAGE}), install Node.js so npx can run it, start Docker to use "
        f"{DOCKER_IMAGE}, or set RAGMIR_COMMAND to the command that runs rgr."
    )


def _split(command: Sequence[str] | str) -> list[str]:
    if isinstance(command, str):
        return shlex.split(command, posix=os.name != "nt")
    return [str(part) for part in command]


def _project_cli_entry(project_root: Path) -> Path | None:
    """The CLI of the Ragmir package installed in the project or one of its parents."""
    for directory in (project_root, *project_root.parents):
        candidate = directory / _CLI_ENTRY
        if candidate.is_file():
            return candidate
    return None


def _global_cli_entry(env: Mapping[str, str]) -> tuple[str, ...] | None:
    rgr = shutil.which("rgr", path=env.get("PATH"))
    if not rgr:
        return None
    if sys.platform != "win32":
        return (rgr,)
    # npm installs rgr.cmd next to the global node_modules folder; run the script it wraps.
    entry = Path(rgr).parent / _CLI_ENTRY
    node = shutil.which("node", path=env.get("PATH"))
    return (node, str(entry)) if node and entry.is_file() else None


def _npx(node: str, env: Mapping[str, str]) -> tuple[str, ...] | None:
    if sys.platform != "win32":
        npx = shutil.which("npx", path=env.get("PATH"))
        return (npx,) if npx else None
    # npx.cmd needs a shell; npm ships the script it runs next to node.exe.
    cli = Path(node).parent / "node_modules" / "npm" / "bin" / "npx-cli.js"
    return (node, str(cli)) if cli.is_file() else None


def _docker_prefix(docker: str, project_root: Path) -> tuple[str, ...]:
    user: list[str] = []
    getuid = getattr(os, "getuid", None)
    getgid = getattr(os, "getgid", None)
    if getuid is not None and getgid is not None:
        # Files the container writes under .ragmir/ then belong to the caller.
        user = ["--user", f"{getuid()}:{getgid()}"]
    version = "latest" if __version__ == "0.0.0" else __version__
    return (
        docker,
        "run",
        "--rm",
        *user,
        "-v",
        f"{project_root}:{CONTAINER_ROOT}",
        "-w",
        CONTAINER_ROOT,
        f"{DOCKER_IMAGE}:{version}",
    )
