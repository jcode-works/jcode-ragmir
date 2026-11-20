"""Clients that keep one Ragmir MCP server running per project and reuse it for every call."""

from __future__ import annotations

import asyncio
import concurrent.futures
import json
import logging
import os
import tempfile
import threading
from collections.abc import Coroutine, Mapping, Sequence
from pathlib import Path
from typing import Any, TextIO, TypeVar

from mcp import Client, Implementation, MCPError, StdioServerParameters, stdio_client
from mcp.types import TextContent

from ._errors import RagmirError, RagmirServerError, RagmirToolError
from ._launcher import resolve_launcher
from ._models import (
    ExpandedCitation,
    IngestReport,
    Passage,
    SearchFormulation,
    SourceCatalog,
    Status,
)
from ._version import __version__

logger = logging.getLogger("ragmir")

T = TypeVar("T")

DEFAULT_TIMEOUT = 120.0
"""Seconds to wait for the server to start and for each call to answer."""

# The server caps every answer at its configured mcpMaxOutputBytes; ask for that ceiling.
_MAX_OUTPUT_BYTES = 1_048_576
_INGEST_WAIT_SECONDS = 60
_STDERR_TAIL_CHARACTERS = 2_000


class AsyncRagmir:
    """Async client for one Ragmir knowledge base, for asyncio applications.

    The MCP server starts on the first call, or with ``connect()``, and serves every later call. A
    background task owns the connection, so any task may call or close the client. Close it with
    ``aclose()``, or use ``async with``.

    >>> async with AsyncRagmir("path/to/project") as rag:
    ...     for passage in await rag.search("release approval"):
    ...         print(passage.citation, passage.text)
    """

    def __init__(
        self,
        project_root: str | os.PathLike[str] = ".",
        *,
        command: Sequence[str] | str | None = None,
        env: Mapping[str, str] | None = None,
        timeout: float = DEFAULT_TIMEOUT,
    ) -> None:
        self.project_root = Path(project_root).expanduser().resolve()
        self._command = command
        self._env = dict(env) if env is not None else {}
        self._timeout = timeout
        self._client: Client | None = None
        self._owner: asyncio.Task[None] | None = None
        self._stop: asyncio.Event | None = None
        self._lock: asyncio.Lock | None = None
        self._stderr: TextIO | None = None
        self._closed = False

    async def __aenter__(self) -> AsyncRagmir:
        await self.connect()
        return self

    async def __aexit__(self, *_exc: object) -> None:
        await self.aclose()

    async def connect(self) -> None:
        """Start the MCP server now instead of on the first call."""
        await self._session()

    async def aclose(self) -> None:
        """Stop the MCP server. The client cannot be used afterwards."""
        self._closed = True
        await self._shutdown()
        if self._stderr is not None:
            self._stderr.close()
            self._stderr = None

    async def search(
        self,
        query: str,
        *,
        top_k: int | None = None,
        include_paths: Sequence[str] | None = None,
        exclude_paths: Sequence[str] | None = None,
        scope: str | None = None,
        max_chunks_per_document: int | None = None,
        context_radius: int | None = None,
        searches: Sequence[SearchFormulation] | None = None,
    ) -> list[Passage]:
        """Cited passages that answer ``query``; an empty list means the base holds no evidence.

        ``include_paths`` and ``exclude_paths`` take folders, files, or globs such as ``**/*.pdf``.
        ``top_k`` is capped by the base's ``mcpMaxTopK`` setting (10 by default). ``searches``
        adds up to five formulations of the same question, such as
        ``{"type": "lex", "query": '"rate limit" -deprecated'}``, fused into one ranking.
        """
        arguments = _search_arguments(
            top_k, include_paths, exclude_paths, scope, max_chunks_per_document, context_radius
        )
        if searches is not None:
            arguments["searches"] = [dict(formulation) for formulation in searches]
        data = await self._call_json("ragmir_search", {"query": query, **arguments})
        return [Passage.from_json(item) for item in _list(data)]

    async def search_many(
        self,
        queries: Sequence[str],
        *,
        top_k: int | None = None,
        include_paths: Sequence[str] | None = None,
        exclude_paths: Sequence[str] | None = None,
        scope: str | None = None,
        max_chunks_per_document: int | None = None,
        context_radius: int | None = None,
    ) -> dict[str, list[Passage]]:
        """Up to five related questions in one call, each with its own cited passages."""
        arguments = _search_arguments(
            top_k, include_paths, exclude_paths, scope, max_chunks_per_document, context_radius
        )
        data = await self._call_json("ragmir_search", {"queries": list(queries), **arguments})
        if len(queries) == 1:
            return {queries[0]: [Passage.from_json(item) for item in _list(data)]}
        return {
            str(group.get("query", "")): [
                Passage.from_json(item) for item in _list(group.get("results"))
            ]
            for group in _list(data)
        }

    async def expand(
        self,
        citation: str,
        *,
        context_radius: int | None = None,
        expected_evidence_id: str | None = None,
    ) -> ExpandedCitation:
        """A citation with up to three neighbouring passages on each side.

        Expand ``next_citation`` with the same radius to read the rest of the document. Pass the
        ``evidence_id`` of a search result to fail if the indexed passage changed since.
        """
        arguments: dict[str, Any] = {"citation": citation, "maxBytes": _MAX_OUTPUT_BYTES}
        if context_radius is not None:
            arguments["contextRadius"] = context_radius
        if expected_evidence_id is not None:
            arguments["expectedEvidenceId"] = expected_evidence_id
        data = await self._call_json("ragmir_expand", arguments)
        return ExpandedCitation.from_json(_mapping(data))

    async def sources(
        self,
        *,
        paths: Sequence[str] | None = None,
        offset: int | None = None,
        limit: int | None = None,
    ) -> SourceCatalog:
        """One page of the indexed documents, optionally under folders or matching globs."""
        arguments: dict[str, Any] = {"maxBytes": _MAX_OUTPUT_BYTES}
        if paths is not None:
            arguments["paths"] = list(paths)
        if offset is not None:
            arguments["offset"] = offset
        if limit is not None:
            arguments["limit"] = limit
        data = await self._call_json("ragmir_sources", arguments)
        return SourceCatalog.from_json(_mapping(data))

    async def status(self) -> Status:
        """Readiness, freshness, and identity of the knowledge base."""
        return Status.from_json(_mapping(await self._call_json("ragmir_status", {})))

    async def audit(self, *, detail: bool = False) -> dict[str, Any]:
        """Missing, stale, unsupported, and duplicated sources, as the server reports them."""
        data = await self._call_json(
            "ragmir_audit", {"detail": detail, "maxBytes": _MAX_OUTPUT_BYTES}
        )
        return dict(_mapping(data))

    async def ingest(self, *, wait: bool = True) -> IngestReport:
        """Refresh the index incrementally: only new and changed files are read again.

        With ``wait=False`` the run continues in the background and the report says ``running``.
        Ragmir refuses when the base disables MCP indexing or ``rgr security-audit`` warns; run
        ``run_cli(project, "ingest")`` from an operator script in that case.
        """
        while True:
            data = _mapping(
                await self._call_json(
                    "ragmir_ingest",
                    {"waitSeconds": _INGEST_WAIT_SECONDS if wait else 0},
                    timeout=_INGEST_WAIT_SECONDS + self._timeout,
                )
            )
            report = IngestReport.from_json(data)
            if report.status != "running" or not wait:
                return report

    async def _call_json(
        self, tool: str, arguments: dict[str, Any], *, timeout: float | None = None
    ) -> Any:
        client = await self._session()
        try:
            result = await client.call_tool(
                tool, arguments, read_timeout_seconds=timeout or self._timeout
            )
        except MCPError as error:
            raise RagmirServerError(f"{tool} failed: {error}") from error
        except Exception as error:
            # Tool failures come back as results; an exception means the connection broke.
            raise RagmirServerError(
                f"{tool} lost the Ragmir server: {error}.{self._stderr_tail()}"
            ) from error
        texts = [item.text for item in result.content if isinstance(item, TextContent)]
        if result.is_error:
            raise RagmirToolError("\n".join(texts) or f"{tool} failed.")
        if not texts:
            raise RagmirServerError(f"{tool} returned no content.")
        for notice in texts[1:]:
            logger.warning("%s: %s", tool, notice)
        try:
            return json.loads(texts[0])
        except json.JSONDecodeError as error:
            raise RagmirServerError(f"{tool} returned invalid JSON: {texts[0][:200]}") from error

    async def _session(self) -> Client:
        if self._lock is None:
            self._lock = asyncio.Lock()
        async with self._lock:
            if self._closed:
                raise RagmirError("This Ragmir client is closed.")
            if self._client is not None and self._owner is not None and not self._owner.done():
                return self._client
            # The server stopped since the last call: start a fresh one.
            await self._shutdown()
            loop = asyncio.get_running_loop()
            ready: asyncio.Future[Client] = loop.create_future()
            self._stop = asyncio.Event()
            self._owner = asyncio.create_task(
                self._own_session(ready, self._stop), name="ragmir-mcp-session"
            )
            try:
                self._client = await asyncio.wait_for(asyncio.shield(ready), self._timeout)
            except Exception as error:
                await self._shutdown()
                if isinstance(error, RagmirError):
                    raise
                raise RagmirServerError(
                    f"The Ragmir MCP server did not start for {self.project_root}: {error}."
                    f"{self._stderr_tail()}"
                ) from error
            return self._client

    async def _own_session(self, ready: asyncio.Future[Client], stop: asyncio.Event) -> None:
        """Enter and leave the MCP connection in this one task, as anyio requires."""
        try:
            launcher = resolve_launcher(self.project_root, self._command)
            argv = launcher.command("serve-mcp", interactive=True)
            env = {**os.environ, **self._env}
            if launcher.kind != "docker":
                env["RAGMIR_PROJECT_ROOT"] = str(self.project_root)
            if self._stderr is None:
                # Kept for the client's lifetime to report the server's output; aclose() closes it.
                self._stderr = tempfile.TemporaryFile("w+", encoding="utf-8")  # noqa: SIM115
            params = StdioServerParameters(
                command=argv[0], args=argv[1:], env=env, cwd=str(self.project_root)
            )
            async with Client(
                stdio_client(params, errlog=self._stderr),
                mode="legacy",
                read_timeout_seconds=self._timeout,
                client_info=Implementation(name="ragmir-python", version=__version__),
            ) as client:
                ready.set_result(client)
                await stop.wait()
        except BaseException as error:
            if not ready.done():
                ready.set_exception(error)
            elif not isinstance(error, asyncio.CancelledError):
                logger.warning("The Ragmir MCP server stopped: %s", error)
            if isinstance(error, asyncio.CancelledError | KeyboardInterrupt | SystemExit):
                raise

    async def _shutdown(self) -> None:
        owner, stop = self._owner, self._stop
        self._client = None
        self._owner = None
        self._stop = None
        if owner is None:
            return
        if stop is not None:
            stop.set()
        try:
            await asyncio.wait_for(owner, timeout=10)
        except (TimeoutError, Exception):
            owner.cancel()

    def _stderr_tail(self) -> str:
        if self._stderr is None:
            return ""
        try:
            self._stderr.flush()
            self._stderr.seek(0)
            tail = self._stderr.read()[-_STDERR_TAIL_CHARACTERS:].strip()
        except (OSError, ValueError):
            return ""
        return f"\nServer output:\n{tail}" if tail else ""


