# Ragmir Security Hardening

Ragmir is a sovereign local RAG knowledge base for confidential project documents and datasets. It is
built to minimize data movement, but it is not a certified high-assurance system.

## Current Guarantees

- Zero telemetry: Ragmir does not send usage analytics or document content to JCode Labs.
- Retrieval-only core: Ragmir does not call a chat model or generate LLM answers.
- No-model retrieval mode: `embeddingProvider: "local-hash"` can ingest, search, and return cited
  passages without a model server.
- Optional semantic embeddings: `embeddingProvider: "transformers"` uses Transformers.js, with
  remote model loading disabled by default through `transformersAllowRemoteModels: false`.
- Redaction before indexing: built-in DLP patterns redact common secrets and identifiers before
  chunks are embedded and stored.
- Secret-like files are skipped by default: common private-key, certificate, and credential
  filenames/extensions are not indexed even when they appear under a source directory.
- Ingestion has a default per-file size cap through `maxFileBytes` and reports unsupported,
  oversized, and secret-like skipped files.
- Metadata-only access logs: access logs contain action metadata and project-salted HMAC query
  hashes, not raw queries or retrieved text.
- Private local modes: Ragmir-created directories use `0700` and generated sensitive files use
  `0600` on POSIX systems. `security-audit` reports permissive legacy modes and `doctor --fix`
  repairs Ragmir-owned default config and directory modes. Custom external paths remain under the
  operator's permission policy.
- Generated local state is ignored by Git: `.ragmir/` is ignored by default.
- MCP is read-focused: destructive tools are not exposed over MCP, and MCP retrieval is capped by
  `mcpMaxTopK`.
- Optional local chat uses `rgr chat` / `@jcode.labs/ragmir-chat`. Ragmir Core stays retrieval-only;
  the add-on runs verified Gemma 4 QAT GGUF weights through `node-llama-cpp` 3.19, with explicit setup
  as the only normal download path and normal answers offline.
- Optional audio summaries use `rgr audio` / `@jcode.labs/ragmir-tts`. Transformers.js WAV is the
  default offline/confidential path and does not require Python, ffmpeg, Piper, XTTS, or a local TTS
  server. Remote TTS model downloads are disabled by default and must be explicitly allowed for a
  non-sensitive preload. Edge MP3 gives the highest quality only when online TTS is explicitly
  acceptable.
- Optional Markdown reports use the bundled `ragmir-markdown-report` skill and should be written
  under `.ragmir/reports/` by default.
- npm releases are published with provenance from the protected GitHub Actions workflow.
- Release artifacts include a package tarball, SHA256 checksums, SBOM, and manifest.

## Threat Model

Ragmir protects against accidental repository leaks, accidental built-in LLM usage, accidental online
TTS usage when the offline path is requested, accidental secret indexing, and weak release
traceability.

Ragmir does not protect against a compromised local machine, malicious dependencies already present
in the runtime, a user with filesystem access to the same checkout, or forensic recovery from an
unencrypted disk.

Ragmir also does not make generated answers true. Chat citation markers are validated against the
retrieved source list, but a real citation can still be misunderstood by the model or contain
incorrect source material. Review important conclusions against the cited passages.

## At-Rest Encryption

Native encrypted LanceDB storage is not implemented yet. For sensitive environments, put the
repository and `.ragmir/` on an encrypted volume:

- macOS: FileVault or an encrypted APFS volume.
- Linux: LUKS, fscrypt, or an encrypted VM disk.
- Containers/VMs: mount `.ragmir/` on an encrypted host volume.

`rgr destroy-index --yes` removes generated index files, but secure deletion on SSDs and copy-on-write
filesystems cannot be guaranteed without encrypted storage and key destruction.

## Air-Gapped Operation

