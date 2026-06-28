# Mimir

## Working Rules

- Speak with the user in French.
- Write code, identifiers, commit messages, filenames, and technical comments in English.
- Keep this repository free of private user documents, scans, tax identifiers, API keys,
  environment files, or generated vector stores.
- Keep public branding centered on `Mimir`. Use JCode Labs and Jean-Baptiste Thery for
  package scope, repository ownership, and copyright, not as the product name.
- The package is open source under the MIT License unless the user explicitly changes it.
- This package must stay reusable across repositories. Resolve project data from the
  caller's working directory or explicit config, not from the package installation path.
- `kb init` and `kb install-skill` must keep generated local Mimir state ignored in target
  repositories. By default, add `.kb/`, `.mimir/`, and private raw-document paths to the
  target repository `.gitignore`.
- Use Context7 before changing dependencies or public APIs that rely on external libraries.
- Run `pnpm validate` before opening a release pull request or publishing. It covers
  Biome, TypeScript, Vitest, build output, production CLI/MCP smoke tests, and npm package
  metadata.
- Do not publish from a local machine or direct push to `main`. npm releases must go through
  the protected manual `Publish npm` GitHub Actions workflow after `main` has green CI.

## Architecture

- `src/cli.ts` exposes the `kb` CLI.
- `src/config.ts` resolves `.kb/config.json` from the target repository.
- `src/ingest.ts` parses supported files, chunks text, embeds chunks, and rebuilds the
  local LanceDB table.
- `src/query.ts` performs vector search and local Ollama answer synthesis.
- `src/mcp.ts` exposes Mimir as an MCP stdio server for agents.
- `src/gitignore.ts` owns target-repository `.gitignore` entries for local generated Mimir
  state.
- `skills/mimir/SKILL.md` is the bundled portable agent skill.
- `.kb/`, `.mimir/`, and project `private/` folders are local user data or generated agent
  state in target repositories and must not be committed.