class Ragmir:
    """Client for one Ragmir knowledge base, from synchronous or asynchronous code.

    One MCP server runs per client on a private event loop thread, so the client works from any
    thread, a notebook, or a web framework. Each method has an ``a``-prefixed async twin for
    asyncio code. Close the client with ``close()``, or use ``with``.

    >>> with Ragmir("path/to/project") as rag:
    ...     for passage in rag.search("release approval"):
    ...         print(passage.citation, passage.text)
    """

    def __init__(
        self,
        project_root: str | os.PathLike[str] = ".",
        *,
        command: Sequence[str] | str | None = None,
        env: Mapping[str, str] | None = None,
        timeout: float = DEFAULT_TIMEOUT,
    ) -> None:
        self._async = AsyncRagmir(project_root, command=command, env=env, timeout=timeout)
        self._loop: asyncio.AbstractEventLoop | None = None
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()
        self._closed = False

    @property
    def project_root(self) -> Path:
        return self._async.project_root

    @property
    def closed(self) -> bool:
        return self._closed

    def __enter__(self) -> Ragmir:
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    def connect(self) -> None:
        """Start the MCP server now instead of on the first call."""
        self._run(self._async.connect())

    def close(self) -> None:
        """Stop the MCP server and its thread. The client cannot be used afterwards."""
        with self._lock:
            if self._closed:
                return
            self._closed = True
            loop, thread = self._loop, self._thread
        if loop is None or thread is None:
            return
        try:
            asyncio.run_coroutine_threadsafe(self._async.aclose(), loop).result(timeout=30)
        except (concurrent.futures.TimeoutError, RagmirError, RuntimeError):
            logger.warning("The Ragmir MCP server did not stop cleanly.")
        finally:
            loop.call_soon_threadsafe(loop.stop)
            thread.join(timeout=10)

    def search(
        self,
        query: str,
        *,
        top_k: int | None = None,
        include_paths: Sequence[str] | None = None,
        exclude_paths: Sequence[str] | None = None,
        scope: str | None = None,
        max_chunks_per_document: int | None = None,
        context_radius: int | None = None,
        searches: Sequence[SearchFormulation] | None = None,
    ) -> list[Passage]:
        """Cited passages that answer ``query``; an empty list means the base holds no evidence."""
        return self._run(
            self._async.search(
                query,
                top_k=top_k,
                include_paths=include_paths,
                exclude_paths=exclude_paths,
                scope=scope,
                max_chunks_per_document=max_chunks_per_document,
                context_radius=context_radius,
                searches=searches,
            )
        )

    async def asearch(
        self,
        query: str,
        *,
        top_k: int | None = None,
        include_paths: Sequence[str] | None = None,
        exclude_paths: Sequence[str] | None = None,
        scope: str | None = None,
        max_chunks_per_document: int | None = None,
        context_radius: int | None = None,
        searches: Sequence[SearchFormulation] | None = None,
    ) -> list[Passage]:
        """Async twin of ``search``."""
        return await self._arun(
            self._async.search(
                query,
                top_k=top_k,
                include_paths=include_paths,
                exclude_paths=exclude_paths,
                scope=scope,
                max_chunks_per_document=max_chunks_per_document,
                context_radius=context_radius,
                searches=searches,
            )
        )

    def search_many(self, queries: Sequence[str], **options: Any) -> dict[str, list[Passage]]:
        """Up to five related questions in one call, each with its own cited passages."""
        return self._run(self._async.search_many(queries, **options))

    async def asearch_many(
        self, queries: Sequence[str], **options: Any
    ) -> dict[str, list[Passage]]:
        """Async twin of ``search_many``."""
        return await self._arun(self._async.search_many(queries, **options))

    def expand(
        self,
        citation: str,
        *,
        context_radius: int | None = None,
        expected_evidence_id: str | None = None,
    ) -> ExpandedCitation:
        """A citation with its neighbours; expand ``next_citation`` to read on."""
        return self._run(
            self._async.expand(
                citation, context_radius=context_radius, expected_evidence_id=expected_evidence_id
            )
        )

    async def aexpand(
        self,
        citation: str,
        *,
        context_radius: int | None = None,
        expected_evidence_id: str | None = None,
    ) -> ExpandedCitation:
        """Async twin of ``expand``."""
        return await self._arun(
            self._async.expand(
                citation, context_radius=context_radius, expected_evidence_id=expected_evidence_id
            )
        )

    def sources(
        self,
        *,
        paths: Sequence[str] | None = None,
        offset: int | None = None,
        limit: int | None = None,
    ) -> SourceCatalog:
        """One page of the indexed documents, optionally under folders or matching globs."""
        return self._run(self._async.sources(paths=paths, offset=offset, limit=limit))

    async def asources(
        self,
        *,
        paths: Sequence[str] | None = None,
        offset: int | None = None,
        limit: int | None = None,
    ) -> SourceCatalog:
        """Async twin of ``sources``."""
        return await self._arun(self._async.sources(paths=paths, offset=offset, limit=limit))

    def status(self) -> Status:
        """Readiness, freshness, and identity of the knowledge base."""
        return self._run(self._async.status())

    async def astatus(self) -> Status:
        """Async twin of ``status``."""
        return await self._arun(self._async.status())

    def audit(self, *, detail: bool = False) -> dict[str, Any]:
        """Missing, stale, unsupported, and duplicated sources."""
        return self._run(self._async.audit(detail=detail))

    async def aaudit(self, *, detail: bool = False) -> dict[str, Any]:
        """Async twin of ``audit``."""
        return await self._arun(self._async.audit(detail=detail))

    def ingest(self, *, wait: bool = True) -> IngestReport:
        """Refresh the index incrementally; only new and changed files are read again."""
        return self._run(self._async.ingest(wait=wait))

    async def aingest(self, *, wait: bool = True) -> IngestReport:
        """Async twin of ``ingest``."""
        return await self._arun(self._async.ingest(wait=wait))

    def _submit(self, coroutine: Coroutine[Any, Any, T]) -> concurrent.futures.Future[T]:
        with self._lock:
            if self._closed:
                coroutine.close()
                raise RagmirError("This Ragmir client is closed.")
            if self._loop is None:
                loop = asyncio.new_event_loop()
                # A daemon thread never blocks interpreter exit; the server exits on stdin EOF.
                thread = threading.Thread(
                    target=_run_loop, args=(loop,), name="ragmir-mcp", daemon=True
                )
                thread.start()
                self._loop, self._thread = loop, thread
            return asyncio.run_coroutine_threadsafe(coroutine, self._loop)

    def _run(self, coroutine: Coroutine[Any, Any, T]) -> T:
        return self._submit(coroutine).result()

    async def _arun(self, coroutine: Coroutine[Any, Any, T]) -> T:
        return await asyncio.wrap_future(self._submit(coroutine))


