# Ragmir Security Hardening

*Stop sending confidential documents directly to the cloud.*

Ragmir reduces document exposure by keeping its index and normal retrieval local. It is not a
security certification and does not replace encrypted storage, operating-system isolation, or review
of an agent that receives retrieved passages.

## Defaults

- `.ragmir/` is generated locally and ignored by Git.
- `local-hash` retrieval works without a model or network connection.
- Built-in redaction runs before indexing.
- Custom redaction expressions are rejected before matching when their syntax or repetition can
  cause catastrophic backtracking.
- Secret-like filenames are skipped and unsupported files are reported.
- Access logs contain metadata and salted query identifiers, not raw prompts or retrieved text.
- MCP tools advertise non-destructive behavior, and every tool or resource JSON response is
  byte-bounded. Search, ask, research, and evaluation conservatively advertise open-world behavior
  because explicitly enabled semantic models may download public weights. Tools that can append
  metadata-only logs or initialize local state use conservative read-only and idempotency hints.
- Strict MCP diagnostics mask configured model, storage, source, and access-log paths. Evaluation
  returns a project-relative golden path and replaces operational errors with a generic message.
- Remote model loading is disabled on the normal confidential path. Downloads are possible only
  after the operator explicitly enables remote Transformers models or runs the model-pull setup.

## Check a workspace

```bash
rgr doctor
rgr audit --unsupported
rgr security-audit
rgr security-audit --strict
```

`doctor` reports missing setup and stale indexes. `audit --unsupported` exposes files that Ragmir did
not index. The security audit checks the config, raw documents, storage, source list, access log and
model directory for permissions, Git-ignore coverage and tracked files. It also reports configured
extractors, which execute with the current operator's filesystem and process authority. The strict
audit is the local readiness check before using a sensitive corpus and disables those extractors.

## Recommended operation

- Store the repository and `.ragmir/` on an encrypted disk when at-rest protection matters.
- Use one checkout per trust boundary.
- Keep raw documents, environment files, credentials, and generated state out of commits.
- Treat an audit warning about a tracked private path as an exposure: remove it from Git history as
  appropriate and rotate any credential that reached a remote.
- Treat a team file-sync service as a separate trust boundary. Ragmir does not upload the corpus,
  but a Google Drive account or another sync tool follows its own access and retention policy.
- Synchronize source files, not an actively written `.ragmir/storage/` directory.
- Preload optional embedding, chat, or TTS models with non-sensitive text before using them offline.
- Treat cited passages as evidence to review, not as automatically correct conclusions.

## Limits

Ragmir cannot protect a compromised machine, an untrusted local user, malicious dependencies already
installed on the machine, or a cloud agent that you choose to send excerpts to. It also does not
guarantee that generated answers are correct, even when their citations are valid.
