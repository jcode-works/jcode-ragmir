# Contributing

Mimir is an open-source project under the MIT License. Issues and pull requests are welcome.

## Development

Use Node.js 20+ and pnpm:

```bash
pnpm install
pnpm validate
```

`pnpm validate` runs Biome, a dependency security audit, TypeScript, Vitest, the production CLI/MCP
smoke test, and npm package metadata checks.

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
- Do not commit private documents, generated vector stores, generated `.mimir/` state, environment
  files, tokens, credentials, customer ledgers, pricing tests, or interview notes.
- Use conventional commit messages such as `feat: add source parser` or
  `fix: handle empty index`.
- Non-release branches run CI only. npm publishing is restricted to the protected semantic-release
  workflow from `main`; versions are derived from Conventional Commits, not manual package bumps.

## Security

Do not report vulnerabilities through public issues. Follow [`SECURITY.md`](./SECURITY.md).
