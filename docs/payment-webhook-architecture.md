# Payment And License Webhook Architecture

Ragmir Desktop uses direct downloads and sideloadable installers. Payments and license delivery must
therefore stay independent from App Store or Play Store account, review, receipt, and entitlement
systems.

This document defines a future hosted payment path without adding secrets or deploying a service from
this repository.

## Release Shape

- The landing stays static and links to hosted Lemon Squeezy checkout URLs only after the app is
  signed, packaged, and ready to sell.
- Lemon Squeezy remains the default payment provider because it can host checkout and act as merchant
  of record.
- Paddle remains the fallback if Lemon Squeezy cannot satisfy the final tax, payout, or license
  workflow.
- Ragmir does not add a hosted document service for payment or activation.
- The app keeps local per-major license validation through `RAGMIR1.<payload>.<signature>` keys.

## Hosted Components

The minimum hosted surface is a small webhook service. A Cloudflare Worker is the preferred shape for
the first implementation because it matches the landing infrastructure and can keep provider secrets
outside the repository.

The service owns:

- provider webhook signature verification;
- provider event normalization;
- license issuance through the same payload rules used by `license:from-lemonsqueezy`;
- minimal purchase metadata storage for idempotency, refunds, support, and re-delivery;
- customer-facing license delivery by email or a short-lived license retrieval URL.

The service must not receive, store, or request local document paths, queries, retrieved passages,
embeddings, vector rows, generated reports, generated audio, or MCP context.

## Event Flow

1. A public Ragmir release page links to a Lemon Squeezy hosted checkout variant.
2. Lemon Squeezy collects payment and tax details on the provider-hosted checkout.
3. Lemon Squeezy sends purchase, subscription, renewal, refund, and cancellation events to the webhook
   service.
4. The webhook verifies the event signature before any state change.
5. The webhook normalizes the event into the Ragmir license payload model.
6. The webhook signs a `RAGMIR1` license with a private key stored only in the hosted secret manager.
7. The customer receives the direct app download link plus the license key.
8. The installed app validates the license locally with the public JWK injected at build time through
   `VITE_RAGMIR_LICENSE_PUBLIC_KEY_JWK`.

## License Mapping

| Provider event | Ragmir license behavior |
| --- | --- |
| One-time purchase | Issue a perpetual per-major license with the configured update window. |
| Subscription created or renewed | Issue or refresh a license whose runtime and update windows follow the provider renewal date. |
| Subscription expired or cancelled | Stop refreshing future licenses; existing local behavior follows the last signed expiration. |
| Refund or chargeback | Mark the purchase as revoked for support, re-delivery, updates, and future online checks. |
| Duplicate webhook delivery | Return success after confirming the previously issued license record. |

Local validation remains the default app behavior. If later online activation is added, it must be
metadata-only and must not become a document telemetry channel.

## Secrets

The repository must never contain:

- Lemon Squeezy API keys;
- Lemon Squeezy webhook signing secrets;
- private license signing keys;
- customer emails, invoices, tax identifiers, or order exports;
- generated production license keys.

Use environment variables, CI secrets, a worker secret store, or a dedicated key-management service.
Only the public license verification JWK may be committed or injected into public build artifacts.

## Local Validation Path

Until the webhook exists, use the offline adapter with exported provider JSON:

```bash
pnpm --filter @jcode.labs/ragmir-app license:from-lemonsqueezy \
  --event lemon-event.json \
  --private-key .ragmir/license-private.jwk \
  --major-version 0 \
  --json
```

Keep exported provider JSON, private JWK files, generated licenses, and customer ledgers under
ignored local Ragmir state or another private system.

The adapter has a synthetic smoke test that generates a temporary local signing key and converts
order plus subscription fixtures without provider credentials:

```bash
pnpm --filter @jcode.labs/ragmir-app license:lemonsqueezy:smoke
```

## Webhook Handler Package

`packages/ragmir-license-webhook` contains the unpublished Cloudflare Worker handler for the future hosted
path. It verifies Lemon Squeezy's `X-Signature` header against the raw request body, issues local
`RAGMIR1` keys for eligible order/subscription events, and returns metadata-only records for
cancellation/refund-style events. It requires a KV-compatible `RAGMIR_LICENSE_RECORDS` binding so
duplicate webhook deliveries can return the stored response instead of signing a second license key.

The package has a synthetic smoke test with generated local keys and no provider credentials:

```bash
pnpm --filter @jcode.labs/ragmir-license-webhook smoke
pnpm --filter @jcode.labs/ragmir-license-webhook cf:dry-run
```

This package is not a deployment target yet. Keep `LEMONSQUEEZY_WEBHOOK_SECRET`,
`RAGMIR_LICENSE_PRIVATE_KEY_JWK`, KV record exports, customer data, order exports, and generated
production licenses out of the repository and out of public build artifacts.

## Release Gates

Commercial checkout and license delivery can be considered release-ready only after all of these are
true:

- real Lemon Squeezy product variants exist for the released offer;
- a hosted checkout URL is linked from the release surface after the app is signed and packaged;
- the webhook verifies provider signatures and is deployed with secrets outside the repository;
- a test-mode purchase issues a valid local `RAGMIR1` license;
- duplicate webhook deliveries are idempotent;
- refunds, cancellations, and subscription expirations update license metadata;
- the app download page publishes signed artifacts, `SHA256SUMS`, and `ragmir-app-release.json`;
- no App Store, Play Store, or store entitlement path is required for purchase or activation.
