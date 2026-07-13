# Changelog

Ragmir publishes its canonical version history through
[GitHub Releases](https://github.com/jcode-works/jcode-ragmir/releases). Each release is generated
by semantic-release from the Conventional Commits merged into `main`, after the repository
validation workflow passes.

This file is intentionally a stable entrypoint instead of a second, manually maintained copy of
the version history.

## Release history

- [Latest release](https://github.com/jcode-works/jcode-ragmir/releases/latest)
- [All releases and version comparisons](https://github.com/jcode-works/jcode-ragmir/releases)
- [Current TypeScript API reference](./docs/api-reference.md)

Each GitHub release contains generated feature, fix, and compatibility notes plus the verification
artifacts produced by the release workflow.

## API compatibility

Ragmir follows Semantic Versioning:

- `fix` commits produce patch releases.
- `feat` commits produce minor releases.
- commits with a `BREAKING CHANGE` footer produce major releases and surface the compatibility
  change in the generated release notes.
- documentation commits produce patch releases so the npm documentation stays current.
- landing-only commits do not publish the library packages.

Check the release notes for the version you plan to install, then compare the
[API reference](./docs/api-reference.md) when upgrading across a major version.
