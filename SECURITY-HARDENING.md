# Ragmir Security Hardening

Ragmir reduces document exposure by keeping its index and normal retrieval local. It is not a
security certification and does not replace encrypted storage, operating-system isolation, or review
of an agent that receives retrieved passages.

## Defaults

- `.ragmir/` is generated locally and ignored by Git.
- `local-hash` retrieval works without a model or network connection.
- Built-in redaction runs before indexing.
- Secret-like filenames are skipped and unsupported files are reported.
- Access logs contain metadata and salted query identifiers, not raw prompts or retrieved text.
- MCP tools are read-focused and retrieval is bounded.
- Remote model downloads require an explicit setup action; normal confidential indexing keeps remote
  model loading disabled.

## Check a workspace

```bash
rgr doctor
rgr audit --unsupported
rgr security-audit
rgr security-audit --strict
```

`doctor` reports missing setup and stale indexes. `audit --unsupported` exposes files that Ragmir did
not index. The strict audit is the local readiness check before using a sensitive corpus.

## Recommended operation

- Store the repository and `.ragmir/` on an encrypted disk when at-rest protection matters.
- Use one checkout per trust boundary.
- Keep raw documents, environment files, credentials, and generated state out of commits.
- Preload optional embedding, chat, or TTS models with non-sensitive text before using them offline.
- Treat cited passages as evidence to review, not as automatically correct conclusions.

## Limits

Ragmir cannot protect a compromised machine, an untrusted local user, malicious dependencies already
installed on the machine, or a cloud agent that you choose to send excerpts to. It also does not
guarantee that generated answers are correct, even when their citations are valid.
