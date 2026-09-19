# Local data and security boundaries

Ragmir is the retrieval layer for agentic RAG. It indexes selected local documents and returns
source passages with citations to your chat, application, or developer agent. The consumer chooses
the model, plans further retrieval, generates answers, and controls actions.

## Is it confidential?

A local index keeps storage and retrieval on the machine running Ragmir. Confidentiality across
the complete workflow also depends on the consumer and model:

- **Entirely local:** documents, index, chat application, and model run on your machine. Ensure the
  application does not forward prompts or passages through cloud models, external tools, or logs.
- **Self-hosted inference:** selected passages go to your server, whether on your own hardware or
  rented cloud infrastructure. Access, transport, administrators, logs, backups, and the host's
  policies define the boundary. Self-hosting alone does not guarantee confidentiality.
- **Managed cloud inference:** the chosen service receives the question and evidence the consumer
  sends. Its applicable retention and data-use policies govern that content. Keeping Ragmir's
  index local does not prevent this transmission.

Ragmir preserves source text without masking or anonymization. Retrieved text and metadata may
include confidential content, filenames, and project paths. The index itself contains source
passages and needs the same protection as the documents. See the
[local, self-hosted, and cloud integration examples](./docs/agent-integration.md).

## Defaults and limits

- Setup adds `.ragmir/` to Git ignore rules. Git ignore prevents accidental tracking; it does not
  encrypt data or restrict access by other software.
- `local-hash` retrieval works without a model, API key, or network connection.
- Secret-like filenames are excluded at discovery. This is not a content scanner or a guarantee
  that selected documents contain no secrets. Review the source selection before ingestion.
- MCP exposes status, search, citation expansion, and source audit with bounded JSON responses.
  Size limits bound output volume; they are not document-level access controls.
- Semantic embeddings run locally through optional Transformers. Preload model files for offline
  use. Remote model downloads require explicit configuration or a model-pull command; they are
  separate from sending retrieved text to a generation provider.
- OCR runs a configured local executable only for blank PDF pages. External extraction is opt-in
  and runs with the operator's filesystem and process authority. Ragmir does not sandbox an
  arbitrary executable or prevent it from accessing the network.

## Inspect a workspace

```bash
rgr doctor --deep
rgr audit --unsupported
rgr security-audit
rgr security-audit --strict
```

The security audit checks permissions, Git-ignore coverage, tracked private paths, remote model
settings, and configured extraction commands. `--strict` exits unsuccessfully on warnings; it does
not change configuration or disable extraction. Operational readiness and these advisories are
reported separately, so a deliberately enabled local OCR engine can remain ready. Passing this
check does not audit the consuming chat, model server, cloud account, or organization's policies.

## Operate within your data boundary

Keep credentials and generated indexes out of commits, restrict filesystem access, and use
appropriate disk and backup encryption. Share source files rather than an actively written index
directory. A cloud file-sync provider has its own access and retention policy.

Give each consumer only the bases it may read. The host application must enforce user and tenant
access before retrieval; search path filters are query options, not an authorization layer. A
network-facing host owns authentication, authorization, TLS, rate limits, and request logging.
Ragmir's MCP server uses stdio and does not open an HTTP port or provide hosted access controls.

Review where the chat stores history and whether tools, traces, proxies, or inference logs record
passages. For a local Ollama setup, also disable cloud features when required; localhost alone does
not prove local inference. For a self-hosted model, review network and administrator access as well
as the model process.

Treat retrieved documents as evidence, not instructions. A source can contain misleading content
or prompt injection, and a model can misread valid evidence. Verify citations and keep execution
permissions and consequential actions under the consuming application's control. Ragmir cannot
protect a compromised machine or certify confidentiality, compliance, or answer correctness.
