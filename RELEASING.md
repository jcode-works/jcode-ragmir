# Releasing

Ragmir publishes to npm through the protected `Release npm` GitHub Actions workflow on `main`.
Do not publish from a local machine.

## Release Flow

1. Start feature work from `develop` on a `feature/*`, `fix/*`, or `chore/*` branch.
2. Open a pull request into `develop` and wait for required checks.
3. From `main`, prepare a `release/*` branch containing the validated `develop` tree, then open a
   release pull request into `main`.
4. Let the `Release npm` workflow run on `main`, or dispatch it manually from `main`.
5. Approve the protected `npm-publish` environment when GitHub asks for review.
6. Verify the Core npm package, the curated GitHub release notes, and release artifacts.
7. Build the landing with the released version, deploy `packages/ragmir-landing/dist` through the
   external deployment process, and run the landing checks below.
8. Sync the GitHub wiki: clone `https://github.com/jcode-works/ragmir.wiki.git`, run
   `pnpm wiki:sync <wiki checkout>`, update the counts and tools on its `Home.md` by hand, then
   commit and push the wiki. Once the plugin pin reaches `main`, refresh the Context7 library from
   its admin page: Context7 indexes `main` and the wiki.

For every release, verify that npm metadata declares `AGPL-3.0-only` and that each tarball contains
`LICENSE`, `COMMERCIAL-LICENSE.md`, and `NOTICE`. The protected validation gate enforces this policy.

The workflow runs `pnpm validate`, then semantic-release derives the next version from
Conventional Commits and publishes `@jcode.labs/ragmir` with npm provenance and the GitHub release.
The same job then pushes the `slim` and `full` Docker targets to `ghcr.io/jcode-works/ragmir` for
`linux/amd64` and `linux/arm64` with SBOM and provenance attestations (tags `X.Y.Z`, `X.Y`, `X`, and
`latest`, plus `-full` variants and `full`), stamps the version into the three Python packages with
`scripts/python-release-version.mjs` and publishes them to PyPI, and publishes `server.json`, with
its npm and OCI packages, to the MCP Registry. Verify every channel after each release. The landing
is private and is not published to npm.

Publishing uses npm trusted publishing: `pnpm publish` exchanges the release job's GitHub OIDC
identity for a short-lived token, so the repository stores no npm token. The npm package settings
must list one trusted publisher with these values: organization `jcode-works`, repository
`ragmir`, workflow `npm-publish.yml`, and environment `npm-publish`. Renaming the workflow,
the environment, or the repository requires updating that entry on npmjs.com first.

PyPI uses trusted publishing the same way: after the release job, one `pypi` job per package
runs `uv publish --trusted-publishing always`, which exchanges the job's OIDC identity, so the
repository stores no PyPI token. PyPI lets a pending publisher create only one project per
repository, workflow, and environment, so each package publishes from its own environment: on
pypi.org, `ragmir`, `langchain-ragmir`, and `llama-index-retrievers-ragmir` each list one trusted
publisher with owner `jcode-works`, repository `ragmir`, workflow `npm-publish.yml`, and
environment `pypi-<package>` (for example `pypi-ragmir`). Those GitHub environments only accept
deployments from `main`. A project that does not exist yet needs that pending publisher before
its first release, and `--check-url` lets a rerun skip files PyPI already holds. The `Docker` workflow builds and smoke-tests both image targets whenever `docker/`
changes, so an image problem surfaces before a release.

The repository intentionally contains no cloud-vendor landing configuration and the npm workflow
does not deploy the site. The external deployment must build with the released version in
`PUBLIC_RAGMIR_VERSION`. Production must use `PUBLIC_RAGMIR_LANDING_URL=https://ragmir.com`; staging
must use its own public URL so canonical and robots metadata cannot fall back to production.

```bash
PUBLIC_RAGMIR_VERSION=<version> PUBLIC_RAGMIR_LANDING_URL=https://ragmir.com \
  pnpm --filter @jcode.labs/ragmir-landing build
```

