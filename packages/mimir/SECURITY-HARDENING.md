# Mimir Security Hardening

Mimir is a sovereign local RAG knowledge base for confidential project documents and datasets. It is
built to minimize data movement, but it is not a certified high-assurance system.

## Current Guarantees

- Zero telemetry: Mimir does not send usage analytics or document content to JCode Labs.
- Retrieval-only core: Mimir does not call a chat model or generate LLM answers.
- No-model retrieval mode: `embeddingProvider: "local-hash"` can ingest, search, and return cited
  passages without a model server.
- Optional semantic embeddings: `embeddingProvider: "transformers"` uses Transformers.js, with
  remote model loading disabled by default through `transformersAllowRemoteModels: false`.
- Redaction before indexing: built-in DLP patterns redact common secrets and identifiers before
  chunks are embedded and stored.
- Metadata-only access logs: access logs contain action metadata and query hashes, not raw
  queries or retrieved text.
- Generated local state is ignored by Git: `.kb/`, `.mimir/`, and `private/**` are ignored by
  default.
- MCP is read-focused: destructive tools are not exposed over MCP, and MCP retrieval is capped by
  `mcpMaxTopK`.
- Optional audio summaries use `kb audio` / `@jcode.labs/mimir-tts` for local WAV rendering with
  Transformers.js. They do not require Python, ffmpeg, Piper, XTTS, or a local TTS server.
- npm releases are published with provenance from the protected GitHub Actions workflow.
- Release artifacts include a package tarball, SHA256 checksums, SBOM, and manifest.

## Threat Model

Mimir protects against accidental repository leaks, accidental built-in LLM usage, accidental online
TTS usage for generated summaries, accidental secret indexing, and weak release traceability.

Mimir does not protect against a compromised local machine, malicious dependencies already present
in the runtime, a user with filesystem access to the same checkout, or forensic recovery from an
unencrypted disk.

## At-Rest Encryption

Native encrypted LanceDB storage is not implemented yet. For sensitive environments, put the
repository and `.kb/` on an encrypted volume:

- macOS: FileVault or an encrypted APFS volume.
- Linux: LUKS, fscrypt, or an encrypted VM disk.
- Containers/VMs: mount `.kb/` on an encrypted host volume.

`kb destroy-index --yes` removes generated index files, but secure deletion on SSDs and copy-on-write
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
pnpm add -D ./jcode.labs-mimir-tts-<version>.tgz ./jcode.labs-mimir-<version>.tgz
pnpm exec kb init
pnpm exec kb ingest
```

For semantic embeddings, preload the Transformers.js-compatible embedding model files inside the
offline environment under the configured `embeddingModelPath`. For audio, preload the TTS model
files under `.mimir/models/tts` and render with `pnpm exec kb audio <text-file> --offline`.

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
  "embeddingModelPath": ".mimir/models",
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
pnpm exec kb security-audit --strict
```

## DLP Redaction

Built-in redaction is enabled by default for common secret and identifier shapes: private keys,
JWTs, API tokens, emails, IBANs, and card-like numbers.

Custom patterns can be added in `.kb/config.json`:

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

## Optional Audio Summaries

`kb install-skill` installs an optional `mimir-audio-summary` skill. It is designed for listenable
briefings from a local Mimir index. The default renderer is `kb audio`, backed by
`@jcode.labs/mimir-tts` and Transformers.js.

Confidentiality defaults:

- narration text is written to a temp file outside the repository;
- generated WAV audio should be written under `.mimir/audio/`;
- `.mimir/` is ignored by Git;
- Python, ffmpeg, Piper, XTTS, and local TTS servers are not required for the default path;
- the first online-enabled render may download public model weights into `.mimir/models/tts`, but
  the narration text is processed locally;
- `--offline` disables remote model loading and requires preloaded model files.

Generated audio can still contain sensitive information. Treat it like a derived confidential
document.

## MCP Hardening

MCP gives an agent access to retrieved private context. Use it only for agents running under the
same trust boundary as the repository.

Mimir MCP defaults:

- read-focused tools only;
- no index deletion tool exposed over MCP;
- bounded retrieval through `mcpMaxTopK`;
- metadata-only access logging.

For team use, prefer one checkout per user or per role. Mimir does not implement RBAC.

## Release Verification

The protected npm workflow runs validation, generates release artifacts, and publishes both
workspace packages with provenance:

```bash
pnpm --dir packages/mimir-tts publish --access public --provenance --no-git-checks
pnpm --dir packages/mimir publish --access public --provenance --no-git-checks
```

Release artifacts include:

- npm tarballs for `@jcode.labs/mimir-tts` and `@jcode.labs/mimir`;
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

No external security audit has been completed yet. Treat Mimir as useful hardening for private
developer workflows, not as military-grade certified software.
