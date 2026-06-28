# Mimir Monorepo

Open-source packages for Mimir, a sovereign local RAG toolkit for confidential datasets and AI
agents.

## Packages

- [`@jcode.labs/mimir`](./packages/mimir): core CLI, library, MCP server, bundled agent skills, and
  synthetic examples.
- [`@jcode.labs/mimir-tts`](./packages/mimir-tts): plug-and-play JS/ONNX text-to-speech renderer
  used by `kb audio`.

## Development

```bash
pnpm install
pnpm validate
```

Useful filtered commands:

```bash
pnpm --filter @jcode.labs/mimir test
pnpm --filter @jcode.labs/mimir-tts test
pnpm --filter @jcode.labs/mimir build
pnpm --filter @jcode.labs/mimir-tts build
```

The root package is private and only orchestrates workspace tasks. npm publishing is handled by the
protected `Publish npm` GitHub Actions workflow, which publishes `@jcode.labs/mimir-tts` before
`@jcode.labs/mimir`.
