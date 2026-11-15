"""Shared fixtures: a small Ragmir base indexed by the CLI built from this repository."""

from __future__ import annotations

import os
import shutil
from collections.abc import Iterator
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
CLI_ENTRY = REPO_ROOT / "packages" / "ragmir-core" / "dist" / "cli-entry.js"

RUNBOOK_STEPS = 9


def _command() -> list[str]:
    configured = os.environ.get("RAGMIR_TEST_COMMAND")
    if configured:
        return configured.split()
    node = shutil.which("node")
    if not node or not CLI_ENTRY.is_file():
        pytest.skip("Build Ragmir first: pnpm --filter @jcode.labs/ragmir build")
    return [node, str(CLI_ENTRY)]


@pytest.fixture(scope="session")
def ragmir_command() -> Iterator[list[str]]:
    """The command that runs this repository's Ragmir, exported as RAGMIR_COMMAND."""
    command = _command()
    previous = os.environ.get("RAGMIR_COMMAND")
    os.environ["RAGMIR_COMMAND"] = " ".join(f'"{part}"' for part in command)
    try:
        yield command
    finally:
        if previous is None:
            os.environ.pop("RAGMIR_COMMAND", None)
        else:
            os.environ["RAGMIR_COMMAND"] = previous


@pytest.fixture(scope="session")
def indexed_project(tmp_path_factory: pytest.TempPathFactory, ragmir_command: list[str]) -> Path:
    """A project whose refund documents, notes, and long runbook are indexed."""
    from ragmir import add_sources, init_project, run_cli

    root = tmp_path_factory.mktemp("ragmir-project")
    files = {
        "docs/refunds.md": "# Refunds\n\nRefund requests are approved by the billing team "
        "within 14 days.\n",
        "docs/returns.md": "# Returns\n\nReturn labels for refund requests expire after 30 days.\n",
        "docs/chargebacks.md": "# Chargebacks\n\nA chargeback replaces a refund when the bank "
        "disputes the payment.\n",
        "notes/refund-faq.txt": "Refund FAQ: customers request a refund from the billing portal.\n",
        "docs/runbook.md": "\n\n".join(
            f"## Step {step}\n\n"
            + f"Step {step} of the database migration runbook keeps the service online. " * 8
            for step in range(1, RUNBOOK_STEPS + 1)
        ),
    }
    for relative, content in files.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
    init_project(root, command=ragmir_command)
    add_sources(root, ["docs", "notes"], command=ragmir_command)
    run_cli(root, "ingest", command=ragmir_command)
    return root
