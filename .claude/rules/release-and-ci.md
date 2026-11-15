---
paths:
  - ".github/**"
  - "docker/**"
  - "scripts/**"
  - "release.config.cjs"
  - "commitlint.config.cjs"
  - "server.json"
---

# Release, CI, and automation

- Releases come only from `main` through the `Release npm` workflow and the protected
  `npm-publish` environment: semantic-release publishes npm, then the workflow pushes the slim and
  full GHCR images, the three PyPI packages, and the MCP Registry entry. Never publish locally.
- The organization allows only GitHub-owned actions. Pin every other tool to an exact version and
  verify downloads by checksum, digest, or signature, as the workflows do for cosign, binfmt, and
  the MCP publisher; build images with the runner's own Docker Buildx.
- Validate workflow edits with `actionlint` and keep `permissions` minimal per job.
- `scripts/semantic-release-notes.mjs` turns the promotion commit body into the GitHub release.
  That body needs `Release highlights:`, `Release details:`, and `Verification:` sections with
  bullets, lines within 100 characters, and continuation lines indented by two spaces. The
  `release-ragmir` skill walks through a promotion.
- `server.json` must validate against its `$schema`; the release rewrites its versions and the OCI
  image tag.
