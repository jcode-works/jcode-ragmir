# App Sidecar Architecture

## Decision

The Mimir app will embed Mimir Core through a Node sidecar that runs the existing `kb` CLI/MCP
surface. Do not rewrite Mimir Core as Rust bindings for v1.

## Rationale

- Mimir Core already owns parsing, redaction, embeddings, LanceDB storage, query, MCP, and audit
  behavior.
- Reusing `kb` keeps the MIT core and the paid app on the same tested implementation.
- A Rust rewrite would duplicate LanceDB and Transformers.js integration risk before product demand
  is validated.
- The app can keep a narrow native boundary: project selection, process execution, progress/status,
  and local file permissions.

## Tauri Boundary

The intended Tauri v2 path is:

1. Build or package a platform-specific Mimir Core sidecar binary that exposes bounded `kb`
   workflows.
2. Add that binary to `bundle.externalBin` in `packages/mimir-app/src-tauri/tauri.conf.json`.
3. Add `@tauri-apps/plugin-shell` on the frontend and `tauri-plugin-shell` on the Rust side.
4. Grant only explicit sidecar permissions in
   `packages/mimir-app/src-tauri/capabilities/default.json`.
5. Call the sidecar through `Command.sidecar(...)`, with a fixed command allowlist.

Do not add `externalBin` before the actual sidecar binary exists for the native target triples.
Doing so would make native Tauri builds fail without adding product value.

## Initial Command Surface

The app should start with a small allowlist:

| Workflow | Sidecar command |
| --- | --- |
| Readiness | `kb doctor --json` |
| Safe repair | `kb doctor --fix --json` |
| Status | `kb status --json` |
| Ingest | `kb ingest --json` |
| Force rebuild | `kb ingest --rebuild --json` |
| Search | `kb search "<query>" --json` |
| Ask context | `kb ask "<question>" --json` |
| Privacy audit | `kb security-audit --json` |
| Unsupported files | `kb audit --unsupported --json` |
| Model preload | `kb models pull --json` |

The UI must pass an explicit project root for each selected knowledge base and keep generated state
inside that project (`.kb/`, `.mimir/`) unless the user intentionally chooses another local folder.

## Deferred Work

- Native sidecar binary build pipeline.
- Tauri shell plugin wiring.
- Progress events for long ingests.
- Multi-project registry and recent projects.
- Signed macOS/Windows packaging.
