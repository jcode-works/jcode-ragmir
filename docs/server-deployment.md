# Run Ragmir on a server

Ragmir runs wherever Node.js 22.12 runs: a VPS, an on-premise server, a customer network without
internet access, a CI runner, or a container. It is a library and a CLI, not a hosted service: it
opens no port, needs no account, and the default `local-hash` provider makes no network call. Your
service decides who may search and where the returned passages go.

## What runs where

| Piece | Where it runs | Notes |
| --- | --- | --- |
| Parsing, optional OCR, embeddings, index, search | Inside the Ragmir process on the server | `local-hash` needs no model; semantic models load from a local snapshot. |
| Index | `storageDir`, for example a volume at `/var/lib/ragmir` | One writer at a time; searches keep working while an ingest runs. |
| TLS, authentication, authorization, rate limits | Your service or gateway | Ragmir has no HTTP server and does not know your users. |
| Generation | The model your application chooses | Local, self-hosted, or a provider that receives the passages you send. |

## A container layout

To try Ragmir without building anything, the official image `ghcr.io/jcode-works/ragmir` runs the
same CLI and MCP server on `node:22-bookworm-slim` for `linux/amd64` and `linux/arm64`: mount the
project at `/workspace`, for example
`docker run --rm -v "$PWD:/workspace" --user "$(id -u):$(id -g)" ghcr.io/jcode-works/ragmir ingest`.
Build your own image, as below, to bake in a configuration and pin dependencies with a lockfile.

The layout below was checked in `node:22-bookworm-slim` and `node:22-alpine` containers, as a
non-root user, with a read-only root filesystem and no network access. Install and index size depend
on your corpus; with the default `local-hash` provider, `node_modules` took about 200 MB on Debian
and 175 MB on Alpine.

```text
/srv/ragmir/
  package.json, package-lock.json   # depends on @jcode.labs/ragmir
  ragmir.config.json                # sources, base name, storageDir
  docs/                             # the documents, baked in or mounted read-only
/var/lib/ragmir/storage/            # the index, on a persistent volume
```

`ragmir.config.json` names the base, selects the sources, and moves the index out of the project:

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

Build the image, index the mounted documents, then search them:

```bash
docker build -t ragmir-handbook .
docker run --rm --read-only --tmpfs /tmp --network none \
  -v /srv/handbook:/srv/ragmir/docs:ro -v ragmir-index:/var/lib/ragmir \
  ragmir-handbook ingest
docker run --rm --read-only --tmpfs /tmp --network none \
  -v /srv/handbook:/srv/ragmir/docs:ro -v ragmir-index:/var/lib/ragmir \
  ragmir-handbook search "checkout retry policy" --compact
```

`node:22-alpine` works the same way. Without containers, install Node.js 22.12 or later, run
`npm install @jcode.labs/ragmir` in the project folder, and use the same `ragmir.config.json`.

## Keep the index fresh

Run `rgr ingest` from cron, a systemd timer, or your CI after the documents change. Ingestion is
incremental and resumable: unchanged files are reused, a changed file that fails to parse keeps its
last good evidence and is reported as stale, and a rebuild keeps the previous index active until its
replacement passes validation.

Ragmir serializes writers on one machine with a lock under `storageDir`; readers stay available.
That lock does not coordinate machines, so never share one writable index over NFS or SMB. Give
each host its own index, or let one host write and copy the result.

## Serve retrieval

**An agent on the same machine.** MCP clients launch `rgr serve-mcp` over stdio, from the project
folder or with `docker run -i ... serve-mcp`. The server exposes four read-only tools and names the
base it serves. See [agent integration](./agent-integration.md).

**Your own service.** Embed one client per project root in a long-running process and call it from
your routes after your own authentication and authorization checks:

```ts
import { createRagmirClient } from "@jcode.labs/ragmir"

const ragmir = await createRagmirClient({ cwd: "/srv/ragmir" })

/** Call from an authenticated route; Ragmir does not filter results per user. */
export async function retrieve(question: string) {
  const passages = await ragmir.search(question, { topK: 5, timeoutMs: 5_000 })
  return passages.map(({ citation, text, weakEvidence }) => ({ citation, text, weakEvidence }))
}

process.once("SIGTERM", () => {
  void ragmir.close().finally(() => process.exit(0))
})
```

Your service owns TLS, authentication, rate limits, and logs. Returned passages contain document
text, so log citations rather than passages when the corpus is confidential. Ragmir does not apply
per-user permissions: give each audience its own base and check access before calling `search`.
Process-local queues bound concurrent work; tune them with `workloadLimits` in the
[configuration](./configuration.md).

## Without internet access

Build the image where the npm registry is reachable, then move it with `docker save` and
`docker load`, or install from your internal npm mirror. At runtime, `local-hash` makes no network
call: the container above ingests and searches with `--network none`.

For semantic retrieval, add `@huggingface/transformers`, run `rgr setup --semantic` where the
network is available, and ship the model folder (`embeddingModelPath`, `.ragmir/models` by default)
with the Ragmir config that records its pinned revision and digest. Normal retrieval keeps remote
model loading disabled, so the server never downloads it. For scanned documents, install Tesseract
or OCRmyPDF in the image and configure it with `rgr ocr doctor` and `rgr ocr setup`.

## Before handing it over

- `rgr status --json` reports `ready`, the base name, and the indexed file count for health checks.
- `rgr doctor` checks freshness and configuration and lists the next steps.
- `rgr audit --unsupported` lists the files that were skipped and why.
- `rgr evaluate --golden golden.json` measures retrieval on the customer's own questions, including
  hard negatives that must return nothing, before anyone relies on the answers.

Commit `ragmir.config.json` with the deployment so the next team inherits the same sources and
settings. Keep the index, models, and documents out of Git.
