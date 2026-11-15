# Deploy Ragmir retrieval

Ragmir is a library and a CLI, not a hosted service: it opens no port, needs no account, and the
default `local-hash` provider makes no network call. The service around it owns TLS,
authentication, authorization, rate limits, and logs.

| Piece | Where it runs |
| --- | --- |
| Parsing, optional OCR, embeddings, index, search | Inside the Ragmir process |
| Index | `storageDir`, for example a volume at `/var/lib/ragmir` |
| TLS, authentication, authorization, rate limits | The application or gateway |
| Generation | The model the application chooses |

## Official images

`ghcr.io/jcode-works/ragmir` runs the CLI and MCP server on Node.js 22 for amd64 and arm64;
`ghcr.io/jcode-works/ragmir:full` adds the semantic model runtime and Tesseract OCR. Each release
tags `X.Y.Z`, `X.Y`, `X`, and `latest`, plus `-full` variants; pin an exact version in production.
The images run as the unprivileged `node` user with `/workspace` as the working directory.

```bash
docker run --rm -v /srv/handbook:/workspace --user "$(id -u):$(id -g)" ghcr.io/jcode-works/ragmir:6 ingest
```

## Your own image

Bake the configuration in and pin dependencies with a lockfile:

```text
/srv/ragmir/
  package.json, package-lock.json   # depends on @jcode.labs/ragmir
  ragmir.config.json                # name, description, sources, storageDir
  docs/                             # the documents, baked in or mounted read-only
/var/lib/ragmir/storage/            # the index, on a persistent volume
```

```json
{
  "name": "handbook",
  "description": "Runbooks and architecture decisions",
  "sources": ["docs/**/*.md", "docs/**/*.pdf", "docs/**/*.docx"],
  "storageDir": "/var/lib/ragmir/storage"
}
```

```dockerfile
FROM node:22-bookworm-slim
WORKDIR /srv/ragmir
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY ragmir.config.json ./
RUN mkdir -p /var/lib/ragmir && chown node:node /var/lib/ragmir
USER node
ENV RAGMIR_PROJECT_ROOT=/srv/ragmir
VOLUME /var/lib/ragmir
ENTRYPOINT ["/srv/ragmir/node_modules/.bin/rgr"]
CMD ["status"]
```

The layout runs as a non-root user with a read-only root filesystem
(`--read-only --tmpfs /tmp`) and `--network none`.

## Operate

- Refresh with `rgr ingest` from cron, a systemd timer, or CI after the documents change. Ingestion
  is incremental and resumable, and a rebuild keeps the previous index active until its
  replacement passes validation.
- One writer at a time per machine; readers stay available during an ingest. Never share one
  writable index over NFS or SMB.
- Health: `rgr status --json` reports `ready`, the base name, and the indexed file count;
  `rgr doctor` lists next steps; `rgr audit --unsupported` lists skipped files.
- In a long-running service, open one client per project root at startup and close it on
  `SIGTERM`. Tune concurrency with `workloadLimits` only after a representative benchmark.
- Without internet access, build or pull the image where the registry is reachable and move it
  with `docker save` and `docker load`, or install from an internal npm mirror. Ship a semantic
  model as a local snapshot (`rgr models pull --enable` where the network is available) with the
  configuration that records its pinned revision and digest.

## Confidentiality

Returned passages contain document text. Log citations rather than passages for confidential
corpora, check access before calling search, and give each audience its own base: Ragmir does not
apply per-user permissions. Sending passages to a cloud model sends them to that provider.

Reference: https://github.com/jcode-works/jcode-ragmir/blob/main/docs/server-deployment.md
