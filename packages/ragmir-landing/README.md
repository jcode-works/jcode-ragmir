# Ragmir Landing

Unpublished Astro static landing package for the Ragmir product surface.

The visible product title stays `Ragmir`. The technical core remains `Ragmir Core` in developer-facing
metadata only.

```bash
pnpm --filter @jcode.labs/ragmir-landing dev
pnpm --filter @jcode.labs/ragmir-landing build
pnpm --filter @jcode.labs/ragmir-landing cf:dry-run
```

The landing presents the open-source Ragmir Core package (local RAG that gives AI agents cited
passages over MCP without burning tokens), sovereign local retrieval, and a light teaser for the
future Tauri desktop client. It does not collect emails.

Cloudflare Workers Static Assets configuration lives in [`wrangler.jsonc`](./wrangler.jsonc). The
canonical domain is `ragmir.jcode.works`; it is the future direct-download release surface for Ragmir
Desktop, not an App Store or Play Store destination.

No PostHog or hosted document telemetry belongs here. If analytics are needed later, prefer
Cloudflare Web Analytics.
