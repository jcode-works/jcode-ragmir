# Mimir License Webhook

Private Cloudflare Worker handler for the future Mimir Desktop hosted license path.

This package verifies Lemon Squeezy webhook signatures, converts eligible purchase events into
local `MIMIR1` license keys, and keeps cancellation/refund-style events as metadata-only records.
It is not deployed by default and it must never contain Lemon Squeezy secrets, customer data, or
private license keys.

See the root [`README.md`](../../README.md) and
[`docs/payment-webhook-architecture.md`](../../docs/payment-webhook-architecture.md) for the product
and release rules.
