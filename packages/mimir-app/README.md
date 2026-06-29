# Mimir App

Private Tauri desktop/mobile shell for Mimir.

Root `pnpm build` validates the Vite frontend bundle. Native desktop/mobile builds stay explicit:

```bash
pnpm --filter @jcode.labs/mimir-app tauri:dev
pnpm --filter @jcode.labs/mimir-app tauri:build
pnpm --filter @jcode.labs/mimir-app tauri:build:macos
pnpm --filter @jcode.labs/mimir-app tauri:build:windows
pnpm --filter @jcode.labs/mimir-app tauri:build:linux
pnpm --filter @jcode.labs/mimir-app tauri:ios:init
pnpm --filter @jcode.labs/mimir-app tauri:ios:dev
pnpm --filter @jcode.labs/mimir-app tauri:android:init
pnpm --filter @jcode.labs/mimir-app tauri:android:dev
```

The app uses `@jcode.labs/mimir-ui` for shared styling and should keep privacy controls visible by
default.

Mimir Core integration is a bounded native Tauri command around the existing `mimir` CLI/MCP
surface. In local native runs, set `MIMIR_CLI_BIN` when the `mimir` binary is not on `PATH`. See
[`../../docs/app-sidecar-architecture.md`](../../docs/app-sidecar-architecture.md).

The current shell consumes JSON from `mimir doctor`, `mimir status`, `mimir ingest`,
`mimir ask`, `mimir security-audit`, `mimir models pull`, and offline `mimir audio` for project
status, cited retrieval, privacy posture, explicit model preloading, Markdown reports, and local
audio report rendering.

Registered projects can opt into watched-folder mode from the Projects view. This is a local polling
layer over incremental `mimir ingest`: it re-indexes the selected project every 5 minutes, stores the
setting only in local app storage, and does not add a cloud connector or background daemon.

## Distribution

The app is designed for direct downloads and sideloadable installers, not App Store or Play Store
distribution. Desktop installers and Android APK-style releases are the initial target channels; iOS
distribution remains deferred until a compliant non-store path is selected.

See [`../../docs/app-distribution.md`](../../docs/app-distribution.md) for the direct-download
release runbook.

## Local License Validation

The app validates signed per-major licenses locally. The private signing key must stay outside the
repository.

Generate a keypair into an ignored local folder:

```bash
pnpm --filter @jcode.labs/mimir-app license:keypair \
  --private-key .mimir/license-private.jwk \
  --public-key .mimir/license-public.jwk
```

Build the app with the public JWK only:

```bash
VITE_MIMIR_LICENSE_PUBLIC_KEY_JWK="$(cat .mimir/license-public.jwk)" pnpm --filter @jcode.labs/mimir-app build
```

Issue a license key from the private JWK:

```bash
pnpm --filter @jcode.labs/mimir-app license:issue \
  --private-key .mimir/license-private.jwk \
  --holder "Customer Name" \
  --tier solo \
  --major-version 0
```
