# Ragmir License Webhook

Unpublished MIT-licensed Cloudflare Worker handler for the future Ragmir Desktop hosted license path.

This package verifies Lemon Squeezy webhook signatures, converts eligible purchase events into
local `RAGMIR1` license keys, and keeps cancellation/refund-style events as metadata-only records.
It is not deployed by default. The source is public, so it must never contain Lemon Squeezy secrets,
customer data, or private license keys.

Required runtime bindings:

- `LEMONSQUEEZY_WEBHOOK_SECRET`: Lemon Squeezy webhook signing secret.
- `RAGMIR_LICENSE_PRIVATE_KEY_JWK`: private ECDSA P-256 JWK used to sign `RAGMIR1` keys.
- `RAGMIR_LICENSE_RECORDS`: KV-compatible record store used for idempotency and support metadata.
- `RAGMIR_LICENSE_DOWNLOAD_URL`: optional direct-download URL included in issued-license responses.

Duplicate Lemon Squeezy deliveries are keyed by event name and source id. The handler returns the
stored response instead of signing a second license key.

Local validation:

```bash
pnpm --filter @jcode.labs/ragmir-license-webhook smoke
pnpm --filter @jcode.labs/ragmir-license-webhook cf:dry-run
```

`wrangler.jsonc` intentionally contains placeholder KV namespace ids. Replace them only when the
real Worker, KV namespaces, checkout variants, and release surface are ready. Keep Wrangler secrets
outside Git:

```bash
wrangler secret put LEMONSQUEEZY_WEBHOOK_SECRET
wrangler secret put RAGMIR_LICENSE_PRIVATE_KEY_JWK
```

See the root [`README.md`](../../README.md) and
[`docs/payment-webhook-architecture.md`](../../docs/payment-webhook-architecture.md) for the product
and release rules.
