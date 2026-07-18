# Contributing

Ragmir is an open-source `AGPL-3.0-only` project with a separate commercial licensing option.
Issues and pull requests are welcome.

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
to avoid duplicates. Security vulnerabilities must not be reported through public issues. Follow
[`SECURITY.md`](./SECURITY.md).

## Development

This repo pins its Node.js version with [mise](https://mise.jdx.dev/) (see `mise.toml`), the same
version CI uses. Install mise, then run the single onboarding command:

```bash
pnpm bootstrap
```

`pnpm bootstrap` runs `mise install && pnpm install`. Without mise, install the Node.js 22 release
pinned in `mise.toml` and pnpm, then run `pnpm install` directly. Published packages retain their
documented Node.js 20 runtime support; the repository toolchain itself requires Node.js 22.

Activate mise in your shell (`mise activate`, per the
[mise docs](https://mise.jdx.dev/getting-started.html)) so that entering this repository puts the
pinned Node on your `PATH` automatically. Then `pnpm dev:landing` and `pnpm example` run on the
same toolchain as CI without per-script wiring.

Before opening a pull request, run:

```bash
pnpm validate
```

`pnpm validate` runs Biome, a dependency security audit, TypeScript checks, coverage-gated Vitest,
production CLI and MCP smoke tests, the static landing build, public API checks, and npm package and
release-artifact checks.

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
- Maintainers prepare `release/<version-or-topic>` from `main`, apply the validated `develop` tree,
  and open the release pull request against `main`.
- Use `hotfix/<short-name>` branches from `main` for urgent production fixes, then back-merge the fix
  into `develop`.
- Keep changes focused and include tests or smoke coverage for behavior changes.
- Do not commit private documents, generated vector stores, generated `.ragmir/` state, environment
  files, tokens, credentials, or interview notes.
- Use conventional commit messages such as `feat: add source parser` or
  `fix: handle empty index`.
- Non-release branches run CI only. npm publishing of Core, Chat, and TTS is restricted to the
  protected semantic-release workflow from `main`; versions come from Conventional Commits, not
  manual package bumps.

## Contribution licensing

By submitting a documentation, test, or code contribution, you confirm that you have the right to
submit it under the project's [AGPL-3.0-only license](./LICENSE). Code contributions are accepted
only after the maintainer also confirms the project has the rights needed to offer that
contribution under separate commercial terms. The maintainer may request a separate written
contributor agreement before merge.

This policy preserves both licensing paths without taking copyright ownership away from the
contributor. See [COMMERCIAL-LICENSE.md](./COMMERCIAL-LICENSE.md) for the public licensing boundary.

## Security

Do not report vulnerabilities through public issues. Follow [`SECURITY.md`](./SECURITY.md).
