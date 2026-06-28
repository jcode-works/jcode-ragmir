# Releasing

Mimir publishes to npm through a protected manual GitHub Actions workflow.

Semantic-release is intentionally not enabled: publishing must stay explicit, reviewed,
and approved by Jean-Baptiste Thery through the protected `npm-publish` environment.

## Release Flow

1. Open a pull request against `main`.
2. Wait for the required CI checks to pass.
3. Merge only after approval and green checks.
4. Trigger the `Publish npm` workflow manually from `main`.
5. Enter the version already committed in `packages/mimir/package.json` and
   `packages/mimir-tts/package.json`.
6. Approve the protected `npm-publish` environment when GitHub asks for review.

The publish workflow refuses to run from any branch other than `main`, verifies that the
CI workflow passed for the exact commit being published, reruns the local quality checks,
and publishes with npm provenance.

## Required Local Checks

```bash
pnpm validate
```

For version-only releases, ensure generated files are committed after:

```bash
pnpm build
```
