# Ragmir Landing

The static, telemetry-free website for [Ragmir](https://ragmir.com), the local RAG layer for coding
agents and scripts. Public guides are available in the
[project documentation](https://github.com/jcode-works/jcode-ragmir/wiki).

This private workspace package presents the open-source CLI, TypeScript API, MCP integration,
optional local chat and audio, and privacy boundaries. It does not host document storage, user
accounts, a Ragmir API, or an upload flow.

## What lives here

| Area | Responsibility |
| --- | --- |
| `src/pages` | English and French static routes, error pages, and `robots.txt` |
| `src/components/sections` | Landing-page sections and navigation |
| `src/components/ui` | Landing-local React primitives |
| `src/i18n` and `messages` | Locale routing and translated public copy |
| `src/services/npm-downloads.ts` | Build-time npm download count with a safe fallback |
| `public` | Favicons, social cards, `llms.txt`, and static assets |

The landing owns its UI primitives. There is no separate `ragmir-ui` package.

## Technology

- Astro 7 with static output and locale-aware routing;
- React 19 for interactive islands;
- Tailwind CSS 4 for styling;
- GSAP for focused motion;
- Radix primitives where accessible interaction behavior is needed;
- TypeScript, Astro Check, and the repository's Biome configuration.

The site has no analytics SDK, telemetry collector, cookie banner, hosted database, or cloud-vendor
deployment configuration.

## Run locally

Use the Node.js version pinned by the repository and install workspace dependencies first:

```bash
pnpm bootstrap
pnpm --filter @jcode.labs/ragmir-landing dev
```

Open <http://localhost:4322>. The English home page is `/`, French is `/fr/`, and team pages are
available at `/team` and `/fr/team`.

Build and preview the production output:

```bash
pnpm --filter @jcode.labs/ragmir-landing build
pnpm --filter @jcode.labs/ragmir-landing preview
```

Preview listens on <http://localhost:4323>. Static output is written to `dist/` and remains a build
artifact.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm --filter @jcode.labs/ragmir-landing dev` | Start the local Astro development server |
| `pnpm --filter @jcode.labs/ragmir-landing check` | Run Astro type and content checks |
| `pnpm --filter @jcode.labs/ragmir-landing build` | Check and build the static site with telemetry disabled |
| `pnpm --filter @jcode.labs/ragmir-landing preview` | Serve the generated static output locally |
| `pnpm --filter @jcode.labs/ragmir-landing submit:indexnow` | Submit configured sitemap URLs to IndexNow |

The repository-wide `pnpm validate` command also covers the landing check and build.

## Build-time configuration

| Variable | Use |
| --- | --- |
| `PUBLIC_RAGMIR_LANDING_URL` | Canonical site URL; defaults to `https://ragmir.com` |
| `PUBLIC_RAGMIR_VERSION` | Version shown in navigation and footer when provided |
| `RAGMIR_NPM_DOWNLOADS` | Deterministic download-count override for builds and tests |
| `INDEXNOW_API_KEY` | Secret used only by the explicit IndexNow submission script |
| `INDEXNOW_KEY_NAME` | Key-file name used by the IndexNow script |
| `SITEMAP_LOCAL_PATH` | Optional local sitemap path for IndexNow submission |

Keep secrets in the environment. Never commit them or expose them through `PUBLIC_` variables.

## Public-copy rules

- Keep English and French messages aligned whenever visible copy changes.
- Ground product claims in the current CLI, API, package, and privacy behavior.
- Position Core as local, cited RAG for coding agents and scripts without implying that Core calls
  a model.
- Keep Core retrieval separate from optional Chat and TTS generation.
- Lead with model-agnostic Core and present the user's preferred agent and a fully local consumer as
  equal choices.
- Name Qwen and Gemma only in Chat-specific technical copy. They are profiles, not Core or MCP
  requirements.
- Describe `local-hash` as offline lexical/hash retrieval, not semantic embeddings.
- State external boundaries explicitly: model download, Edge TTS, and IndexNow are opt-in actions.
- Do not claim universal file support, blanket compliance, or guaranteed confidentiality.
- Keep the site static and open-source focused.

## Production invariants

The production build must remain:

- static and deployable as plain files;
- free of product telemetry and document-upload paths;
- canonicalized to `https://ragmir.com` only for a production build;
- localized in English and French;
- aligned with the repository README and npm package pages.

Deployment is handled outside this package. Do not add Vercel, Cloudflare, Netlify, or another
vendor-specific deployment configuration to the repository.

## Contributing

Read the [root README](../../README.md) for product architecture and [CONTRIBUTING.md](../../CONTRIBUTING.md)
for the repository workflow. Before opening a pull request, run:

```bash
pnpm --filter @jcode.labs/ragmir-landing check
pnpm --filter @jcode.labs/ragmir-landing build
```

The landing source is available under the repository's [MIT License](../../LICENSE).
