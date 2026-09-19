# Security Policy

## Supported Versions

Only the latest published version of `@jcode.labs/ragmir` receives security fixes.

## Reporting A Vulnerability

Please report vulnerabilities privately by email:

```plain text
contact@jcode.works
```

Do not open public issues for vulnerabilities, leaked secrets, credential exposure,
or private document disclosure.

## Data Boundary

Ragmir provides local retrieval for agentic RAG. It indexes selected project documents on the
machine running Ragmir and returns cited passages to the consuming application. The default
`local-hash` path keeps ingestion and retrieval offline; Ragmir does not upload the corpus to a
hosted RAG service. Optional semantic models run locally and can be preloaded for offline use.

The consumer decides where generation runs. A fully local application and model can keep the
workflow on one machine; a self-hosted endpoint receives passages over the network; a managed
cloud model or agent receives the evidence the application sends. A local index or self-hosted
model alone does not guarantee confidentiality. Ragmir does not mask or anonymize source content.

Protect source documents and generated indexes with appropriate access, encryption, and retention
controls. Keep private documents, `.ragmir/`, environment files, credentials, and customer records
outside commits. See [security boundaries](./SECURITY-HARDENING.md) and the
[agent integration guide](./docs/agent-integration.md) for operational responsibilities and examples.
