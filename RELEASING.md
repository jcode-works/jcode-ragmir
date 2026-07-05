# Releasing

Ragmir publishes to npm through the protected `Release npm` GitHub Actions workflow on `main`.
Do not publish from a local machine.

## Release Flow

1. Start feature work from `develop` on a `feature/*`, `fix/*`, or `chore/*` branch.
2. Open a pull request into `develop` and wait for required checks.
3. Promote `develop` to `main` through a release pull request after integration is green.
4. Let the `Release npm` workflow run on `main`, or dispatch it manually from `main`.
5. Approve the protected `npm-publish` environment when GitHub asks for review.
6. Verify npm, GitHub release notes, release artifacts, and the landing deploy.

The workflow runs `pnpm validate`, then semantic-release derives the next version from
Conventional Commits. It prepares `packages/ragmir-tts` and `packages/ragmir-core`, publishes
`@jcode.labs/ragmir-tts` first, then publishes `@jcode.labs/ragmir` with npm provenance.

After a successful npm release, the workflow dispatches `deploy-landing.yml` on `main` with the
released version so the production landing can show the current package version.

## Versioning Notes

- `feat:` creates a minor release.
- `fix:` and `docs:` create patch releases.
- `feat!:` or a `BREAKING CHANGE:` footer creates a major release.
- `scope: landing` is ignored for npm versioning because the landing is not an npm package.

For CLI compatibility releases, make the migration explicit in the Conventional Commit body or
footer. For example, the `ragmir` to `rgr` rename must mention that `ragmir` remains as a deprecated
compatibility bin and users should migrate scripts to `rgr`.

## Required Local Checks

Run the full gate before opening or updating a release pull request:

```bash
pnpm validate
```

For narrower preflight while iterating, use the package-level checks that match the edited area,
then run `pnpm validate` before release.