Prepare artifacts on an internet-connected build machine:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm release:artifacts
```

Move the generated tarballs from `release-artifacts/` into the offline environment and install them:

```bash
pnpm add -D ./jcode.labs-ragmir-tts-<version>.tgz ./jcode.labs-ragmir-chat-<version>.tgz ./jcode.labs-ragmir-<version>.tgz
pnpm exec rgr setup
pnpm exec rgr doctor --fix
pnpm exec rgr audit --unsupported
```

For semantic embeddings, preload the Transformers.js-compatible embedding model files inside the
offline environment under the configured `embeddingModelPath`. For audio, preload the TTS model
files under `.ragmir/models/tts` and render with
`pnpm exec rgr audio <text-file> --engine transformers --offline`.

For chat, run explicit setup on a connected preparation machine, then transfer the complete selected
profile directory, including its GGUF and manifest, into the same ignored path on the offline
machine:

```bash
pnpm exec rgr chat setup --profile fast
pnpm exec rgr chat doctor --profile fast --verify
pnpm exec rgr chat "Question" --profile fast --thinking standard --offline
```

Do not transfer an incomplete GGUF or recreate the manifest by hand. Normal doctor checks the exact
byte size; use `--verify` after transfer to recompute the full SHA-256.

## Zero Network Posture

Default no-model config:

```json
{
  "embeddingProvider": "local-hash"
}
```

Optional semantic config:

```json
{
  "embeddingProvider": "transformers",
  "embeddingModel": "intfloat/multilingual-e5-small",
  "embeddingModelRevision": "main",
  "embeddingModelPath": ".ragmir/models",
  "transformersAllowRemoteModels": false
}
```

The local-hash mode performs lexical/hash retrieval only. It is useful for smoke tests,
dependency-light offline workflows, and handing cited passages to another trusted LLM. It is not
equivalent to model semantic retrieval.

Keep `transformersAllowRemoteModels` false for confidential or air-gapped work. If it is true,
Transformers.js may download model files from Hugging Face during model loading.

For reproducible or reviewed deployments, pin `embeddingModelRevision` to an immutable revision.
Ragmir includes the revision and the complete content-transformation policy in its index fingerprint;
search rejects an incompatible index and ingestion rebuilds it safely.

`privacyProfile` and `retrievalProfile` are orthogonal. The `strict` privacy floor is applied after
environment overrides, so remote model loading, disabled built-in redaction, high MCP disclosure,
and external extractors cannot weaken it silently. It still does not replace disk encryption, local
account isolation, or a trusted MCP client.

This Transformers setting controls semantic embeddings, not Gemma chat. Chat downloads are isolated
behind `rgr chat setup [--profile fast|quality]`. Normal answers require an existing verified local
GGUF and do not resolve a remote model.

Run:

```bash
pnpm exec rgr security-audit --strict
```

Also run:

```bash
pnpm exec rgr audit --unsupported
```

This exposes local relative paths for files that were skipped because the extension is unsupported,
the file exceeds `maxFileBytes`, or the filename looks like a secret/key artifact. Use it before
assuming a dossier was fully indexed.

## DLP Redaction

Built-in redaction is enabled by default for common secret and identifier shapes: private keys,
JWTs, API tokens, emails, IBANs, and card-like numbers.

Custom patterns can be added in `.ragmir/config.json`:

```json
{
  "redaction": {
    "enabled": true,
    "builtIn": true,
    "patterns": [
      {
        "name": "internal_case_id",
        "pattern": "CASE-[0-9]+",
        "replacement": "[CASE]"
      }
    ]
  }
}
```

Redaction changes the indexed text, not the raw files under `private/`.

## Ingestion Boundaries

Ragmir indexes many text, document, Office/OpenDocument, PDF, EPUB, subtitle, notebook, mail, config,
and source-code formats. It does not silently ingest every binary file. Unsupported images, scans,
audio/video, old proprietary Office binaries, and unknown formats must be converted, OCRed, or
transcribed first.

Default ingestion guardrails:

- `maxFileBytes`: 50 MB per file by default;
- no hard file-count or total-corpus-byte ceiling, with disk, memory, embedding throughput, and
  exact-search latency as practical constraints;
- `ingestConcurrency`: four parse/chunk workers by default;
- `embeddingBatchSize`: 32 chunks per embedding batch by default;
- checksum-based stale detection for supported files;
- manifest-driven file-level updates and automatic rebuild on index-policy change;
- page-aware PDF extraction, blank-page-only OCR, a 1000-page limit, and a 25-million-character
  extracted-text limit;
- unsupported/skipped file reporting through `rgr ingest`, `rgr audit`, and
  `rgr audit --unsupported`.

Run `rgr limits` for the effective values. The per-file limit is configurable, but PDF,
Office/archive, and external-extractor output bounds are hard safety blocks. Raising configurable
limits increases local memory and parsing risk. Missing, stale, empty-text, or oversized coverage
keeps `doctor.ready` false.

## Optional Audio Summaries

`rgr install-skill` installs an optional `ragmir-audio-summary` skill. It is designed for listenable
briefings from a local Ragmir index. The default renderer is `rgr audio`, backed by
`@jcode.labs/ragmir-tts`.

Confidentiality defaults:

- narration text is written to a temp file outside the repository;
- generated MP3 or WAV audio should be written under `.ragmir/audio/`;
- `.ragmir/` is ignored by Git;
- Transformers.js WAV does not require Python, ffmpeg, Piper, XTTS, or a local TTS server;
- Transformers remote model loading is disabled by default and requires `--allow-remote-models` for
  a non-sensitive preload into `.ragmir/models/tts`;
- `--engine transformers --offline` keeps remote model loading disabled and requires preloaded model
  files.
- Edge MP3 uses the online Edge TTS service through the external `edge-tts` CLI and should be used
  only when sending the narration text to that service is acceptable.

Generated audio can still contain sensitive information. Treat it like a derived confidential
document.

## Optional Local Chat

`rgr chat` uses `@jcode.labs/ragmir-chat` to run official Google Gemma 4 QAT GGUF weights over
retrieved Ragmir passages through `node-llama-cpp` 3.19. This does not change the core security audit:
Ragmir Core itself still reports `llmGeneration=false`.

The current runtime supports desktop and CLI workflows. Android chat is deferred until its native
runtime and packaging have been implemented and verified. The desktop/CLI path does not require
Ollama, Python, or a hosted LLM API.

Profiles:

| Profile | Model | Download size | Manifest |
| --- | --- | ---: | --- |
| `fast` (default) | Gemma 4 E2B QAT GGUF | 3.35 GB | `.ragmir/models/chat/fast/manifest.json` |
| `quality` (opt-in) | Gemma 4 E4B QAT GGUF | 5.15 GB | `.ragmir/models/chat/quality/manifest.json` |

The built-in model URIs and download URLs pin immutable Hugging Face revisions rather than `main`.
The manifest preserves that revision together with `schemaVersion`, provider, runtime version,
profile, model ID, official source and license URLs, `Apache-2.0` license identifier, relative
filename, exact byte size, SHA-256, and verification time. It stores no absolute project path.

Confidentiality defaults:

- `rgr chat setup [--profile fast|quality]` is the only normal chat path that downloads a model;
- setup verifies the exact expected size and SHA-256 before writing the profile manifest;
- chat model files and manifests stay under ignored `.ragmir/models/chat/<profile>/` directories;
- `.ragmir/` is ignored by Git;
- normal doctor checks the runtime, expected manifest, file, and exact size without rehashing the
  multi-gigabyte GGUF; `rgr chat doctor --verify` performs the full SHA-256 check and reports
  `modelHashValid`;
- normal answers load only a ready local profile and keep network resolution off;
- `--thinking off`, `standard`, and `deep` control bounded local reasoning, but raw thought is never
  displayed, returned, stored, or logged;
- only the user-visible question and final answer may enter local chat history;
- generated citation markers are checked against the retrieved source list, but cited output still
  needs review against the actual passages.

`rgr-chat serve` is the persistent strict internal stdio JSONL transport for desktop integration.
Requests enter on stdin and protocol events leave on stdout. It is not a user chat interface, must
not mix operational logs into stdout, and never exposes raw thought text. Core `rgr chat` imports the
package API directly for one-shot answers and does not require the server.

Ragmir's tracked source remains MIT-licensed. Downloaded Gemma 4 weights are separate Apache-2.0
assets and must not be committed to this repository.

## Optional Markdown Reports

`rgr install-skill` also installs `ragmir-markdown-report`. Reports generated from private evidence
are derived confidential documents. Keep them under `.ragmir/reports/` by default, cite source paths
and chunk numbers, and do not commit them unless the user explicitly asks for a sanitized tracked
report.

## MCP Hardening

MCP gives an agent access to retrieved private context. Use it only for agents running under the
same trust boundary as the repository.

Ragmir MCP defaults:

- read-focused tools only;
- no index deletion tool exposed over MCP;
- bounded retrieval through `mcpMaxTopK`;
- metadata-only access logging.

Under `privacyProfile: "strict"`, search and research are compact by default, `ask` returns compact
cited retrieval instead of full passages, status/security paths are project-relative, MCP `topK` is
capped at 5, and repository-wide code scanning is disabled. Any MCP client that receives retrieved
content remains inside the confidentiality threat boundary.

For team use, prefer one checkout per user or per role. Ragmir does not implement RBAC.

## Release Verification

The protected npm workflow runs validation, generates release artifacts, and publishes the
workspace packages with provenance:

```bash
pnpm --dir packages/ragmir-tts publish --access public --provenance --no-git-checks
pnpm --dir packages/ragmir-chat publish --access public --provenance --no-git-checks
pnpm --dir packages/ragmir-core publish --access public --provenance --no-git-checks
```

Release artifacts include:

- npm tarballs for `@jcode.labs/ragmir-tts`, `@jcode.labs/ragmir-chat`, and
  `@jcode.labs/ragmir`;
- `SHA256SUMS`;
- CycloneDX SBOM;
- `release-manifest.json`.

Verify checksums offline with:

```bash
sha256sum -c SHA256SUMS
```

On macOS:

```bash
shasum -a 256 -c SHA256SUMS
```

## External Audit Status

No external security audit has been completed yet. Treat Ragmir as useful hardening for private
developer workflows, not as military-grade certified software.
