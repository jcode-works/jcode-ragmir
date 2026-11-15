---
paths:
  - "python/**"
---

# Python packages

- `python/` is a uv workspace with three packages: `ragmir` (the client), `langchain-ragmir`, and
  `llama-index-retrievers-ragmir` (a `llama_index.retrievers` namespace package). They drive the
  Core MCP server; they never reimplement retrieval.
- Run everything with `pnpm python:check`: it builds Core, then runs `uv sync --locked`, Ruff
  lint and format checks, strict mypy, and pytest against the built `dist/cli-entry.js`.
- Keep `version = "0.0.0"` and `__version__ = "0.0.0"` in the sources: the release workflow runs
  `scripts/python-release-version.mjs` to stamp the npm version and pin `ragmir==X.Y.Z` in the
  integrations. `node scripts/python-release-version.mjs --check` verifies the placeholders.
- Change dependencies in a `pyproject.toml`, then run `uv lock` in `python/`; never edit `uv.lock`.
- The LangChain retriever and tools must keep passing the `langchain-tests` standard suites in
  `packages/langchain-ragmir/tests/test_standard.py`. Public names appear in `docs/python.md`.
- Support Python 3.11 through 3.14 (the CI matrix), and keep every module typed (`py.typed`).
