# Portable knowledge bases

A portable Ragmir knowledge base is one frozen directory that can be moved to another machine and
queried by a compatible agent, automation, or server. It is designed for cited retrieval when the
destination should not receive the original source tree.

It is not a ZIP format, a hosted Ragmir service, a writable shared index, or a permission system.
The folder supplies evidence. The destination host owns authentication, authorization, network
exposure, tool permissions, and approval of external actions.

## What the folder contains

| Path | Purpose |
| --- | --- |
| `manifest.json` | Export identity, frozen time, index metadata, and SHA-256 inventory. |
| `.ragmir/config.json` | Relocatable retrieval configuration with logs, sources, remote models, and extractors disabled. |
| `.ragmir/storage/` | The active LanceDB table and required index manifest state only. |
| `.ragmir/models/` | Required local embedding model when the source index uses Transformers. |
| `bin/rgr.cjs` | Relocatable launcher restricted to retrieval, status, verification, and MCP. |
| `bin/configure.cjs` | Destination-aware MCP configuration generator. |
| `skills/ragmir-portable/` | Frozen, cited retrieval instructions. |
| `skills/ragmir-decision-evidence/` | Evidence, inference, unknown, and authority separation. |
| `adapters/` | Generic and dedicated MCP templates. |
| `runtime/` | Embedded read-only Ragmir runtime and its platform-native retrieval dependencies. |
| `package.json` | Bundle descriptor and Node.js requirement. |

Raw source files and access logs are excluded. The vector table includes indexed text, citations,
and relative source coordinates, so the complete folder is still confidential data.

## Export

First prove the active source index is current and safe:

```bash
rgr doctor
rgr search "known project decision" --compact
```

Then export to the default timestamped directory under `.ragmir/exports/`:

```bash
rgr portable export
```

Or choose a new destination and display name:

```bash
rgr portable export \
  --output ../operations-knowledge \
  --name "Operations knowledge"
```

To update a stable destination that already contains a portable bundle:

```bash
rgr portable export --output ../operations-knowledge --replace
```

Without `--replace`, the exporter never overwrites a destination. With it, Ragmir accepts only an
existing directory that identifies itself as a Ragmir portable bundle. It builds and verifies the
new folder first, renames the prior destination to a timestamped sibling, then activates the new
folder at the stable path. If activation fails, Ragmir attempts to restore the prior directory. The
previous bundle is never deleted and its path is returned as `previousOutputDir`.

Export refuses an empty, stale, incomplete, or security-warning index. It also refuses configured
PDF OCR, image OCR, or legacy Word commands: their executable paths and authority are
machine-specific and must not silently travel with a knowledge base.

Inside the source project, only the private `.ragmir/exports/` directory is accepted. This prevents
indexed passages from being committed or ingested accidentally. Choose a destination outside the
project for every other custom export path.

Export holds the existing local writer lock while it copies the active table and required manifest
state. It omits inactive generations, ingestion journals, source fingerprints, writer locks,
generation leases, previous manifests, and access logs. A Transformers index includes its configured
local model directory; local-hash needs no model.

The exporter writes to a private sibling staging directory, computes SHA-256 for every managed file,
opens the copied table, checks its row count and compatibility, then renames the verified staging
directory into place. A failed export removes only its generated staging directory.

## Move and verify

Move the complete directory without changing its internal layout. The destination needs Node.js 22
or later and the same operating system and CPU architecture recorded in `manifest.json`. The
read-only runtime and its native retrieval dependencies are already embedded, so no `npm install`,
registry access, or source project is needed after transfer:

```bash
cd /srv/operations-knowledge
node bin/rgr.cjs portable verify . --json
```

When the destination platform differs, create the export on a matching machine instead. The
embedding model itself never downloads remotely from the portable configuration.

For a fleet with macOS and Linux hosts, publish one bundle per platform and give each host the
matching folder. The native runtime is deliberately preferred to a WASM fallback because it keeps
the verified LanceDB and ONNX retrieval path used by the source index.

Verification checks:

- manifest schema and safe relative paths;
- every managed file size and SHA-256;
- frozen source, log, extractor, and remote-model settings;
- corpus fingerprint and index policy compatibility;
- active LanceDB table readability and row count;
- destination platform and architecture, rejected when they differ from the embedded runtime.

