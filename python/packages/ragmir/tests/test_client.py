from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from ragmir import (
    AsyncRagmir,
    Ragmir,
    RagmirCommandError,
    RagmirError,
    RagmirToolError,
    run_cli,
    shared_client,
)


@pytest.fixture(scope="module")
def rag(indexed_project: Path) -> Ragmir:
    client = Ragmir(indexed_project)
    yield client
    client.close()


def test_search_returns_cited_passages(rag: Ragmir) -> None:
    passages = rag.search("who approves refund requests", top_k=3)

    assert passages, "expected cited passages"
    first = passages[0]
    assert first.path == "docs/refunds.md"
    assert first.citation.startswith("docs/refunds.md:L")
    assert "billing team" in first.text
    assert first.line_start == 1
    assert first.weak_evidence is False
    assert first.source_status is None
    assert first.evidence_id


def test_search_returns_nothing_without_evidence(rag: Ragmir) -> None:
    assert rag.search("chocolate cake baking temperature") == []


def test_search_filters_with_globs(rag: Ragmir) -> None:
    passages = rag.search("refund", include_paths=["**/*.txt"])

    assert [passage.path for passage in passages] == ["notes/refund-faq.txt"]
    excluded = rag.search("refund", exclude_paths=["docs"], top_k=5)
    assert all(passage.path.startswith("notes/") for passage in excluded)


def test_search_many_answers_each_question(rag: Ragmir) -> None:
    answers = rag.search_many(["refund approval", "return label expiry"])

    assert set(answers) == {"refund approval", "return label expiry"}
    assert answers["return label expiry"][0].path == "docs/returns.md"


def test_expand_reads_a_document_through(rag: Ragmir) -> None:
    first = rag.search("Step 1 of the database migration runbook", top_k=1)[0]
    window = rag.expand(first.citation, context_radius=1)

    assert window.found
    assert window.document_chunks and window.document_chunks > 3
    read = {passage.chunk_index for passage in window.passages}
    while window.next_citation:
        window = rag.expand(window.next_citation, context_radius=1)
        read.update(passage.chunk_index for passage in window.passages)
    assert read == set(range(window.document_chunks or 0))
    assert "Step 9" in window.text


def test_expand_reports_a_citation_outside_the_index(rag: Ragmir) -> None:
    missing = rag.expand("docs/unknown.md#99")

    assert missing.found is False
    assert missing.passages == ()
    with pytest.raises(RagmirToolError, match="chunk suffix"):
        rag.expand("not a citation")


def test_sources_lists_documents_by_glob(rag: Ragmir) -> None:
    catalog = rag.sources(paths=["docs/**/*.md"], limit=2)

    assert catalog.matched_files == 4
    assert len(catalog.files) == 2
    assert catalog.next_offset == 2
    assert rag.sources(paths=["notes"]).files[0].path == "notes/refund-faq.txt"


def test_status_reports_a_ready_base(rag: Ragmir, indexed_project: Path) -> None:
    status = rag.status()

    assert status.ready
    assert status.indexed_files == 5
    assert Path(status.project_root) == indexed_project


def test_concurrent_calls_share_one_server(rag: Ragmir) -> None:
    questions = ["refund approval", "return labels", "chargeback", "billing portal"] * 3
    with ThreadPoolExecutor(max_workers=6) as executor:
        answers = list(executor.map(lambda question: rag.search(question, top_k=1), questions))

    assert all(answers)


def test_ingest_refreshes_changed_sources(tmp_path: Path, ragmir_command: list[str]) -> None:
    from ragmir import add_sources, init_project

    (tmp_path / "docs").mkdir()
    (tmp_path / "docs" / "laptops.md").write_text("Laptops are replaced every 3 years.\n")
    init_project(tmp_path)
    add_sources(tmp_path, ["docs"])
    with Ragmir(tmp_path) as client:
        first = client.ingest()
        assert first.status == "completed"
        assert first.indexed_files == 1

        (tmp_path / "docs" / "travel.md").write_text("Trains are preferred under 4 hours.\n")
        second = client.ingest()
        assert (second.rebuilt_files, second.reused_files) == (1, 1)
        assert client.search("trains preferred")[0].path == "docs/travel.md"


async def test_async_client_from_asyncio(indexed_project: Path) -> None:
    async with AsyncRagmir(indexed_project) as client:
        passages, status = await asyncio.gather(client.search("refund approval"), client.status())

    assert passages[0].path == "docs/refunds.md"
    assert status.ready


async def test_sync_client_async_twins(rag: Ragmir) -> None:
    passages = await rag.asearch("return labels")
    catalog = await rag.asources(paths=["notes"])

    assert passages[0].path == "docs/returns.md"
    assert catalog.files[0].path == "notes/refund-faq.txt"


def test_shared_client_is_reused_per_project(indexed_project: Path) -> None:
    first = shared_client(indexed_project)
    second = shared_client(str(indexed_project))

    assert first is second
    assert first.search("refund approval")


def test_closed_client_refuses_calls(indexed_project: Path) -> None:
    client = Ragmir(indexed_project)
    client.close()

    with pytest.raises(RagmirError, match="closed"):
        client.search("refund")


def test_run_cli_reports_failures(indexed_project: Path) -> None:
    assert "Ragmir" in run_cli(indexed_project, "--help")
    with pytest.raises(RagmirCommandError) as failure:
        run_cli(indexed_project, "no-such-command")
    assert failure.value.returncode != 0
