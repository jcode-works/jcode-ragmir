# Ragmir App

Unpublished Tauri desktop/mobile shell for Ragmir.

Root `pnpm build` validates the Vite frontend bundle. Native desktop/mobile builds stay explicit:

```bash
pnpm --filter @jcode.labs/ragmir-app tauri:dev
pnpm --filter @jcode.labs/ragmir-app tauri:build
pnpm --filter @jcode.labs/ragmir-app tauri:build:macos
pnpm --filter @jcode.labs/ragmir-app tauri:build:windows
pnpm --filter @jcode.labs/ragmir-app tauri:build:linux
pnpm --filter @jcode.labs/ragmir-app tauri:ios:init
pnpm --filter @jcode.labs/ragmir-app tauri:ios:dev
pnpm --filter @jcode.labs/ragmir-app tauri:android:init
pnpm --filter @jcode.labs/ragmir-app tauri:android:dev
pnpm --filter @jcode.labs/ragmir-app tauri:android:build
```

Run a release-machine preflight before native packaging:

```bash
pnpm --filter @jcode.labs/ragmir-app release:preflight -- --target macos
pnpm --filter @jcode.labs/ragmir-app release:preflight -- --target windows
pnpm --filter @jcode.labs/ragmir-app release:preflight -- --target linux
pnpm --filter @jcode.labs/ragmir-app release:preflight -- --target android
pnpm --filter @jcode.labs/ragmir-app release:preflight:smoke
```

Generate checksums after a native bundle exists:

```bash
pnpm --filter @jcode.labs/ragmir-app release:checksums
pnpm --filter @jcode.labs/ragmir-app release:manifest -- --target macos
```

`release:manifest` reads `SHA256SUMS` and writes `ragmir-app-release.json` next to native artifacts
so the static direct-download surface can render verified artifact metadata without hardcoded file
names.

The app uses `@jcode.labs/ragmir-ui` for shared styling and should keep privacy controls visible by
default.

Ragmir Core integration is a bounded native Tauri command around the existing `ragmir` CLI/MCP
surface. In local native runs, set `RAGMIR_CLI_BIN` when the `ragmir` binary is not on `PATH`. See
[`../../docs/app-sidecar-architecture.md`](../../docs/app-sidecar-architecture.md).

The current shell consumes JSON from `ragmir doctor`, `ragmir status`, `ragmir ingest`,
`ragmir ask`, `ragmir security-audit`, `ragmir models pull --enable`, and offline `ragmir audio` for
project status, cited retrieval, privacy posture, explicit semantic model setup, Markdown reports,
and local audio report rendering.

Registered projects can opt into watched-folder mode from the Projects view. This is a local polling
layer over incremental `ragmir ingest`: it re-indexes the selected project every 5 minutes, stores the
setting only in local app storage, and does not add a cloud connector or background daemon.

Google Drive support is intentionally implemented as a local-sync connector: select the folder made
available on disk by Google Drive for desktop, and the app marks it as a Google Drive source with
local auto-ingest enabled. It does not use OAuth, call the Drive API, or store Google credentials.

## Distribution

The app is designed for direct downloads and sideloadable installers, not App Store or Play Store
distribution. Desktop installers and Android APK-style releases are the initial target channels; iOS
distribution remains deferred until a compliant non-store path is selected.

There is intentionally no iOS release build script yet. Keep iOS limited to local init/dev commands
until a compliant non-store distribution channel is selected.

See [`../../docs/app-distribution.md`](../../docs/app-distribution.md) for the direct-download
release runbook.

## Local License Validation

The app validates signed per-major licenses locally. The private signing key must stay outside the
repository.

Generate a keypair into an ignored local folder:

```bash
pnpm --filter @jcode.labs/ragmir-app license:keypair \
  --private-key .ragmir/license-private.jwk \
  --public-key .ragmir/license-public.jwk
```

The command writes key files with owner-only permissions and does not print private key material.

Build the app with the public JWK only:

```bash
VITE_RAGMIR_LICENSE_PUBLIC_KEY_JWK="$(cat .ragmir/license-public.jwk)" pnpm --filter @jcode.labs/ragmir-app build
```

Issue a license key from the private JWK:

```bash
pnpm --filter @jcode.labs/ragmir-app license:issue \
  --private-key .ragmir/license-private.jwk \
  --holder "Customer Name" \
  --tier solo \
  --major-version 0
```

Convert a Lemon Squeezy order/subscription JSON export or webhook payload into the same local
license format:

```bash
pnpm --filter @jcode.labs/ragmir-app license:from-lemonsqueezy \
  --event lemon-event.json \
  --private-key .ragmir/license-private.jwk \
  --major-version 0 \
  --json
```

The adapter runs offline. It does not call the Lemon Squeezy API and it does not store provider
secrets in the repository.
