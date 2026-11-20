---
name: release-ragmir
description: Promote the validated develop branch to main and publish a Ragmir release to npm, GHCR, PyPI, the MCP Registry, and GitHub Releases, then verify every channel and pin the agent plugins to the new version. Use when the maintainer asks to release, promote, ship, or publish Ragmir.
metadata:
  internal: "true"
---

# Release Ragmir

A release needs the maintainer's explicit go-ahead. Everything ships from `main` through the
`Release npm` workflow; never publish from a workstation.

## 1. Preflight

```bash
git fetch origin
git log --oneline origin/main..origin/develop     # the commits being promoted
git diff --stat origin/main origin/develop
```

- `develop` must hold every change with green CI. Run `pnpm validate` and `pnpm python:check` on it.
- semantic-release derives the version from those Conventional Commits: `feat` gives a minor,
  `fix` and `docs` a patch, `!` or `BREAKING CHANGE:` a major; `scope: landing` publishes nothing.
- A new PyPI project, or a renamed workflow, environment, or repository, needs its trusted
  publisher on pypi.org first (owner `jcode-works`, repository `ragmir`, workflow
  `npm-publish.yml`, environment `pypi-<package>`, one per project). npm has the same entry on
  npmjs.com, with environment `npm-publish`. Only the maintainer can sign in there.

## 2. Promotion commit

Build the release branch from `main` with exactly the `develop` tree:

```bash
git switch -c release/<topic> origin/main
git restore --source=origin/develop --staged --worktree -- .
git diff --cached --stat
git diff --cached origin/develop --stat           # must print nothing
```

Commit with a body written from the whole delta. `scripts/semantic-release-notes.mjs` turns it
into the GitHub release and refuses a release commit without these sections:

```text
feat(core): <the release in one line>

Release highlights:
- <user outcome, in plain words>

Release details:
- **<Product area>:** <meaningful change>; long bullets continue on lines
  indented by two spaces

Verification:
- <each gate actually run, such as pnpm validate and the CI matrix>
```

Keep every line within 100 characters and check it with `pnpm commitlint`. Push the branch and
open a pull request into `main`.

## 3. Merge and publish

- Wait for the required checks (Quality gate, Commitlint, Analyze TypeScript), then merge with a
  merge commit (`gh pr merge <number> --merge`). Never squash or rebase.
- The `Release npm` run on `main` waits for the `npm-publish` environment approval. After it, the
  release job publishes npm with provenance and the GitHub release, then the slim and full GHCR
  images and the MCP Registry entry; three `pypi` jobs, one per package and environment, then
  publish the Python packages.

## 4. Verify every channel

```bash
npm view @jcode.labs/ragmir version license
gh release view v<version>
docker buildx imagetools inspect ghcr.io/jcode-works/ragmir:<version>
docker buildx imagetools inspect ghcr.io/jcode-works/ragmir:<version>-full
curl -s https://pypi.org/pypi/ragmir/json | jq -r .info.version   # also langchain-ragmir and
                                                                  # llama-index-retrievers-ragmir
curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=io.github.jcode-works/ragmir"
```

Check that the npm license is `AGPL-3.0-only` and the tarball holds `LICENSE`,
`COMMERCIAL-LICENSE.md`, and `NOTICE`. Check that the GitHub release lists `darwin.`, `linux.`,
and `win32.ragmir.tar.gz`, and that `gemini extensions install
https://github.com/jcode-works/ragmir` in an empty `HOME` reports the new version. Build the landing
with `PUBLIC_RAGMIR_VERSION` set to the release, deploy it through its external process, and run
the landing checks in `RELEASING.md`.
Then sync the GitHub wiki with `pnpm wiki:sync <wiki checkout>` (a clone of
`ragmir.wiki.git`), review its `Home.md`, and push it.

## 5. Pin the agent plugins

The plugins pin the npm release their MCP server runs, so they follow each release in a second,
non-publishing promotion:

1. On a branch from `develop`, set the new version in `RAGMIR_VERSION`
   (`plugins/ragmir/scripts/serve-mcp.mjs`), `plugins/ragmir/codex.mcp.json`, every
   `@jcode.labs/ragmir@<version>` in `plugins/ragmir/` and `docs/agent-integration.md`, and
   `gemini-extension.json` and `qwen-extension.json`; bump the three plugin manifests' `version`
   together. Update the plugin README, `GEMINI.md`, and `commands/index.md` for any new tools.
   Gemini CLI and Qwen Code do not wait for this pin: each release attaches their extension,
   stamped to that release, as `darwin.`, `linux.`, and `win32.ragmir.tar.gz`.
2. Run `pnpm public:smoke` and `claude plugin validate plugins/ragmir`, merge into `develop`, then
   promote with a `chore(plugin): ...` commit, which publishes nothing. Its `Release npm` run still
   waits for the `npm-publish` approval and then reports no release.
3. Once that promotion lands, refresh the Context7 library: `POST
   https://context7.com/api/v1/refresh` with `{"libraryName": "/jcode-works/ragmir"}` and the
   maintainer's Context7 API key as the bearer token (or the Refresh button of its admin page).
   Context7 indexes `main` and the wiki.

Report the version, each channel's verification, and anything left for the maintainer.
