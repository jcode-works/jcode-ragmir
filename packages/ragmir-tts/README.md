# @jcode.labs/ragmir-tts

[![npm version](https://img.shields.io/npm/v/@jcode.labs/ragmir-tts)](https://www.npmjs.com/package/@jcode.labs/ragmir-tts)
[![npm downloads](https://img.shields.io/npm/dm/@jcode.labs/ragmir-tts)](https://www.npmjs.com/package/@jcode.labs/ragmir-tts)
[![Node.js](https://img.shields.io/node/v/@jcode.labs/ragmir-tts)](https://www.npmjs.com/package/@jcode.labs/ragmir-tts)
[![MIT](https://img.shields.io/npm/l/@jcode.labs/ragmir-tts)](https://github.com/jcode-works/jcode-ragmir/blob/main/LICENSE)

Optional text-to-speech for Ragmir workflows.

*Stop sending confidential documents directly to the cloud.*

The default Transformers.js path renders reviewed text as WAV on the workstation after an explicit
model preload. Edge MP3 is a separate online mode that sends narration text only when selected.

[Project overview](https://github.com/jcode-works/jcode-ragmir#readme) ·
[Offline TTS guide](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/offline-tts-preload.md) ·
[API reference](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/api-reference.md#tts-reviewed-text-to-audio)

## Prepare and render offline

Requires Node.js 20 or later. Preload the model once with non-sensitive text:

```bash
npm install --save-dev @jcode.labs/ragmir-tts
printf '%s\n' "Non-sensitive model preload text." > /tmp/ragmir-tts-preload.txt
npx rgr-tts render /tmp/ragmir-tts-preload.txt \
  --lang en \
  --allow-remote-models \
  --out .ragmir/audio/preload.wav
```

Then render confidential content without downloading anything:

```bash
npx rgr-tts render ./brief.md --lang en --offline --out .ragmir/audio/brief.wav
```

When Core is installed too, `npx rgr audio` delegates to the same package. TTS reads the text
provided by the caller; it does not retrieve evidence or write a summary.

## TypeScript API

```ts
import { renderSpeech } from "@jcode.labs/ragmir-tts"

const controller = new AbortController()
const result = await renderSpeech({
  cwd: process.cwd(),
  textFile: "./brief.md",
  outputPath: ".ragmir/audio/brief.wav",
  engine: "transformers",
  language: "en",
  allowRemoteModels: false,
  signal: controller.signal,
})

console.log(result.outputPath, result.samplingRate)
```

`renderSpeech` returns output, engine, language, format, model, and sample metadata. `doctor()`
reports local engine availability and model paths. Use `modelCacheExists()` for a direct cache
check. `signal` cancels between local render phases and terminates the Edge process; use
`edgeTimeoutMs` to shorten the Edge default of 120 seconds.

## Explicit online speech

Install the external Edge CLI and select the engine deliberately:

```bash
pipx install edge-tts
npx rgr-tts render ./public-announcement.md \
  --engine edge \
  --lang en \
  --out .ragmir/audio/public-announcement.mp3
```

| Path | Output | Languages | Network boundary |
| --- | --- | --- | --- |
| Transformers.js | WAV | English, Spanish, French | Model preload is explicit; rendering can then stay offline |
| Edge | MP3 | English, Spanish, French, Japanese, Thai, Chinese | Narration text is sent to the external service |

There is no silent fallback from local rendering to Edge. Keep model state and generated audio
under ignored `.ragmir/` paths, and review audio before sharing it because the output can preserve
sensitive information from the source text.

Read the [project documentation](https://github.com/jcode-works/jcode-ragmir/wiki),
[configuration guide](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/configuration.md),
and [troubleshooting guide](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/troubleshooting.md)
for the complete workflow.

Ragmir TTS is open source under the [MIT License](https://github.com/jcode-works/jcode-ragmir/blob/main/LICENSE).
