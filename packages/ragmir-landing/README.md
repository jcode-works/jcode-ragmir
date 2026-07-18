# Ragmir Landing

The static, telemetry-free website for [Ragmir](https://ragmir.com). It presents the open-source
Core library, CLI, local MCP server, optional Chat and TTS packages, privacy boundaries, and
English/French public documentation. It hosts no corpus, account, upload flow, or Ragmir API.

## Structure

| Area | Responsibility |
| --- | --- |
| `src/pages` | Localized static routes, error pages, and robots output |
| `src/components` | Landing sections, navigation, and local UI primitives |
| `src/i18n` and `messages` | Locale routing and aligned English/French copy |
| `src/services` | Build-time public data with deterministic fallbacks |
| `public` | Favicons, social cards, `llms.txt`, `ai.txt`, and static assets |

Astro 7 provides static output, React 19 powers interactive islands, Tailwind CSS 4 handles styling,
and Radix primitives cover accessible interaction where needed. There is no analytics SDK,
telemetry collector, cookie banner, database, or committed cloud-vendor configuration.

## Run locally

```bash
pnpm bootstrap
pnpm --filter @jcode.labs/ragmir-landing dev
```

Development runs on <http://localhost:4322>. Routes are `/`, `/fr/`, `/team/`, and `/fr/team/`.
Build and preview on <http://localhost:4323> with:

```bash
pnpm --filter @jcode.labs/ragmir-landing build
pnpm --filter @jcode.labs/ragmir-landing preview
```

| Command | Purpose |
| --- | --- |
| `test` | Public-copy and build-helper contracts |
| `test:coverage` | Landing tests with coverage thresholds |
| `check` | Astro type and content checks |
| `build` | Static build with telemetry disabled |
| `preview` | Serve generated output locally |
| `submit:indexnow` | Submit configured sitemap URLs explicitly |

Prefix each command with `pnpm --filter @jcode.labs/ragmir-landing`. The repository-wide
`pnpm validate` covers the landing tests, checks, and build.

## Build-time configuration

| Variable | Use |
| --- | --- |
| `PUBLIC_RAGMIR_LANDING_URL` | Canonical public URL; production is `https://ragmir.com` |
| `PUBLIC_RAGMIR_VERSION` | Version shown in navigation, footer, and structured data |
| `RAGMIR_NPM_DOWNLOADS` | Deterministic download-count override |
| `INDEXNOW_API_KEY` | Secret for explicit IndexNow submission only |
| `INDEXNOW_KEY_NAME` | IndexNow key-file name |
| `SITEMAP_LOCAL_PATH` | Optional local sitemap path for submission |

Keep secrets outside Git and never expose them through `PUBLIC_` variables. A non-production build
must set its own public URL. It then emits staging canonicals and structured URLs, applies `noindex`,
and omits the production sitemap.

## Public-copy contract

- Lead with model-agnostic Core: cited local retrieval through a library, CLI, and MCP.
- Present preferred cloud agents, local consumers, and model-free automation as clear choices.
- Keep Chat, TTS, semantic embeddings, model downloads, Edge speech, OCR, and IndexNow explicit.
- Explain team use positively and briefly: synchronize sources and configuration, ingest locally per
  developer, then compare the corpus fingerprint. Keep low-level safeguards in focused guides.
- Keep English and French messages aligned, and ground every claim in current code and tests.
- Never claim hosted storage, universal formats, blanket compliance, or guaranteed confidentiality.

## Production invariants

Production remains static, telemetry-free, localized in English and French, canonicalized to
`https://ragmir.com`, and aligned with the repository README, npm pages, `llms.txt`, `ai.txt`,
Open Graph metadata, hreflang links, and JSON-LD entities. Deployment stays external to this
package, so no Cloudflare, Vercel, Netlify, or other vendor configuration is committed.

Read the [root README](../../README.md) for product architecture and
[CONTRIBUTING.md](../../CONTRIBUTING.md) for the repository workflow. The landing is available under
the [MIT License](../../LICENSE).
