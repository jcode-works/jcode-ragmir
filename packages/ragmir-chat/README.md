# @jcode.labs/ragmir-chat

[![npm version](https://img.shields.io/npm/v/@jcode.labs/ragmir-chat)](https://www.npmjs.com/package/@jcode.labs/ragmir-chat)
[![npm downloads](https://img.shields.io/npm/dm/@jcode.labs/ragmir-chat)](https://www.npmjs.com/package/@jcode.labs/ragmir-chat)
[![Node.js](https://img.shields.io/node/v/@jcode.labs/ragmir-chat)](https://www.npmjs.com/package/@jcode.labs/ragmir-chat)
[![MIT](https://img.shields.io/npm/l/@jcode.labs/ragmir-chat)](https://github.com/jcode-works/jcode-ragmir/blob/main/LICENSE)

Optional cited answer generation with a verified local GGUF model. Ragmir Chat accepts passages
retrieved by Core, generates on the workstation, and validates visible citation markers. It does
not discover or index project files.

[Project overview](https://github.com/jcode-works/jcode-ragmir#readme) ·
[Offline Chat guide](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/offline-chat-preload.md) ·
[API](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/api-reference.md#chat-cited-local-generation)

## Set up and answer

Requires Node.js 22 or later and enough disk and memory for the selected model.

<!-- ragmir-setup-prompt:start -->
<details>
<summary><strong>Option 1: paste this into your coding agent</strong></summary>

~~~text
Set up Ragmir in this repository. Work interactively: inspect first, ask one concise numbered batch of questions, wait for my answers, then execute. Never assume consent for dependency changes, model downloads, replacing skills, or sharing data.

Outcome: Core installed with the repository's package manager; useful sources selected; secrets and generated noise excluded; tools connected; cited retrieval verified. Semantic retrieval, team features, Chat, and TTS are optional.

1. Inspect without changes:
- Find the repository or monorepo root. Read package.json packageManager, lockfiles, workspace and Node/version-manager files, .gitignore, existing .ragmir state, README, AGENTS/CLAUDE/CODEX guidance, docs, specs/ADRs, apps/packages, important config, source, and tests.
- Detect Node 22+ and pnpm, npm, Yarn, or Bun. Prefer packageManager, then the lockfile. Respect workspace-root flags and mise/asdf/Volta. Never create a second lockfile. If signals conflict, ask.
- If Ragmir exists, inspect its version, config, status, sources, and rgr upgrade --check before changing it.

2. Ask only what the repository did not answer, then wait:
1) Which repository/monorepo base should own the knowledge base, and are nested app bases wanted?
2) Which clients: Claude Code, Codex, Kimi, OpenCode, Cline, another MCP client, or none?
3) Keep default offline local-hash, or allow one semantic-model download for better natural-language retrieval?
4) Solo or team use? If team, what Git/Drive/folder revision is authoritative and who may receive metadata-only snapshots?
5) Core only, or optional Chat? For Chat choose lite (~0.49 GB), fast (~3.35 GB), or quality (~5.15 GB).
6) Optional TTS? Ask language (en/fr/es offline; ja/th/zh require explicit Edge unless a local model is supplied) and whether text may reach Edge.
7) Which private/external folders are allowed, which must never be indexed, and may I install packages, edit local config, and run approved downloads now?

3. Implement after approval:
- Install @jcode.labs/ragmir as a dev dependency with the detected manager. Install Chat/TTS only if selected, at a compatible version.
- Run the matching rgr setup --no-ingest --agents <selected> command. Keep project scope. If a same-name skill is unmanaged, show the diff and ask before --force.
- Build a narrow .ragmir/config.json. Prefer stable relative globs for root guidance, docs/specs/ADRs, package READMEs/manifests, useful app config, and source/tests that explain behavior. Include locales only when useful.
- Exclude .env*, credentials, keys, unapproved dumps/customer data, dependencies, generated/build/cache/coverage/log folders, vendored code, binaries/media, and .ragmir storage/models. In monorepos, keep nested bases scoped and shared knowledge at root.
- Run preview and audit --unsupported before ingest. Review redactions, unsupported/oversized files, duplicates, chunks, and sensitive paths. Fix config first, then ingest.
- For an existing install, use rgr upgrade and doctor --fix as indicated. Never delete the active index first. Rebuild only for incompatible embedding, chunk, or index-policy changes.
- Enable semantic retrieval, preload Chat, or preload TTS only after consent. Use non-sensitive TTS preload text.
- For teams, ingest locally, create an ignored metadata-only snapshot, compare it, explain every drift, and never choose authority automatically.

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
npm install --save-dev @jcode.labs/ragmir @jcode.labs/ragmir-chat
npx rgr setup
npx rgr sources add "README.md" "docs/**/*.md"
npx rgr ingest
npx rgr chat setup --profile fast
npx rgr chat "What evidence supports this decision?" --profile fast --offline
```

Setup downloads and verifies one model under `.ragmir/models/chat/<profile>`. Normal generation
uses that local file and rejects remote model resolution.

| Profile | Pinned model | Download | Choose it when |
| --- | --- | --- | --- |
| `lite` | Qwen2.5 0.5B Q4_K_M | about 0.49 GB | Memory and startup matter most; thinking stays off |
| `fast` | Gemma 4 E2B Q4_0 | about 3.35 GB | You want the balanced default |
| `quality` | Gemma 4 E4B Q4_0 | about 5.15 GB | You accept a larger model for stronger answers |

Use the same profile for setup, doctor, and generation. These are Chat profiles, not requirements
of Ragmir Core, its CLI, API, or MCP server. Verify offline readiness with
`npx rgr chat doctor --profile fast --verify`.

## TypeScript API

```ts
import { generateChatAnswer, setupChatModel } from "@jcode.labs/ragmir-chat"

await setupChatModel({ profile: "lite" })

const result = await generateChatAnswer({
  question: "What changed in the rollout?",
  profile: "lite",
  sources: [
    {
      relativePath: "docs/rollout.md",
      chunkIndex: 0,
      text: "The rollout moved from Friday to Monday after the review.",
    },
  ],
})

console.log(result.answer, result.citationStatus)
```

No usable source returns an insufficient-context result without loading a model. Results include
citation validity and model metadata; raw model thought is never returned or persisted. Human
review remains necessary for high-impact decisions. Applications with another retrieval layer can
use `rgr-chat answer --context <file>`; `rgr-chat serve` is a local line-delimited JSON process, not
an HTTP server.

Model setup may download public weights, never project documents. Normal generation sends retrieved
passages only to the local model process. Keep models and outputs under ignored `.ragmir/` paths.

Ragmir Chat is open source under the [MIT License](https://github.com/jcode-works/jcode-ragmir/blob/main/LICENSE).
Selected GGUF models keep their own pinned license metadata.
