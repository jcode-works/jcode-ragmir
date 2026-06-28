# Contributing

Mimir is an open-source project under the MIT License. Issues and pull requests are welcome.

## Development

Use Node.js 20+ and pnpm:

```bash
pnpm install
pnpm validate
```

`pnpm validate` runs Biome, TypeScript, Vitest, the production CLI/MCP smoke test, and npm
package metadata checks.

## Pull Requests

- Open pull requests against `main`.
- Keep changes focused and include tests or smoke coverage for behavior changes.
- Do not commit private documents, generated vector stores, environment files, tokens, or
  credentials.
- Use conventional commit messages such as `feat: add source parser` or
  `fix: handle empty index`.

## Security

Do not report vulnerabilities through public issues. Follow [`SECURITY.md`](./SECURITY.md).
