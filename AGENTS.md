# JCode Mimir

## Working Rules

- Speak with the user in French.
- Write code, identifiers, commit messages, filenames, and technical comments in English.
- Keep this repository free of private user documents, scans, tax identifiers, API keys,
  environment files, or generated vector stores.
- Keep public branding centered on `JCode Mimir`, JCode Labs, and Jean-Baptiste Thery.
- The package is open source under the MIT License unless the user explicitly changes it.
- This package must stay reusable across repositories. Resolve project data from the
  caller's working directory or explicit config, not from the package installation path.
- Use Context7 before changing dependencies or public APIs that rely on external libraries.
- Run the smallest relevant validation before publishing changes: `pnpm check`,
  `pnpm test`, and `pnpm build` when TypeScript code changes.

## Architecture

- `src/cli.ts` exposes the `kb` CLI.
- `src/config.ts` resolves `.kb/config.json` from the target repository.
- `src/ingest.ts` parses supported files, chunks text, embeds chunks, and rebuilds the
  local LanceDB table.
- `src/query.ts` performs vector search and local Ollama answer synthesis.
- `.kb/storage/` and project `private/` folders are user data and must not be committed.
