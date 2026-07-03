# App Distribution

Ragmir app releases are planned as direct downloads and sideloadable installers. Do not design the
release path around App Store or Play Store review, hosted store accounts, or store license flows.

## Channels

| Platform | Initial artifact | Notes |
| --- | --- | --- |
| macOS | `.dmg` plus `.app` bundle | Requires Apple Developer signing and notarization before public distribution. |
| Windows | NSIS and MSI installers | Requires Authenticode signing; OV is acceptable for the first public release. |
| Linux | AppImage and Debian package | Signing/checksum publication still matters even when OS signing differs by distro. |
| Android | APK-style sideload artifact | Keep Play Store assumptions out of copy and release planning. |
| iOS | Deferred | Broad direct installation is constrained; choose a compliant non-store channel before promising it. |

## Native Build Commands

Run native packaging explicitly from the app package:

```bash
pnpm --filter @jcode.labs/ragmir-app tauri:build:macos
pnpm --filter @jcode.labs/ragmir-app tauri:build:windows
pnpm --filter @jcode.labs/ragmir-app tauri:build:linux
pnpm --filter @jcode.labs/ragmir-app tauri:android:build
```

Desktop bundles can also be built through the manual **Native App Build** GitHub Actions workflow.
It uploads CI artifacts for macOS, Windows, and Linux, but it does not create a release, deploy, or
publish. Public distribution still requires the signing and checksum steps below.

The root `pnpm build` intentionally validates only the frontend bundle for `packages/ragmir-app`.
Native Tauri builds require the platform toolchain, Rust/Cargo, and the platform signing setup.
The Android release script builds APK artifacts for sideload/direct distribution. iOS has no release
script until a compliant non-store channel is selected.

## Release Requirements

Before publishing a public direct download:

- Run `pnpm validate` from the repository root.
- Run `pnpm --filter @jcode.labs/ragmir-app release:preflight -- --target <macos|windows|linux|android>`
  on the matching release machine before building native artifacts.
- Run `pnpm --filter @jcode.labs/ragmir-app release:preflight:smoke` after changing preflight logic;
  it verifies supported targets, rejects iOS release packaging, and checks that secret-bearing
  environment values are reported only by variable name.
- Run `pnpm --filter @jcode.labs/ragmir-app release:updater-guard` whenever Tauri updater config
  changes; `release:preflight` also runs the guard before native packaging.
- Run `pnpm --filter @jcode.labs/ragmir-app release:updater-guard:smoke` after changing the guard
  logic; it verifies the disabled, placeholder, and fully configured updater paths with temporary
  synthetic config files.
- Build the target platform artifact on the matching release machine or CI runner.
- Sign macOS and Windows artifacts with release credentials that are never committed.
- Generate checksums with `pnpm --filter @jcode.labs/ragmir-app release:checksums` and publish
  `SHA256SUMS` next to every downloadable artifact.
- Generate a download manifest with
  `pnpm --filter @jcode.labs/ragmir-app release:manifest -- --target <macos|windows|linux|android>`
  after `SHA256SUMS`; publish `ragmir-app-release.json` next to the artifacts so the static landing
  or release page can render verified direct-download metadata without hardcoded file names.
- Keep generated release artifacts under ignored output folders until an explicit release upload.
- Keep app license private keys outside the repository; only the public license JWK may be injected
  into the frontend build.

## Signing Checklist

macOS direct downloads require Apple Developer signing and notarization before public release:

- Run `pnpm --filter @jcode.labs/ragmir-app release:preflight -- --target macos`.
- Install or import the Developer ID Application certificate into the release keychain.
- Resolve the signing identity with `security find-identity -v -p codesigning`.
- Pass the identity through `APPLE_SIGNING_IDENTITY` or the Tauri macOS signing config.
- Store Apple account credentials, app-specific password, certificate, and certificate password only
  in the release machine keychain or CI secrets.
- Notarize and staple public `.dmg` / `.app` artifacts before publishing.

Windows direct downloads require Authenticode signing before public release:

- Run `pnpm --filter @jcode.labs/ragmir-app release:preflight -- --target windows`.
- Use an OV certificate first; EV is optional and mainly improves initial SmartScreen reputation.
- Keep the certificate private key in the Windows certificate store, hardware token, or signing
  service, not in the repository.
- Configure the release build with the certificate thumbprint, SHA-256 digest, and a trusted
  timestamp URL.
- Verify the resulting NSIS/MSI signatures before publishing.

Linux artifacts do not use the same platform signing flow, but published checksums are still
required for every AppImage and Debian package. Run
`pnpm --filter @jcode.labs/ragmir-app release:preflight -- --target linux` on the Linux release
machine before `tauri:build:linux`, or run the manual Native App Build workflow with target `linux`
to produce Linux CI artifacts.

The manual Native App Build workflow generates `SHA256SUMS` and `ragmir-app-release.json` inside the
uploaded native bundle artifact. For local builds, run the checksum and manifest commands after the
native build and before moving files to a public download surface.

Android APK artifacts require an Android SDK and JDK on the release machine. Run
`pnpm --filter @jcode.labs/ragmir-app release:preflight -- --target android` before
`tauri:android:build`.

## Updater Policy

Tauri's updater is the right path for direct-download desktop updates, but it must not be configured
with placeholder keys or fake endpoints.

Enable it only after these inputs exist:

- A real updater signing keypair generated for Ragmir app releases.
- The updater public key committed in Tauri config.
- The private key supplied only through `TAURI_SIGNING_PRIVATE_KEY` or
  `TAURI_SIGNING_PRIVATE_KEY_PATH` in the release environment.
- A HTTPS update endpoint or static release manifest URL.
- A signed update manifest generated by the release workflow.

Until then, updates are manual direct downloads. Do not claim automatic updates in product copy.

The updater guard enforces the deferred state. It passes while no updater config exists, and fails if
`bundle.createUpdaterArtifacts` or `plugins.updater` is added without a real public key, HTTPS
endpoint, and release signing key environment for desktop packaging.
