# Contributing

Ragmir is an open-source MIT project. Issues and pull requests are welcome.

Ragmir is maintained by a single developer ([Jean-Baptiste Thery](https://github.com/jb-thery)).
Be kind, be specific, and keep the scope of each contribution focused so it can be reviewed
within a reasonable time.

## Reporting Issues

Use the [issue templates](https://github.com/jcode-works/jcode-ragmir/issues/new/choose):

- **Bug report**: include the Ragmir version, a minimal reproduction (commands + sample files,
  no private documents or secrets), and the expected behavior.
- **Feature request**: describe the problem you are trying to solve and the proposed solution.
  Confirm the feature stays compatible with Ragmir's local-first, zero-telemetry posture.

Before opening a new issue, search [existing issues](https://github.com/jcode-works/jcode-ragmir/issues)
to avoid duplicates. Security vulnerabilities must not be reported through public issues — follow
[`SECURITY.md`](./SECURITY.md).

## Development

This repo pins its Node.js version with [mise](https://mise.jdx.dev/) (see `mise.toml`), the same
version CI uses. Install mise, then run the single onboarding command:

```bash
pnpm bootstrap
pnpm validate
```

`pnpm bootstrap` runs `mise install && pnpm install`. Without mise, any Node.js 20+ and pnpm install
works too — just run `pnpm install` directly.

Activate mise in your shell (`mise activate`, per the
[mise docs](https://mise.jdx.dev/getting-started.html)) so that entering this repository puts the
pinned Node on your `PATH` automatically. Then `pnpm dev:landing` and `pnpm example` run on the
same toolchain as CI without per-script wiring.

`pnpm validate` runs Biome, a dependency security audit, TypeScript, Vitest, the production CLI/MCP
smoke test, and npm package metadata checks.

To smoke-test the library API against your local build while developing Ragmir Core, run
`pnpm example` (see
[`packages/ragmir-core/examples/library-api-demo`](./packages/ragmir-core/examples/library-api-demo)).

Run the security audit alone with:

```bash
pnpm audit:security
```

## Pull Requests

- Branch from `develop` for normal feature work, using `feature/<short-name>`.
- Open feature pull requests against `develop`.
- Use `release/<version-or-topic>` branches from `develop` when preparing a production release, then
  open the release pull request against `main`.
- Use `hotfix/<short-name>` branches from `main` for urgent production fixes, then back-merge the fix
  into `develop`.
- Keep changes focused and include tests or smoke coverage for behavior changes.
- Do not commit private documents, generated vector stores, generated `.ragmir/` state, environment
  files, tokens, credentials, or interview notes.
- Use conventional commit messages such as `feat: add source parser` or
  `fix: handle empty index`.
- Non-release branches run CI only. npm publishing is restricted to the protected semantic-release
  workflow from `main`; versions are derived from Conventional Commits, not manual package bumps.

## Security

Do not report vulnerabilities through public issues. Follow [`SECURITY.md`](./SECURITY.md).
