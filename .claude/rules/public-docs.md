---
paths:
  - "/*.md"
  - "docs/**"
  - "llms.txt"
  - "context7.json"
  - "packages/*/README.md"
  - "plugins/**"
  - "skills/**"
  - "server.json"
---

# Public documentation

- The root README is the canonical entrypoint: value first, a working quick start, then the
  strongest guarantees. Operational depth goes to one focused guide in `docs/`; package READMEs
  stay short and link back.
- One change, every surface: when behavior visible to users changes, update the README, the
  matching `docs/` guide, `llms.txt`, the landing, and `context7.json` when its rules are affected.
- Keep the English setup prompt identical in Core (`src/setup-prompt.ts`), the landing, the root
  and package READMEs, and `docs/quick-start.md`.
- Exact copies are kept by hooks and checked by `pnpm public:smoke`: edit `llms.txt`, the Core
  skill in `packages/ragmir-core/skills/ragmir/`, and `gemini-extension.json`, never their copies.
- Skills in `skills/` follow the Agent Skills specification and are grouped in `skills.sh.json`;
  the plugin pins one npm release everywhere in `plugins/ragmir` and `docs/agent-integration.md`.
- Write plain, precise English without em dashes. State only claims the code or a benchmark
  supports, never blanket compliance, certification, or universal format support.
- Run `pnpm public:smoke` after editing any of these files.