The host serves `dist/` as static assets, answers an unknown path with `404.html` and status 404,
and redirects a directory path to its trailing slash (`/fr` to `/fr/`). After each deployment,
check that `/`, `/fr/`, and `/team/` answer 200 and show the released version, that an unknown
path answers 404 with the error page, and that `/llms.txt` and `/ai.txt` match the root
`llms.txt`.

## Release Notes Contract

The promotion commit on `main` is the public source for the GitHub release. Its body must contain
these exact sections, each with at least one concise bullet:

```text
fix(release): improve public documentation and release communication

Release highlights:
- make Ragmir easier to understand and adopt without hiding its technical guarantees

Release details:
- **Documentation:** shorten every README and route advanced behavior to focused guides
- **Landing:** present one clear hero statement and keep SEO/GEO metadata aligned
- **Release automation:** publish curated notes with highlights, details, verification, and install links

Verification:
- pass pnpm validate and the Linux x64 and macOS ARM64 CI matrix
- verify the English and French production pages in a browser
```

`scripts/semantic-release-notes.mjs` converts those sections into a GitHub release with highlights,
grouped changes, verification evidence, install commands, package links, artifacts, and a full
changelog link. Semantic release stops before publishing if a release commit omits the contract.

Write the body from the complete `develop` to `main` delta. Mention user-visible outcomes and the
substantial engineering work behind them, not file counts, implementation trivia, or a raw list of
commit subjects. Keep each line within the repository's commitlint limit.

## Versioning Notes

- `feat:` creates a minor release.
- `fix:` and `docs:` create patch releases.
- `feat!:` or a `BREAKING CHANGE:` footer creates a major release.
- `scope: landing` is ignored for npm versioning because the landing is not an npm package.

The first AGPL release is `v3.0.0` because changing the public license from MIT is a breaking legal
change. Release notes must state that earlier versions keep their original license and link to the
commercial licensing option.

For breaking CLI/API releases, make the migration explicit in the Conventional Commit body or
footer and link to `docs/migration.md`. Removed commands and exports require a major release.
Only the `rgr` executable is published.

The agent plugin in `plugins/ragmir/` is installed from this repository, not from npm, with one
manifest per agent: `.claude-plugin/`, `.codex-plugin/`, and `.cursor-plugin/` in the plugin
folder, plus `gemini-extension.json` and `qwen-extension.json` at the repository root. Its MCP
launchers pin the npm release they run (`RAGMIR_VERSION` in `scripts/serve-mcp.mjs`, and
`codex.mcp.json`), because the plugin directories refuse unpinned `npx` commands. After a release
that the plugin should serve, update that pin everywhere it appears (`commands/index.md` and
`docs/agent-integration.md` included) and bump the three plugin manifests' `version` together;
installed plugins only update when that version changes. Set the Gemini and Qwen manifests'
`version` to the pinned release. Gemini CLI and Qwen Code install the source of the latest GitHub
release, whose tree still carries the previous pin, so they receive a new pin with the next
release: change `plugins/ragmir/GEMINI.md` only in the pin step, so the context file of every
release describes the server that release pins. Keep the plugin's `skills/ragmir/SKILL.md`
identical to the Core skill.
`pnpm public:smoke` enforces the identical skill, the shared pin, the aligned plugin versions, and
the identical Gemini and Qwen manifests.

The Agent Skills in `skills/` have no publish step: `npx skills add jcode-works/ragmir`
installs them from the default branch, and skills.sh lists them from those installs, grouped by
`skills.sh.json`. They run the project's own install of the npm package, so they need no version
pin. `pnpm public:smoke` checks them against the Agent Skills specification, keeps
`skills/ragmir/SKILL.md` identical to the Core skill, and requires every skill in one grouping.

In Claude Code, the `release-ragmir` project skill walks through a promotion, the verification of
every channel, and the plugin pin that follows.

## Required Local Checks

Run the full gate before opening or updating a release pull request:

```bash
pnpm validate
```

For narrower preflight while iterating, use the package-level checks that match the edited area,
then run `pnpm validate` before release.
