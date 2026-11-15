---
paths:
  - "packages/ragmir-landing/**"
---

# Landing site

- The landing is a static, telemetry-free Astro site with no vendor deployment configuration and
  no runtime calls to third parties. Keep it that way.
- Every visible string lives in `messages/en.json` and `messages/fr.json`; add each key to both,
  in the same order.
- `public/llms.txt` is a copy of the root `llms.txt`: edit the root file, never the copy.
- The format list comes from `src/content/supported-formats.ts` and must match
  `docs/supported-formats.md`; integration cards live in `src/components/sections/integrations.astro`.
- Check with `pnpm --filter @jcode.labs/ragmir-landing check` and
  `pnpm --filter @jcode.labs/ragmir-landing test`; `pnpm dev:landing` serves it locally. Verify a
  visual change in a browser at desktop and mobile widths before calling it done.
