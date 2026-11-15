from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest
from ragmir import RagmirNotFoundError, resolve_launcher
from ragmir._launcher import npm_package_spec

pytestmark = pytest.mark.skipif(
    sys.platform == "win32", reason="fake executables are shell scripts"
)


def _executable(directory: Path, name: str) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / name
    path.write_text("#!/bin/sh\nexit 0\n")
    path.chmod(0o755)
    return path


def _env(bin_dir: Path, **extra: str) -> dict[str, str]:
    return {"PATH": str(bin_dir), **extra}


def test_explicit_command_wins(tmp_path: Path) -> None:
    launcher = resolve_launcher(tmp_path, "node /opt/ragmir/cli.js", environ=_env(tmp_path))

    assert launcher.kind == "command"
    assert launcher.command("serve-mcp") == ["node", "/opt/ragmir/cli.js", "serve-mcp"]


def test_ragmir_command_environment_variable(tmp_path: Path) -> None:
    env = _env(tmp_path, RAGMIR_COMMAND="rgr-dev --verbose")

    assert resolve_launcher(tmp_path, environ=env).command("status") == [
        "rgr-dev",
        "--verbose",
        "status",
    ]


def test_project_install_comes_before_npx(tmp_path: Path) -> None:
    bin_dir = tmp_path / "bin"
    node = _executable(bin_dir, "node")
    _executable(bin_dir, "npx")
    project = tmp_path / "app" / "packages" / "web"
    project.mkdir(parents=True)
    entry = tmp_path / "app" / "node_modules" / "@jcode.labs" / "ragmir" / "dist" / "cli-entry.js"
    entry.parent.mkdir(parents=True)
    entry.write_text("")

    launcher = resolve_launcher(project, environ=_env(bin_dir))

    assert launcher.kind == "project"
    assert launcher.command("ingest") == [str(node), str(entry), "ingest"]


def test_global_rgr_then_pinned_npx(tmp_path: Path) -> None:
    bin_dir = tmp_path / "bin"
    _executable(bin_dir, "node")
    npx = _executable(bin_dir, "npx")
    assert resolve_launcher(tmp_path, environ=_env(bin_dir)).command("serve-mcp") == [
        str(npx),
        "--yes",
        npm_package_spec(),
        "serve-mcp",
    ]

    rgr = _executable(bin_dir, "rgr")
    launcher = resolve_launcher(tmp_path, environ=_env(bin_dir))
    assert launcher.kind == "global"
    assert launcher.command("doctor") == [str(rgr), "doctor"]


def test_docker_mounts_the_project_and_keeps_stdin_for_mcp(tmp_path: Path) -> None:
    docker = _executable(tmp_path / "bin", "docker")
    launcher = resolve_launcher(tmp_path, environ=_env(tmp_path / "bin"))

    server = launcher.command("serve-mcp", interactive=True)
    assert launcher.kind == "docker"
    assert launcher.project_root == Path("/workspace")
    assert server[:3] == [str(docker), "run", "--rm"]
    assert f"{tmp_path}:/workspace" in server
    assert server[-3] == "-i"
    assert server[-2].startswith("ghcr.io/jcode-works/ragmir:")
    assert server[-1] == "serve-mcp"
    assert f"{os.getuid()}:{os.getgid()}" in server
    assert "-i" not in launcher.command("init")


def test_explains_what_to_install_when_nothing_runs_ragmir(tmp_path: Path) -> None:
    with pytest.raises(RagmirNotFoundError, match=r"Node\.js 22\.12 or later, or Docker"):
        resolve_launcher(tmp_path, environ=_env(tmp_path / "empty"))
