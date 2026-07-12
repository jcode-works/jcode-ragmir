# Ragmir development notes

## Commands

```bash
pnpm bootstrap
pnpm validate
pnpm dev:landing
pnpm example
```

Use `pnpm --filter @jcode.labs/ragmir <script>` for Core-only work. The pinned Node version lives in
`mise.toml`; activate mise in your shell or use any compatible Node 20+ runtime locally.

## Workspace

- `packages/ragmir-core`: published CLI, library, MCP server, and skills.
- `packages/ragmir-chat`: optional local chat add-on.
- `packages/ragmir-tts`: optional audio add-on.
- `packages/ragmir-landing`: self-contained static Astro documentation and product site.

Generated `dist/`, `.astro/`, `release-artifacts/`, and `.ragmir/` directories are ignored. Do not
commit them. The root README is the canonical documentation entrypoint; keep package READMEs short.
When code changes public behavior, commands, configuration, supported formats, architecture, or
product claims, update the relevant docs and landing in the same change. For internal-only changes,
verify both surfaces and leave them unchanged when no update is needed.

## Boundaries

Ragmir stores and retrieves local cited context. It has no hosted document store, account system,
native desktop shell, or cloud-vendor deployment configuration. Keep OCR optional and
local, remote model downloads explicit, and normal confidential retrieval offline.
