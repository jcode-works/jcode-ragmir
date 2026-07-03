# Commercial Distribution

Ragmir can be sold or supported commercially while the repository remains MIT open source.

The commercial product boundary is distribution and service, not hidden source code in this repo.
Official paid channels may provide signed builds, verified downloads, support, onboarding, update
eligibility, and license delivery. The underlying tracked source remains MIT unless the license is
changed explicitly.

## Distribution

Distribute Ragmir app builds through direct downloads and sideloadable installers:

- macOS: signed and notarized `.dmg` / `.app` artifacts.
- Windows: Authenticode-signed `.exe` / `.msi` artifacts.
- Linux: `.AppImage` and `.deb` artifacts with published checksums.
- Android: APK-style sideload artifacts when mobile packaging is ready.
- iOS: deferred until a compliant non-store channel is chosen.

Do not present App Store or Play Store distribution as the primary release path.

## Payment And Licenses

Hosted payment, webhook handling, and license delivery must stay metadata-only. They must not
receive local document paths, queries, retrieved passages, generated reports, audio, embeddings, or
vector rows.

Runtime secrets stay outside the repository:

- payment provider API keys;
- webhook signing secrets;
- private license signing keys;
- customer ledgers and order exports;
- generated production licenses.

The public repository may contain source code for the license tooling and webhook handler, provided
it uses synthetic fixtures and placeholder infrastructure IDs.

## Public Copy Rules

Until official signed builds and a real payment path exist:

- present Ragmir Core as the usable product;
- describe the app as in development;
- avoid active checkout URLs;
- avoid active direct-download URLs under real Ragmir domains;
- avoid claiming automatic updates, notarized artifacts, or signed releases before they exist.

Business validation data belongs in private systems, not in this repository.