The SHA-256 inventory detects changed managed files but does not authenticate the publisher. Move
the folder through a trusted channel or sign the artifact with the operator's existing release
system when provenance must be proved.

Run at least one representative search on a new platform before using the bundle in a decision:

```bash
node bin/rgr.cjs search "Which approval is required?" --compact --json
```

## Connect an agent or automation

The templates under `adapters/` contain `<PORTABLE_ROOT>` and are safe to move. Generate an exact
configuration after placement instead of editing the placeholder manually:

```bash
node bin/configure.cjs --list
node bin/configure.cjs openclaw
node bin/configure.cjs claude
node bin/configure.cjs codex
node bin/configure.cjs kimi
node bin/configure.cjs opencode
node bin/configure.cjs cline
node bin/configure.cjs generic
```

Copy the output into a trusted configuration layer for the target. Claude, Codex, Kimi, OpenCode,
and Cline have dedicated shapes. Use `generic` for a local stdio MCP client.

Claude Code can register its generated server object directly:

```bash
claude mcp add-json --scope local ragmir "$(node bin/configure.cjs claude)"
```

For Codex, copy the generated TOML into a trusted `config.toml` layer. Pass the generated Kimi JSON
with `kimi --mcp-config-file`, and merge the OpenCode or Cline output into the corresponding trusted
MCP configuration.

OpenClaw and Hermes are supported through their selected runtime's MCP bridge when it accepts a
local stdio server. For OpenClaw, register the dedicated read-only configuration and probe it before
giving the agent a task:

```bash
openclaw mcp set ragmir "$(node bin/configure.cjs openclaw)"
openclaw mcp doctor ragmir --probe
```

This configuration allows only the five read-only Ragmir retrieval tools. n8n, CI jobs, and custom
services can use the same MCP process or invoke the restricted CLI with a safe argument array. These
are protocol-level integrations, not claims that Ragmir owns each tool's configuration or network
transport.

Ragmir opens no HTTP port. If a host exposes MCP or retrieval over a network, that host must provide
transport security, authentication, authorization, rate limits, tenant isolation, logging policy,
and secret management.

## Decision support without action authority

Load `skills/ragmir-decision-evidence` when an agent must choose between options. The skill requires
multiple focused retrievals and a compact decision record that separates:

1. cited evidence;
2. inference;
3. unknowns and missing documents;
4. the chosen option;
5. action authority and required approval.

The knowledge base never grants permission to deploy, delete, send, purchase, publish, or change an
external system. An agent or automation must apply its own policy and approval rules after using
Ragmir evidence.

## Frozen lifecycle

The launcher permits `search`, `ask`, `status`, `doctor`, `route-prompt`, `serve-mcp`, and `portable
verify`. It rejects ingest, setup, repair, upgrade, source, storage, OCR, and deletion commands. Its
MCP server exposes only `ragmir_status`, `ragmir_route_prompt`, `ragmir_search`, `ragmir_ask`, and
`ragmir_expand`.

When source knowledge changes and the destination is directly writable, run `portable export` with
the same `--output` and `--replace`. Verify the stable path, restart long-running consumers so they
open the new index, run a representative query, then retire `previousOutputDir` according to the
operator's retention policy.

For a remote destination that the exporter cannot write directly:

1. export and transfer the new folder beside the active folder under a temporary name;
2. verify the transferred folder and run a representative query;
3. stop or drain long-running consumers;
4. rename the active folder to a timestamped backup, then rename the new folder to the stable path;
5. restart consumers and verify the stable path again;
6. retire the backup only after the new bundle is proven and the retention policy allows it.

Do not delete the active folder before the replacement is ready. Do not write two hosts into one
shared index and do not treat a portable export as team synchronization.

## TypeScript automation

```ts
import {
  exportPortableKnowledgeBase,
  verifyPortableKnowledgeBase,
} from "@jcode.labs/ragmir"

const exported = await exportPortableKnowledgeBase({
  cwd: process.cwd(),
  outputDir: "../operations-knowledge",
  name: "Operations knowledge",
  replaceExisting: true,
})

const verification = await verifyPortableKnowledgeBase(exported.outputDir)
if (!verification.valid) throw new Error(verification.errors.join("\n"))
```

The exported API also includes `portableKnowledgeBaseManifestSchema` for trusted tooling that needs
to parse the manifest contract.
