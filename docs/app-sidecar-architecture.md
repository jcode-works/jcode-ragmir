# App Sidecar Architecture

## Decision

The Mimir app embeds Mimir Core through the existing `mimir` CLI/MCP surface, with a packaged
Node sidecar as the intended distribution path. Do not rewrite Mimir Core as Rust bindings for v1.

## Rationale

- Mimir Core already owns parsing, redaction, embeddings, LanceDB storage, query, MCP, and audit
  behavior.
- Reusing `mimir` keeps the MIT core and the paid app on the same tested implementation.
- A Rust rewrite would duplicate LanceDB and Transformers.js integration risk before product demand
  is validated.
- The app can keep a narrow native boundary: project selection, process execution, progress/status,
  and local file permissions.

## Tauri Boundary

The current app uses a narrow custom Tauri command, `run_mimir_command`, implemented in
`packages/mimir-app/src-tauri/src/lib.rs`. It does not expose a general shell. The command accepts a
fixed enum of Mimir workflows, always prepends `--project-root <path>`, always requests `--json`, and
executes the `mimir` binary from `PATH` or `MIMIR_CLI_BIN`.

The future packaged sidecar path remains:

1. Build or package a platform-specific Mimir Core sidecar binary that exposes bounded `mimir`
   workflows.
2. Add that binary to `bundle.externalBin` in `packages/mimir-app/src-tauri/tauri.conf.json`.
3. Add `@tauri-apps/plugin-shell` on the frontend and `tauri-plugin-shell` on the Rust side only if
   the packaged sidecar needs the official shell-plugin path.
4. Grant only explicit sidecar permissions in
   `packages/mimir-app/src-tauri/capabilities/default.json`.
5. Call the sidecar through `Command.sidecar(...)`, with a fixed command allowlist.

Do not add `externalBin` before the actual sidecar binary exists for the native target triples.
Doing so would make native Tauri builds fail without adding product value.

## Initial Command Surface

The app should start with a small allowlist:

| Workflow | Sidecar command |
| --- | --- |
| Readiness | `mimir doctor --json` |
| Safe repair | `mimir doctor --fix --json` |
| Status | `mimir status --json` |
| Ingest | `mimir ingest --json` |
| Force rebuild | `mimir ingest --rebuild --json` |
| Search | `mimir search "<query>" --json` |
| Ask context | `mimir ask "<question>" --json` |
| Privacy audit | `mimir security-audit --json` |
| Unsupported files | `mimir audit --unsupported --json` |
| Model preload | `mimir models pull --json` |

The UI must pass an explicit project root for each selected knowledge base with
`mimir --project-root "<path>" ...` and keep generated state inside that project (`.kb/`, `.mimir/`)
unless the user intentionally chooses another local folder.

## Deferred Work

- Native sidecar binary build pipeline.
- Progress events for long ingests.
- Signed macOS/Windows packaging.
