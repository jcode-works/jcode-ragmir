# Security Policy

## Supported Versions

Only the latest published version of `@jcode.labs/mimir` receives security fixes.

## Reporting A Vulnerability

Please report vulnerabilities privately by email:

```plain text
contact@jcode.works
```

Do not open public issues for vulnerabilities, leaked secrets, credential exposure,
or private document disclosure.

## Data Boundary

Mimir is designed to index local project documents. Raw project documents,
`.kb/storage/`, environment files, and credentials must remain outside commits.
