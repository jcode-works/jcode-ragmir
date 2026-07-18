# @jcode.labs/ragmir-tts

[![npm version](https://img.shields.io/npm/v/@jcode.labs/ragmir-tts)](https://www.npmjs.com/package/@jcode.labs/ragmir-tts)
[![npm downloads](https://img.shields.io/npm/dm/@jcode.labs/ragmir-tts)](https://www.npmjs.com/package/@jcode.labs/ragmir-tts)
[![Node.js](https://img.shields.io/node/v/@jcode.labs/ragmir-tts)](https://www.npmjs.com/package/@jcode.labs/ragmir-tts)
[![MIT](https://img.shields.io/npm/l/@jcode.labs/ragmir-tts)](https://github.com/jcode-works/jcode-ragmir/blob/main/LICENSE)

Optional text-to-speech for Ragmir workflows. The default Transformers.js path renders reviewed
text as WAV on the workstation after an explicit model preload. Edge MP3 is a separate online mode
that sends narration text only when selected.

[Project overview](https://github.com/jcode-works/jcode-ragmir#readme) ·
[Offline TTS guide](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/offline-tts-preload.md) ·
[API](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/api-reference.md#tts-reviewed-text-to-audio)

## Preload once, render offline

Requires Node.js 22 or later. Preload with non-sensitive text:

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

Ragmir TTS is open source under the [MIT License](https://github.com/jcode-works/jcode-ragmir/blob/main/LICENSE).
