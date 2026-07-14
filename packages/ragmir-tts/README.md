# Ragmir TTS

[![npm version](https://img.shields.io/npm/v/@jcode.labs/ragmir-tts)](https://www.npmjs.com/package/@jcode.labs/ragmir-tts)
[![npm downloads](https://img.shields.io/npm/dm/@jcode.labs/ragmir-tts)](https://www.npmjs.com/package/@jcode.labs/ragmir-tts)
[![Node.js](https://img.shields.io/node/v/@jcode.labs/ragmir-tts)](https://www.npmjs.com/package/@jcode.labs/ragmir-tts)
[![MIT](https://img.shields.io/npm/l/@jcode.labs/ragmir-tts)](https://github.com/jcode-works/jcode-ragmir/blob/main/LICENSE)

**Let your coding agent turn a cited brief into local audio.**

`@jcode.labs/ragmir-tts` renders text files through a typed Node.js API and the `rgr-tts` CLI. Its
default Transformers.js path produces WAV audio locally after the model is prepared. An explicit
Edge mode produces online neural-voice MP3 when sending narration text to that service is acceptable.

[Ragmir overview](https://github.com/jcode-works/jcode-ragmir#readme) ·
[Documentation](https://github.com/jcode-works/jcode-ragmir/wiki) ·
[Offline TTS guide](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/offline-tts-preload.md) ·
[Core package](https://www.npmjs.com/package/@jcode.labs/ragmir)

## Use it from Codex or another AI

Install Core and TTS in the repository that owns the source documents:

```bash
npm install --save-dev @jcode.labs/ragmir @jcode.labs/ragmir-tts
npx rgr setup --agents codex,claude,kimi,opencode,cline
npx rgr sources add "README.md" "docs/**/*.md"
npx rgr ingest
```

Then ask the selected agent to run a complete, reviewable workflow:

```text
Use Ragmir to research the release risks. Write a short cited brief to
.ragmir/reports/release-brief.md and wait for my review. Then run:
npx rgr audio .ragmir/reports/release-brief.md --offline --out .ragmir/audio/release-brief.wav
```

Core retrieves the evidence, the chosen AI or local consumer writes the brief, and TTS renders the
reviewed file. TTS never reads the repository or invents a summary by itself. A hosted AI receives
the passages it uses under that provider's data policy; choose a local consumer when that handoff
must stay on the workstation.

The same command fits a self-hosted n8n Execute Command node or a shell worker after the workflow
has written its reviewed text file. Use `--json` when the next node needs the output path and render
metadata. n8n Cloud does not provide the Execute Command node required to launch the local CLI.
Self-hosted n8n 2.x also disables that node by default, so enable it deliberately before using this
path.

## Choose the rendering path deliberately

| Path | Output | Languages | Network boundary |
| --- | --- | --- | --- |
| Transformers.js, default | WAV | English, Spanish, French | Model preload is explicit; rendering can then stay offline |
| Edge, explicit | MP3 | English, Spanish, French, Japanese, Thai, Chinese | Narration text is sent to the Edge service |

The package does not silently switch a normal Transformers.js render to Edge. Use the online path
only when the text is suitable for an external service.

## First offline WAV

Requires Node.js 20 or later. Prepare the local model once with non-sensitive text:

```bash
npm install --save-dev @jcode.labs/ragmir-tts
printf '%s\n' "Non-sensitive model preload text." > /tmp/ragmir-tts-preload.txt
npx rgr-tts render /tmp/ragmir-tts-preload.txt \
  --allow-remote-models \
  --out .ragmir/audio/preload.wav
```

Render confidential content afterwards without downloading anything:

```bash
npx rgr-tts render ./brief.md \
  --offline \
  --out .ragmir/audio/brief.wav
```

The model cache defaults to `.ragmir/models/tts` and generated audio to `.ragmir/audio`. Keep both
locations ignored by Git.

## Use it through Ragmir Core

Ragmir Core exposes the same local renderer as `rgr audio`:

```bash
npm install --save-dev @jcode.labs/ragmir @jcode.labs/ragmir-tts
npx rgr audio ./brief.md --offline --out .ragmir/audio/brief.wav
```

This path fits a retrieval workflow where a cited report or compact research note is written first,
reviewed, and then rendered as audio.

## TypeScript API

```ts
import { doctor, renderSpeech } from "@jcode.labs/ragmir-tts"

const runtime = await doctor()
console.log(runtime.transformersAvailable)

const result = await renderSpeech({
  textFile: "./brief.md",
  outputPath: ".ragmir/audio/brief.wav",
  engine: "transformers",
  language: "en",
  allowRemoteModels: false,
})

console.log(result.outputPath, result.samplingRate)
```

`renderSpeech` returns the output path, engine, language, format, model metadata, and sample details.
`doctor` reports local engine availability, defaults, supported languages, and model-cache state.

## Explicit online MP3

Install the external Edge CLI, then select the engine explicitly:

```bash
pipx install edge-tts
npx rgr-tts doctor
npx rgr-tts render ./public-announcement.md \
  --engine edge \
  --lang en \
  --out .ragmir/audio/public-announcement.mp3
```

Edge mode supports `--voice` and `--rate`. It creates a temporary working directory, invokes the
local `edge-tts` executable, and removes temporary files after rendering.

## CLI reference

| Command or option | Purpose |
| --- | --- |
| `rgr-tts doctor --json` | Inspect engines, languages, model paths, and dependencies |
| `rgr-tts render <file>` | Render with the default local Transformers.js engine |
| `--offline` | Require the local Transformers.js path and cached model |
| `--allow-remote-models` | Explicitly allow a model download for the current render |
| `--engine edge` | Select the online Edge MP3 path |
| `--lang <code>` | Select `en`, `es`, `fr`, `ja`, `th`, or `zh` where supported |
| `--json` | Return machine-readable render metadata |

## Privacy notes

- Offline rendering reads the text file and model on the current machine.
- Model downloads are disabled by default during normal rendering.
- Edge mode is an explicit external transfer of narration text.
- Generated audio may contain sensitive information even when the source text has been deleted.
- Neither engine provides a compliance certification or a substitute for content review.

## Further reading

- [Project documentation](https://github.com/jcode-works/jcode-ragmir/wiki)
- [Complete TypeScript API reference](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/api-reference.md#tts-reviewed-text-to-audio)
- [Offline TTS preparation](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/offline-tts-preload.md)
- [Ragmir configuration](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/configuration.md)
- [Troubleshooting](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/troubleshooting.md)
- [Ragmir Core on npm](https://www.npmjs.com/package/@jcode.labs/ragmir)
- [Ragmir Chat on npm](https://www.npmjs.com/package/@jcode.labs/ragmir-chat)

Ragmir TTS is open source under the [MIT License](https://github.com/jcode-works/jcode-ragmir/blob/main/LICENSE).
