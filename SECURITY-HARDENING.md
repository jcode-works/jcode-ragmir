# Mimir Security Hardening

Mimir is a local-first knowledge base for private project documents. It is built to minimize
data movement, but it is not a certified high-assurance system.

## Current Guarantees

- Zero telemetry: Mimir does not send usage analytics or document content to JCode Labs.
- Local-only network policy by default: document text can only be sent to loopback Ollama hosts
  unless the repository explicitly opts in to broader network access.
- Redaction before indexing: built-in DLP patterns redact common secrets and identifiers before
  chunks are embedded and stored.
- Metadata-only access logs: access logs contain action metadata and query hashes, not raw
  queries or retrieved text.
- Generated local state is ignored by Git: `.kb/`, `.mimir/`, and `private/**` are ignored by
  default.
- MCP is read-focused: destructive tools are not exposed over MCP, and MCP retrieval is capped by
  `mcpMaxTopK`.
- npm releases are published with provenance from the protected GitHub Actions workflow.
- Release artifacts include a package tarball, SHA256 checksums, SBOM, and manifest.

## Threat Model

Mimir protects against accidental repository leaks, accidental remote LLM usage, accidental secret
indexing, and weak release traceability.

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

Move the generated tarball from `release-artifacts/` into the offline environment and install it:

```bash
pnpm add -D ./jcode.labs-mimir-<version>.tgz
pnpm exec kb init
pnpm exec kb ingest
```

Ollama and the required models must also be preloaded inside the offline environment.

## Zero Network Posture

Default config:

```json
{
  "ollamaHost": "http://localhost:11434",
  "networkPolicy": "local-only"
}
```

Allowed policies:

- `local-only`: only loopback hosts such as `localhost` and `127.0.0.1`.
- `allow-private`: loopback and private LAN hosts.
- `allow-any`: any host. Use only when the remote endpoint is explicitly trusted.

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

The protected npm workflow runs validation, generates release artifacts, and publishes with
provenance:

```bash
npm publish --access public --provenance
```

Release artifacts include:

- npm tarball;
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
