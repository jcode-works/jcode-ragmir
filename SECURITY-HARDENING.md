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
- Metadata-only access logs: access logs contain action metadata and query hashes, not raw
  queries or retrieved text.
- Generated local state is ignored by Git: `.ragmir/` is ignored by default.
- MCP is read-focused: destructive tools are not exposed over MCP, and MCP retrieval is capped by
  `mcpMaxTopK`.
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
pnpm add -D ./jcode.labs-ragmir-tts-<version>.tgz ./jcode.labs-ragmir-<version>.tgz
pnpm exec rgr setup
pnpm exec rgr doctor --fix
pnpm exec rgr audit --unsupported
```

For semantic embeddings, preload the Transformers.js-compatible embedding model files inside the
offline environment under the configured `embeddingModelPath`. For audio, preload the TTS model
files under `.ragmir/models/tts` and render with
`pnpm exec rgr audio <text-file> --engine transformers --offline`.

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
  "embeddingModel": "mixedbread-ai/mxbai-embed-xsmall-v1",
  "embeddingModelPath": ".ragmir/models",
  "transformersAllowRemoteModels": false
}
```

The local-hash mode performs lexical/hash retrieval only. It is useful for smoke tests,
dependency-light offline workflows, and handing cited passages to another trusted LLM. It is not
equivalent to model semantic retrieval.

Keep `transformersAllowRemoteModels` false for confidential or air-gapped work. If it is true,
Transformers.js may download model files from Hugging Face during model loading.

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
- `ingestConcurrency`: four parse/chunk workers by default;
- `embeddingBatchSize`: 32 chunks per embedding batch by default;
- checksum-based stale detection for supported files;
- unsupported/skipped file reporting through `rgr ingest`, `rgr audit`, and
  `rgr audit --unsupported`.

These are configurable, but raising limits increases local memory and parsing risk.

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

For team use, prefer one checkout per user or per role. Ragmir does not implement RBAC.

## Release Verification

The protected npm workflow runs validation, generates release artifacts, and publishes both
workspace packages with provenance:

```bash
pnpm --dir packages/ragmir-tts publish --access public --provenance --no-git-checks
pnpm --dir packages/ragmir-core publish --access public --provenance --no-git-checks
```

Release artifacts include:

- npm tarballs for `@jcode.labs/ragmir-tts` and `@jcode.labs/ragmir`;
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
