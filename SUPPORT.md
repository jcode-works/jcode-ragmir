# Support

## Start with the diagnostics

Most setup problems name their own fix:

```bash
rgr doctor                 # readiness, freshness, agent registrations, next steps
rgr audit --unsupported    # files that were skipped, and why
rgr upgrade --check        # what an update needs before the next search
```

The [troubleshooting guide](./docs/troubleshooting.md) covers the common cases: an uninitialized
project, stale or missing files, agents that do not show the tools, scanned PDFs, weak results,
and searches refused after an update.

## Ask a question or report a bug

- **Questions and bugs:** open an [issue](https://github.com/jcode-works/jcode-ragmir/issues/new/choose)
  with the Ragmir version, how you run it (CLI, plugin, MCP client, Python, or Docker), and a
  minimal reproduction. Never attach private documents, indexes, or credentials.
- **Feature requests:** describe the problem first; see [CONTRIBUTING.md](./CONTRIBUTING.md).
- **Security vulnerabilities:** report them privately as described in [SECURITY.md](./SECURITY.md),
  never in a public issue.

## Commercial use

For commercial licensing, or for help integrating Ragmir into a product, contact JCode Works at
[contact@jcode.works](mailto:contact@jcode.works). See [COMMERCIAL-LICENSE.md](./COMMERCIAL-LICENSE.md).

Ragmir is maintained by one developer, so issues are answered as time allows.
