# App Sidecar Architecture

## Decision

The Ragmir app embeds Ragmir Core through the existing `rgr` CLI/MCP surface, with a packaged
Node sidecar as the intended distribution path. Do not rewrite Ragmir Core as Rust bindings for v1.

## Rationale

- Ragmir Core already owns parsing, redaction, embeddings, LanceDB storage, query, MCP, and audit
  behavior.
- Reusing `rgr` keeps the MIT core and the app shell on the same tested implementation.
- A Rust rewrite would duplicate LanceDB and Transformers.js integration risk before product demand
  is validated.
- The app can keep a narrow native boundary: project selection, process execution, progress/status,
  and local file permissions.

## Tauri Boundary

The current app uses a narrow custom Tauri command, `run_ragmir_command`, implemented in
`packages/ragmir-app/src-tauri/src/lib.rs`. It does not expose a general shell. The command accepts a
fixed enum of Ragmir workflows, always prepends `--project-root <path>`, always requests `--json`, and
executes the `rgr` binary from `PATH` or `RAGMIR_CLI_BIN`. The native boundary rejects empty,
relative, or non-existent project roots before running the CLI.

The future packaged sidecar path remains:

1. Build or package a platform-specific Ragmir Core sidecar binary that exposes bounded `rgr`
   workflows.
2. Add that binary to `bundle.externalBin` in `packages/ragmir-app/src-tauri/tauri.conf.json`.
3. Add `@tauri-apps/plugin-shell` on the frontend and `tauri-plugin-shell` on the Rust side only if
   the packaged sidecar needs the official shell-plugin path.
4. Grant only explicit sidecar permissions in
   `packages/ragmir-app/src-tauri/capabilities/default.json`.
5. Call the sidecar through `Command.sidecar(...)`, with a fixed command allowlist.

Do not add `externalBin` before the actual sidecar binary exists for the native target triples.
Doing so would make native Tauri builds fail without adding product value.

Direct-download packaging, signing, and updater constraints live in
[`app-distribution.md`](./app-distribution.md). Keep updater setup deferred until a real release
public key, private signing key path, and HTTPS update endpoint exist.

## Initial Command Surface

The app should start with a small allowlist:

| Workflow | Sidecar command |
| --- | --- |
| Readiness | `rgr doctor --json` |
| Safe repair | `rgr doctor --fix --json` |
| Status | `rgr status --json` |
| Ingest | `rgr ingest --json` |
| Force rebuild | `rgr ingest --rebuild --json` |
| Search | `rgr search "<query>" --json` |
| Ask context | `rgr ask "<question>" --json` |
| Privacy audit | `rgr security-audit --json` |
| Unsupported files | `rgr audit --unsupported --json` |
| Model preload | `rgr models pull --enable --json` |
| Audio report | `rgr audio "<generated-text-file>" --offline --json` |

The UI must pass an explicit project root for each selected knowledge base with
`ragmir --project-root "<path>" ...` and keep generated state inside that project (`.ragmir/`)
unless the user intentionally chooses another local folder.

For audio reports, `run_ragmir_command` writes the current retrieval report text under ignored
`.ragmir/audio/` first, then passes that generated text file to `rgr audio --offline --json`.

For watched folders, the app does not expose a broader filesystem watcher. It stores an opt-in flag
per registered local project and periodically calls the existing incremental `rgr ingest --json`
workflow through the same bounded command surface.

The Google Drive connector is the same local path flow with a distinct source label: the user selects
a folder already synchronized by Google Drive for desktop, and the app enables local auto-ingest for
that folder. It does not add OAuth, Drive API calls, or provider credentials to the sidecar surface.

## Deferred Work

- Native sidecar binary build pipeline.
- Progress events for long ingests.
- Signed macOS/Windows packaging.
- Tauri updater wiring after release signing keys and update endpoint are ready.
- Hosted cloud connector APIs beyond local sync folders.
