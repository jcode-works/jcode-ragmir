# @jcode.labs/ragmir-tts

[![npm version](https://img.shields.io/npm/v/@jcode.labs/ragmir-tts)](https://www.npmjs.com/package/@jcode.labs/ragmir-tts)
[![npm downloads](https://img.shields.io/npm/dm/@jcode.labs/ragmir-tts)](https://www.npmjs.com/package/@jcode.labs/ragmir-tts)
[![Node.js](https://img.shields.io/node/v/@jcode.labs/ragmir-tts)](https://www.npmjs.com/package/@jcode.labs/ragmir-tts)
[![AGPL-3.0](https://img.shields.io/npm/l/@jcode.labs/ragmir-tts)](https://github.com/jcode-works/jcode-ragmir/blob/main/LICENSE)

Optional text-to-speech for Ragmir workflows. The default Transformers.js path renders reviewed
text as WAV on the workstation after an explicit model preload. Edge MP3 is a separate online mode
that sends narration text only when selected.

[Project overview](https://github.com/jcode-works/jcode-ragmir#readme) ·
[Offline TTS guide](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/offline-tts-preload.md) ·
[API](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/api-reference.md#tts-reviewed-text-to-audio)

## Preload once, render offline

Requires Node.js 22 or later. Preload with non-sensitive text:

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
npm install --save-dev @jcode.labs/ragmir-tts
printf '%s\n' "Non-sensitive model preload text." > /tmp/ragmir-tts-preload.txt
npx rgr-tts render /tmp/ragmir-tts-preload.txt \
  --lang en \
  --allow-remote-models \
  --out .ragmir/audio/preload.wav
```

Then render confidential content without a network call:

```bash
npx rgr-tts render ./brief.md --lang en --offline --out .ragmir/audio/brief.wav
```

When Core is installed, `npx rgr audio` delegates to this package. TTS reads caller-provided text;
it does not retrieve evidence or write a summary.

| Code | Language | Offline model |
| --- | --- | --- |
| `en` | English | `Xenova/mms-tts-eng` |
| `fr` | French | `Xenova/mms-tts-fra` |
| `es` | Spanish | `Xenova/mms-tts-spa` |

Use the same language for preload and offline rendering. French is selected only when `--lang` is
omitted. `rgr-tts doctor --json` reports local and Edge language support. Japanese, Thai, and
Chinese require explicit Edge mode unless you provide a compatible Transformers.js model.

## TypeScript API

```ts
import { renderSpeech } from "@jcode.labs/ragmir-tts"

const result = await renderSpeech({
  cwd: process.cwd(),
  textFile: "./brief.md",
  outputPath: ".ragmir/audio/brief.wav",
  engine: "transformers",
  language: "en",
  allowRemoteModels: false,
})

console.log(result.outputPath, result.samplingRate)
```

`renderSpeech` returns output, engine, language, format, model, and sample metadata. It accepts an
`AbortSignal`; Edge calls also accept `edgeTimeoutMs`. Use `doctor()` for engine and model paths and
`modelCacheExists()` for a direct cache check.

## Explicit online speech

```bash
pipx install edge-tts
npx rgr-tts render ./public-announcement.md \
  --engine edge \
  --lang en \
  --out .ragmir/audio/public-announcement.mp3
```

| Path | Output | Languages | Boundary |
| --- | --- | --- | --- |
| Transformers.js | WAV | English, French, Spanish | Model preload is explicit; rendering can stay offline |
| Edge | MP3 | English, Spanish, French, Japanese, Thai, Chinese | Narration text goes to the external service |

There is no silent fallback to Edge. Keep model state and generated audio under ignored `.ragmir/`
paths and review audio before sharing it.

Ragmir TTS is open source under
[AGPL-3.0-only](https://github.com/jcode-works/jcode-ragmir/blob/main/LICENSE). A separate
[commercial license](https://github.com/jcode-works/jcode-ragmir/blob/main/COMMERCIAL-LICENSE.md)
is available for proprietary use.
