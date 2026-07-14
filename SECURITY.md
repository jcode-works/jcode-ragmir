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

Ragmir indexes selected project documents on the user's machine. The default `local-hash` path keeps
ingestion and retrieval offline, and Core does not upload the corpus to a hosted RAG service. A cloud
consumer can still receive returned passages when the user explicitly chooses that handoff.

Raw project documents, `.ragmir/`, environment files, credentials, and customer records must remain
outside commits.