def _run_loop(loop: asyncio.AbstractEventLoop) -> None:
    asyncio.set_event_loop(loop)
    try:
        loop.run_forever()
    finally:
        loop.close()


def _search_arguments(
    top_k: int | None,
    include_paths: Sequence[str] | None,
    exclude_paths: Sequence[str] | None,
    scope: str | None,
    max_chunks_per_document: int | None,
    context_radius: int | None,
) -> dict[str, Any]:
    # Full passages, every time: a library caller expects the same answer to the same question,
    # so passages already returned in the session are not shortened to stubs.
    arguments: dict[str, Any] = {"compact": False, "seen": "include", "maxBytes": _MAX_OUTPUT_BYTES}
    if top_k is not None:
        arguments["topK"] = top_k
    if include_paths is not None:
        arguments["includePaths"] = list(include_paths)
    if exclude_paths is not None:
        arguments["excludePaths"] = list(exclude_paths)
    if scope is not None:
        arguments["scope"] = scope
    if max_chunks_per_document is not None:
        arguments["maxChunksPerDocument"] = max_chunks_per_document
    if context_radius is not None:
        arguments["contextRadius"] = context_radius
    return arguments


def _list(value: object) -> list[Mapping[str, Any]]:
    return [item for item in value if isinstance(item, Mapping)] if isinstance(value, list) else []


def _mapping(value: object) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise RagmirServerError("Ragmir returned an unexpected answer.")
    return value
