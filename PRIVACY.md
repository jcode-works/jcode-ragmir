# Privacy policy

This policy covers the Ragmir library, the `rgr` CLI, the MCP server, the Docker image, and the
Ragmir plugin for Claude Code. All of them run on your own machine or server.

## What the maintainers collect

Nothing. Ragmir has no account, no telemetry, no analytics, and no hosted storage. It never sends
your files, queries, index, or usage data to the maintainers or to any service they operate.

## What Ragmir reads and stores on your machine

- Ragmir reads only the files you select as sources (`rgr sources add`). Those files may contain
  personal data, such as names or email addresses, if your documents do.
- It stores the extracted text, citations, and search index in the project's `.ragmir/` folder,
  which `rgr init` adds to `.gitignore`. Nothing leaves that folder unless you copy it.
- Optional ingestion metrics stay local and exclude source text, paths, and queries.
- The data stays until you remove sources and run `rgr ingest`, or delete `.ragmir/`.

## Network access

- Installing Ragmir, or starting the Claude Code plugin's server, downloads the published package
  from the npm registry. That request carries no project data.
- Semantic retrieval downloads an embedding model from Hugging Face only after you enable it
  explicitly. The default `local-hash` retrieval works without a model or a network connection.
- OCR and legacy document extraction run local tools you configure.

## Where retrieved passages go

Search results contain passages from your documents. Ragmir returns them to the agent,
application, or model you connect, such as Claude Code. That consumer decides what to send to a
model provider, and the provider's own policy applies. Ragmir does not mask content, so select
sources accordingly. See [SECURITY-HARDENING.md](./SECURITY-HARDENING.md) for the full data
boundary.

## Contact

Open an issue at <https://github.com/jcode-works/jcode-ragmir/issues>, or follow
[SECURITY.md](./SECURITY.md) for security reports.
