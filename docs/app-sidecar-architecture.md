# App Sidecar Architecture

## Decision

The Ragmir app embeds Ragmir Core through the existing `rgr` CLI/MCP surface, with a packaged Node
sidecar as the intended distribution path. Desktop chat runs verified Qwen2.5 or Gemma 4 GGUF models through
`node-llama-cpp` 3.19 inside that Node boundary. Do not rewrite Ragmir Core or Ragmir Chat as Rust
bindings for v1.

## Rationale

- Ragmir Core already owns parsing, redaction, embeddings, LanceDB storage, query, MCP, and audit
  behavior.
- Reusing `rgr` keeps the MIT core and the app shell on the same tested implementation.
- A Rust rewrite would duplicate LanceDB, Transformers.js embedding/TTS, and native GGUF runtime
  integration before product demand is validated.
- The app can keep a narrow native boundary: project selection, process execution, progress/status,
  and local file permissions.
- Direct `node-llama-cpp` integration needs no Ollama server, Python runtime, or hosted LLM API.

## Tauri Boundary

The current app uses a narrow custom Tauri command, `run_ragmir_command`, implemented in
`packages/ragmir-app/src-tauri/src/lib.rs`. It does not expose a general shell. The command accepts a
fixed enum of Ragmir workflows, always prepends `--project-root <path>`, always requests `--json`, and
executes the `rgr` binary from `PATH` or `RAGMIR_CLI_BIN`. The native boundary rejects empty,
relative, or non-existent project roots before running the CLI.

The future packaged sidecar path remains:

1. Build or package a platform-specific Ragmir Node sidecar that exposes bounded `rgr` workflows and
   includes the matching `node-llama-cpp` native runtime for supported desktop targets.
2. Add that binary to `bundle.externalBin` in `packages/ragmir-app/src-tauri/tauri.conf.json`.
3. Add `@tauri-apps/plugin-shell` on the frontend and `tauri-plugin-shell` on the Rust side only if
   the packaged sidecar needs the official shell-plugin path.
4. Grant only explicit sidecar permissions in
   `packages/ragmir-app/src-tauri/capabilities/default.json`.
5. Call the sidecar through `Command.sidecar(...)`, with a fixed command allowlist.

Do not add `externalBin` before the actual sidecar binary exists for the native target triples.
Doing so would make native Tauri builds fail without adding product value.

Chat GGUF files are not bundled into the app by default. `rgr chat setup` is the explicit download
boundary and stores a verified model plus manifest under the selected project's ignored
`.ragmir/models/chat/<profile>/` directory. A packaged app must preserve this per-project boundary.

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
| Lite chat setup | `rgr chat setup --profile lite --json` |
| Fast chat setup | `rgr chat setup --profile fast --json` |
| Quality chat setup | `rgr chat setup --profile quality --json` |
| Chat readiness | `rgr chat doctor --profile fast --json` |
| Chat integrity audit | `rgr chat doctor --profile fast --verify --json` |
| Offline chat | `rgr chat "<question>" --profile fast --thinking standard --offline --json` |
| Privacy audit | `rgr security-audit --json` |
| Unsupported files | `rgr audit --unsupported --json` |
| Model preload | `rgr models pull --enable --json` |
| Audio report | `rgr audio "<generated-text-file>" --offline --json` |

The UI must pass an explicit project root for each selected knowledge base with
`rgr --project-root "<path>" ...` and keep generated state inside that project (`.ragmir/`)
unless the user intentionally chooses another local folder.

Chat setup is the only allowlisted chat workflow that may use the network. The `lite` profile uses a
491 MB Qwen2.5 0.5B GGUF for older computers, the default `fast` profile downloads the 3.35 GB Gemma
4 E2B GGUF, and `quality` explicitly selects the 5.15 GB E4B GGUF. Setup must
verify the exact byte size and SHA-256 before writing
`.ragmir/models/chat/<profile>/manifest.json`. Normal answers must use the verified local artifact
with network resolution disabled.

`rgr-chat serve` is the persistent internal strict stdio JSONL transport between the desktop app and
the chat runtime. Questions and retrieved context enter on stdin and must be treated as sensitive. The
transport emits protocol events only on stdout and is not exposed as a user workflow or a general
shell. stdout may carry the final answer and citation metadata, but never raw thought. stderr may
carry bounded operational diagnostics, but never raw prompts, retrieved passages, or raw thought.

The app may expose `off`, `standard`, and `deep` thinking controls for Gemma profiles. The `lite`
profile must force `off`. It can show phase labels such as
retrieving, reasoning, and writing, but it must never display, persist, or log raw thought. Only the
user-visible question and final answer belong in local thread history. Citation markers must be
validated against the retrieved source list, while the UI continues to warn that a valid citation
does not guarantee a true interpretation.

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
- Android chat runtime and packaging. Core app work may continue on Android, but Gemma chat remains
  desktop/CLI-only until the native path is implemented and verified.
- Progress events for long ingests.
- Signed macOS/Windows packaging.
- Tauri updater wiring after release signing keys and update endpoint are ready.
- Hosted cloud connector APIs beyond local sync folders.
