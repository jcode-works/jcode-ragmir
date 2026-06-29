# Mimir Landing

Private Astro static landing package for the Mimir product surface.

The visible product title stays `Mimir`. The technical core remains `Mimir Core` in developer-facing
metadata only.

```bash
pnpm --filter @jcode.labs/mimir-landing dev
pnpm --filter @jcode.labs/mimir-landing build
pnpm --filter @jcode.labs/mimir-landing cf:dry-run
```

The landing presents the open-source Mimir Core package, sovereign local retrieval, and a light
teaser for the future Tauri desktop client. It does not collect emails.

Cloudflare Workers Static Assets configuration lives in [`wrangler.jsonc`](./wrangler.jsonc). The
canonical domain is `mimir.jcode.works`; it is the future direct-download release surface for Mimir
Desktop, not an App Store or Play Store destination.

No PostHog or hosted document telemetry belongs here. If analytics are needed later, prefer
Cloudflare Web Analytics.
