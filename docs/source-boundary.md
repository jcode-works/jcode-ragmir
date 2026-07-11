# Source Boundary

Ragmir is a public MIT-licensed repository. Treat every tracked source file, package, workflow,
example, and document as visible, forkable, modifiable, and reusable by anyone under the MIT License.

This repository must never describe tracked source as proprietary, closed source, source-available,
or private-commercial code. If a file is committed here, the working assumption is simple: it is MIT
source.

## What Is Open Source Here

The repository intentionally contains:

- Ragmir Core: CLI, library, MCP server, bundled agent skills, and synthetic examples.
- Ragmir Chat: optional local cited chat package.
- Ragmir TTS: optional audio rendering package.
- Ragmir UI and landing source.
- The Tauri app shell source.
- Direct-download release tooling, checksum tooling, manifest tooling, and updater guards.
- The undeployed license webhook source and synthetic smoke tests.

The `private: true` flag in some `package.json` files means "not published to npm", not "private
source". It does not override the repository license.

## Third-Party Model Assets

Ragmir Chat source is part of the MIT repository. The Qwen2.5 and Gemma 4 model weights downloaded by
`rgr chat setup` are separate Apache-2.0 assets and are not part of the Ragmir source package. Each
manifest records the official Hugging Face source URL and the
license URL pinned for that model.

Keep each selected profile under ignored local state:

```plain text
.ragmir/models/chat/fast/
.ragmir/models/chat/quality/
.ragmir/models/chat/lite/
```

The local directory contains the GGUF and a generated integrity manifest with the model revision,
official source and license URLs, relative filename, exact byte size, and SHA-256. Neither the model
nor its manifest should be committed. The manifest must not contain an absolute project path.

The current local chat runtime is a desktop and CLI feature. Android support remains future work and
must not be inferred from the presence of the cross-platform app source.

## Commercial Distribution Boundary

Commercial value can exist around this open source code, but not as hidden proprietary source inside
this repository.

Good commercial boundaries for this repo:

- signed desktop/mobile builds;
- verified direct-download artifacts;
- support, onboarding, and maintenance;
- hosted payment and license delivery using secrets stored outside Git;
- optional service-level commitments around official builds.

Bad boundaries for this repo:

- claiming proprietary or closed-source status for a tracked package;
- storing business ledgers, prospect notes, order exports, customer files, or private pricing notes;
- relying on client-side license checks as a source-code protection boundary;
- committing real checkout, download, updater, webhook, or license secrets.

Local license validation can gate official signed builds, support, updates, and paid distribution
channels. It cannot prevent a user from forking MIT source code.

If Ragmir later needs truly proprietary source code, that code must live outside this MIT repository
or the licensing model must be changed deliberately before publication.

## Public-Repo Hygiene

Keep the public repository limited to:

- public product documentation;
- implementation details that are safe to inspect;
- synthetic fixtures and generated-free examples;
- security hardening guidance;
- release runbooks that use placeholder IDs and secret stores.

Keep outside Git:

- private documents and client corpora;
- `.ragmir/`, `.pid`, raw reports, audio files, vector stores, generated model manifests, GGUF files,
  and other generated local state;
- API keys, webhook secrets, signing keys, certificates, and environment files;
- customer names, emails, invoices, order exports, and support evidence;
- internal pricing tests, pre-sales ledgers, interview notes, and GO/NO-GO records.
