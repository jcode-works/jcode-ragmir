# Run Ragmir with Docker

The official images run the same `rgr` CLI and MCP server without installing Node.js: on a laptop,
in CI, on a server, or for an agent connected through MCP.

| Image | Holds |
| --- | --- |
| `ghcr.io/jcode-works/ragmir` | The CLI and MCP server with the offline `local-hash` provider |
| `ghcr.io/jcode-works/ragmir:full` | The same, plus the semantic model runtime, Tesseract OCR (English, French, German, Spanish, Italian, Portuguese), Poppler, and antiword |

Each release publishes `X.Y.Z`, `X.Y`, `X`, and `latest` for the standard image, and the same tags
with a `-full` suffix (plus `full`) for the full one, for `linux/amd64` and `linux/arm64`, with SBOM
and provenance attestations; the [package page](https://github.com/jcode-works/ragmir/pkgs/container/ragmir)
lists every tag. Pin an exact version in production. The images run as the
unprivileged `node` user, use `/workspace` as the working directory, and start `rgr`.

## Index and search a project

Mount the project at `/workspace` and pass your user ID so the files Ragmir writes under `.ragmir/`
belong to you:

```bash
alias rgr='docker run --rm -it -v "$PWD:/workspace" --user "$(id -u):$(id -g)" ghcr.io/jcode-works/ragmir'
rgr init
rgr sources add "docs/**/*.md" "specs/**/*.pdf"
rgr ingest
rgr search "release approval" --compact
```

Docker Desktop on macOS and Windows maps file ownership itself, so `--user` is optional there. In
PowerShell, mount the current folder with `-v "${PWD}:/workspace"`.

## Connect an agent

MCP clients start the server over stdio. Keep `-i` so the server reads its input, and use an
absolute project path, since MCP configuration files do not expand shell variables.

Claude Code, from the project:

```bash
claude mcp add --scope project ragmir -- \
  docker run --rm -i -v "$PWD:/workspace" --user "$(id -u):$(id -g)" ghcr.io/jcode-works/ragmir serve-mcp
```

Claude Desktop, Cursor, and other clients that read an `mcpServers` file:

```json
{
  "mcpServers": {
    "ragmir": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-v", "/absolute/path/to/project:/workspace",
        "ghcr.io/jcode-works/ragmir", "serve-mcp"
      ]
    }
  }
}
```

On Linux, add `"--user", "1000:1000"` with your own user and group IDs (`id -u`, `id -g`). The
server exposes the same tools as a local install, including `ragmir_ingest` to refresh the index;
see [agent integration](./agent-integration.md). The MCP Registry lists the image under
`io.github.jcode-works/ragmir`. The Python client uses this image automatically when Node.js is
absent ([Python guide](./python.md)).

## Semantic retrieval and OCR

Use the full image. Ragmir downloads the semantic model once, after you approve it, into the
project's `.ragmir/models`, so later runs work offline:

```bash
alias rgr='docker run --rm -it -v "$PWD:/workspace" --user "$(id -u):$(id -g)" ghcr.io/jcode-works/ragmir:full'
rgr models list                      # the recommended model, download size, and memory
rgr models pull --enable --model onnx-community/granite-embedding-97m-multilingual-r2-ONNX
rgr ocr doctor
rgr ocr setup --images --legacy-word --language eng+fra
rgr ingest
```

`rgr models pull --enable` downloads the model and switches the project to it; the next ingest
rebuilds the index with semantic vectors.

`rgr ocr setup` records the Tesseract command and the languages (`--language`, from `eng`, `fra`,
`deu`, `spa`, `ita`, and `por`) in the project configuration; OCR then runs inside the container on
blank PDF pages, images, and legacy `.doc` files. Run that ingest with `rgr ingest`:
MCP clients cannot start an ingest while external extractors are configured.

## Servers and CI

Run `rgr ingest` from a scheduled job after the documents change, with the index on the mounted
project or on a volume set as `storageDir`. For a locked-down run, add `--read-only --tmpfs /tmp
--network none`; the standard image needs no network after it is pulled. To bake a configuration
into your own image, or to use the TypeScript API inside your service, follow
[Run Ragmir on a server](./server-deployment.md).

Without internet access, pull the image where the registry is reachable, then move it with
`docker save` and `docker load`.
