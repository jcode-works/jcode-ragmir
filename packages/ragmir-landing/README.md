# Ragmir Landing

The static, telemetry-free website for [Ragmir](https://ragmir.com). It presents the open-source
retrieval layer for agentic RAG: a TypeScript library, CLI, local MCP server, optional semantic
embeddings, local OCR, and English/French public documentation. It hosts no corpus, account, upload flow, or Ragmir API.

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

- Lead with agentic RAG for developers: cited project evidence through a TypeScript library, CLI,
  and MCP. The consuming agent chooses searches, expands citations, refines queries, and generates.
- Show four distinct workflows in the hero and examples: feature delivery, incident diagnosis, and
  migration planning with Claude Code or Codex, plus a confidential decision with a local or
  self-hosted chat and model. Keep each development example agentic, with source refinement and a
  concrete code outcome. Keep the confidential example focused on a cited decision with an explicit
  model destination. Do not turn the development examples into Ollama demos.
- Explain how existing chat and agent applications use that evidence with local models,
  self-hosted models (including private cloud), or cloud providers.
- Distinguish local indexing from end-to-end confidentiality. Retrieved text is not masked; the
  consuming application's model, tools, network, access controls, and logs determine where it goes.
- Keep model-free automation available through the same retrieval API.
- Keep semantic embeddings, model downloads, local OCR, and IndexNow explicit.
- Share sources through existing Git or file-sharing tools, then run `rgr ingest` locally.
- Keep localized FAQ copy visible without publishing `FAQPage` structured data.
- Keep English and French messages aligned, and ground every claim in current code and tests.
- Never claim hosted storage, universal formats, blanket compliance, or guaranteed confidentiality.

## Production invariants

Production remains static, telemetry-free, localized in English and French, canonicalized to
`https://ragmir.com`, and aligned with the repository README, npm pages, `llms.txt`, `ai.txt`,
Open Graph metadata, hreflang links, and JSON-LD entities. Deployment stays external to this
package, so no Cloudflare, Vercel, Netlify, or other vendor configuration is committed.

Read the [root README](../../README.md) for product architecture and
[CONTRIBUTING.md](../../CONTRIBUTING.md) for the repository workflow. The landing is available under
the [AGPL-3.0-only license](../../LICENSE), with a separate
[commercial licensing option](../../COMMERCIAL-LICENSE.md).
