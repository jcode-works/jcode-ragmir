# @jcode.labs/ragmir

[![npm version](https://img.shields.io/npm/v/@jcode.labs/ragmir)](https://www.npmjs.com/package/@jcode.labs/ragmir)
[![npm downloads](https://img.shields.io/npm/dm/@jcode.labs/ragmir)](https://www.npmjs.com/package/@jcode.labs/ragmir)
[![Node.js](https://img.shields.io/node/v/@jcode.labs/ragmir)](https://www.npmjs.com/package/@jcode.labs/ragmir)
[![AGPL-3.0](https://img.shields.io/npm/l/@jcode.labs/ragmir)](https://github.com/jcode-works/jcode-ragmir/blob/main/LICENSE)

Confidential local RAG for coding agents and Node.js applications. Core indexes the project files
you choose and retrieves bounded, cited evidence offline by default. It uploads no corpus, calls no
LLM, and opens no HTTP port.

[Project overview](https://github.com/jcode-works/jcode-ragmir#readme) ·
[CLI](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/cli-reference.md) ·
[API](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/api-reference.md) ·
[Agent integration](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/agent-integration.md)

## Install and retrieve

Requires Node.js 22 or later.

<!-- ragmir-setup-prompt:start -->
<details>
<summary><strong>Option 1: paste this into your coding agent</strong></summary>

~~~text
Set up Ragmir in this repository. Work interactively: inspect first, infer safe defaults, present a proposal, wait for approval, then execute. Never assume consent for dependency changes, model downloads, replacing skills, or sharing data.

Outcome: Core installed with the repository's package manager; useful sources selected; secrets and generated noise excluded; tools connected; cited retrieval verified. Semantic retrieval, team features, Chat, and TTS are optional.

1. Inspect without changes:
- Find the repository or monorepo root. Read package.json packageManager, lockfiles, workspace and Node/version-manager files, .gitignore, existing .ragmir state, README, AGENTS/CLAUDE/CODEX guidance, docs, specs/ADRs, apps/packages, important config, source, and tests.
- Detect Node 22+ and pnpm, npm, Yarn, or Bun. Prefer packageManager, then the lockfile. Respect workspace-root flags and mise/asdf/Volta. Never create a second lockfile. If signals conflict, ask.
- If Ragmir exists, inspect its version, config, status, sources, and rgr upgrade --check before changing it.

2. Propose one setup summary, then ask once:
- Infer the owning base and useful clients from the repository. State any nested bases you propose.
- Default to offline local-hash and Core only, or optional Chat only when requested. Optional TTS stays off unless requested. Semantic, Chat, and TTS downloads require explicit approval; Edge text transfer requires separate approval.
- Default to solo unless the repository or request shows a team workflow. For a Git-backed team, propose the current upstream as authority and safe automatic pulls; offer --no-pull when Git updates must stay manual.
- List selected source globs, exclusions, any external/private folder, and the exact package, config, skill, and download actions you would perform.
- Ask only about unresolved choices that materially change source authority, data exposure, downloads, or external execution. Wait for one approval covering the proposal.

3. Implement after approval:
- Install @jcode.labs/ragmir as a dev dependency with the detected manager. Install Chat/TTS only if selected, at a compatible version.
- Run the matching rgr setup --no-ingest --agents <selected> command. Keep project scope. If a same-name skill is unmanaged, show the diff and ask before --force.
- Build a narrow .ragmir/config.json. Prefer stable relative globs for root guidance, docs/specs/ADRs, package READMEs/manifests, useful app config, and source/tests that explain behavior. Include locales only when useful.
- Exclude .env*, credentials, keys, unapproved dumps/customer data, dependencies, generated/build/cache/coverage/log folders, vendored code, binaries/media, and .ragmir storage/models. In monorepos, keep nested bases scoped and shared knowledge at root.
- Run preview and audit --unsupported before ingest. Review redactions, unsupported/oversized files, duplicates, chunks, and sensitive paths. Fix config first, then ingest.
- For an existing install, use rgr upgrade and doctor --fix as indicated. Never delete the active index first. Rebuild only for incompatible embedding, chunk, or index-policy changes.
- Enable semantic retrieval, preload Chat, or preload TTS only after consent. Use non-sensitive TTS preload text.
- For Git teams, run rgr team sync. It safely pulls and ingests; --no-pull keeps Git manual. Snapshots are advanced diagnostics.

4. Prove the result:
- Run rgr doctor --deep, rgr audit --unsupported, and rgr security-audit.
- Run representative searches with citations and --explain. Create a small local golden suite for project questions and run rgr evaluate; do not weaken gates to pass.
- Report detected tools, answers, packages, downloads, config/sources/exclusions, changed files, readiness, retrieval results, team status, and exact remaining actions.

Never commit .ragmir, corpus files, models, snapshots, logs, or secrets. Never claim offline, semantic, team synchronization, or retrieval quality without evidence.
~~~

</details>
<!-- ragmir-setup-prompt:end -->

Prefer manual setup:

```bash
npm install --save-dev @jcode.labs/ragmir
npx rgr setup --agents codex,claude,kimi,opencode,cline
npx rgr sources add "README.md" "docs/**/*.md"
npx rgr ingest
npx rgr search "Which decision changed the rollout?"
```

Generated configuration, indexes, helpers, reports, and metadata-only logs stay under ignored
`.ragmir/` state. Ingestion is incremental, resumable, bounded by source, chunk, vector, file, batch,
and concurrency windows, and serialized across local writer processes.

## Choose an interface

| Interface | Use it for |
| --- | --- |
| `rgr` CLI | Setup, ingest, search, audit, maintenance, and JSON automation |
| TypeScript API | Typed retrieval in scripts and long-running Node.js workers |
| Local stdio MCP | Up to three compact citations by default, with targeted expansion |

Export a frozen folder for another agent, automation, or server:

```bash
npx rgr portable export --output ../operations-knowledge
npx rgr portable export --output ../operations-knowledge --replace
cd ../operations-knowledge
node bin/rgr.cjs portable verify . --json
node bin/configure.cjs generic
```

The bundle contains the active index, required local embedding model, embedded read-only runtime,
two portable skills, MCP adapters, and a SHA-256 inventory. It needs Node.js 22 and the platform
recorded in `manifest.json`, but no package-manager install or registry access after transfer. It
excludes raw sources and logs, but its indexed passages remain sensitive. See the
[portable knowledge-base guide](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/portable-knowledge-bases.md).
`--replace` preserves an existing portable destination as a timestamped sibling before activating
the newly verified export, so a failed activation can roll back without deleting the last bundle.

The default `local-hash` provider works offline with no model download. Enable semantic
Transformers.js embeddings explicitly with `rgr setup --semantic`, then rebuild. Core remains
retrieval-only in both modes. Use `explain: true` or `--explain` to inspect lexical and vector
contributions, fallback decisions, budgets, queue wait, and the active ranking policy.

## TypeScript API

```ts
import { createRagmirClient } from "@jcode.labs/ragmir"

const ragmir = await createRagmirClient({ cwd: process.cwd() })
try {
  await ragmir.ingest({ timeoutMs: 120_000 })
  const results = await ragmir.search("Which decision changed the rollout?", {
    topK: 5,
    timeoutMs: 10_000,
  })

  for (const result of results) console.log(result.citation, result.text)
} finally {
  await ragmir.close()
}
```

Reuse one client per project root in a long-running process. It owns the local connection, read
snapshot, active operation lifecycle, metadata-only log flush, and optional embedding-model lease.
Top-level `ingest`, `search`, `ask`, and `research` functions remain available for one-shot scripts.
`ask` returns cited context, not generated prose.

## Guarantees and boundaries

- Citations use source lines only for line-preserving text, plus PDF pages, PPTX slides, XLSX
  sheets and cells, and EPUB spine positions.
- Rebuilds activate only after row and manifest validation. Interrupted rebuilds leave the previous
  searchable generation active.
- Exact vector search remains the policy below 100,000 rows. Larger tables use quality-gated IVF-PQ
  with complete coverage and an exact diagnostic mode.
- Search, embedding, and ingestion use independent bounded queues. Overload and queue deadlines are
  stable retryable errors.
- Optional OCR processes only blank PDF pages through a configured local executable and private
  resumable cache.
- `rgr status` and normal `rgr doctor` read compact manifest health. Use `rgr doctor --deep` or
  `rgr audit` for a live source inventory.
- MCP search, ask, and research return up to three compact citations by default. Expand one citation
  with `ragmir_expand`; research may add up to three code matches. Request `compact: false` only for
  an explicit full payload.
- `rgr security-audit` checks permissions, Git ignore coverage, tracked private paths, redaction,
  and local extractor authority.
- `rgr team sync` safely fast-forwards the current Git upstream and refreshes the private local
  index in one step. `--no-pull` disables branch updates. Advanced snapshot comparison remains
  available for exact or non-Git drift diagnostics, including existing v2.19 snapshots.
- After a package update, `rgr upgrade --check` previews compatibility; `rgr upgrade` safely stages
  any required rebuild without deleting the active index first. Privacy warnings remain visible as
  non-blocking advisories and can be handled separately with `rgr security-audit`.

The [CLI reference](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/cli-reference.md),
[API reference](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/api-reference.md), and
[configuration guide](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/configuration.md)
hold the complete options and operational detail.

## Optional packages

- [`@jcode.labs/ragmir-chat`](https://www.npmjs.com/package/@jcode.labs/ragmir-chat) adds cited
  answer generation with a verified local GGUF profile.
- [`@jcode.labs/ragmir-tts`](https://www.npmjs.com/package/@jcode.labs/ragmir-tts) renders reviewed
  text as local audio or explicit online speech.

Core installs and starts without either add-on. A hosted agent receives only passages your
integration sends under that provider's data policy; use a local consumer when no passage may leave
the workstation. Git-backed teams run `rgr team sync` after reviewed changes merge upstream; safe
fast-forwards and incremental local ingestion happen together. Advanced snapshot comparison
remains available for exact or non-Git drift. See the [team workflow](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/agent-integration.md#team-knowledge-bases).

Ragmir Core is open source under
[AGPL-3.0-only](https://github.com/jcode-works/jcode-ragmir/blob/main/LICENSE). A separate
[commercial license](https://github.com/jcode-works/jcode-ragmir/blob/main/COMMERCIAL-LICENSE.md)
is available for proprietary use.
