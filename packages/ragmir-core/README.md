# Ragmir Core

`@jcode.labs/ragmir` provides the `rgr` CLI, TypeScript API, MCP server, and portable agent skills for
local cited retrieval.

```bash
npm install --save-dev @jcode.labs/ragmir
npx rgr setup
npx rgr sources add "docs/**/*.md"
npx rgr ingest
npx rgr search "your question"
```

The generated `.ragmir/` state stays local and ignored by Git. See the
[root README](https://github.com/jcode-works/jcode-ragmir#readme) for the API, agent setup, and
focused documentation.
