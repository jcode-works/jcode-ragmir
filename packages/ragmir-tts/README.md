# Ragmir TTS

`@jcode.labs/ragmir-tts` turns text files into speech. Its default path uses Transformers.js to
render local WAV audio, making it suitable for confidential summaries after the model has been
prepared. An explicit Edge MP3 mode is also available when sending narration text to that online
service is acceptable.

It can be used as a standalone Node.js package or as Ragmir Core's `rgr audio` add-on.

## Choose this package when you need

| Need | What TTS provides |
| --- | --- |
| Narrate a confidential report locally | Offline Transformers.js WAV rendering. |
| Preload a model before entering an air-gapped environment | An explicit one-time model download. |
| Produce an MP3 with an online neural voice | Explicit Edge mode, with a clear data boundary. |
| Add speech rendering to a Node.js workflow | The typed `renderSpeech()` API. |

For document retrieval, citations, and a project-oriented CLI, install
[Ragmir Core](https://www.npmjs.com/package/@jcode.labs/ragmir). For local cited answers before
narration, add [Ragmir Chat](https://www.npmjs.com/package/@jcode.labs/ragmir-chat).

## Quick start, offline WAV

Install the package and prepare the local model once with non-sensitive text:

```bash
npm install --save-dev @jcode.labs/ragmir-tts
printf '%s\n' "Non-sensitive model preload text." > /tmp/ragmir-tts-preload.txt
npx rgr-tts render /tmp/ragmir-tts-preload.txt --allow-remote-models --out .ragmir/audio/preload.wav
```

Render confidential content afterwards without downloading anything:

```bash
npx rgr-tts render ./brief.md --offline --out .ragmir/audio/brief.wav
```

The local model is stored under `.ragmir/models/tts`; generated audio defaults to `.ragmir/audio`.
Both locations are local state and should remain ignored by Git.

## Use it through Ragmir Core

```bash
npm install --save-dev @jcode.labs/ragmir @jcode.labs/ragmir-tts
npx rgr audio ./brief.md --offline --out .ragmir/audio/brief.wav
```

This is useful for turning an indexed project brief or a retrieved research note into a local audio
summary.

## Explicit online MP3 mode

```bash
npx rgr-tts render ./brief.md --engine edge --out .ragmir/audio/brief.mp3
```

This mode sends the narration text to Edge. Use it only when that external transfer is appropriate
for the text. The default local WAV path does not use Edge.

## TypeScript API

```ts
import { renderSpeech } from "@jcode.labs/ragmir-tts"

const result = await renderSpeech({
  textFile: "./brief.md",
  outputPath: ".ragmir/audio/brief.wav",
  engine: "transformers",
  allowRemoteModels: false,
})

console.log(result.outputPath)
```

Use `doctor()` to inspect the local runtime and available engines. Offline models support English,
Spanish, and French; the explicit Edge path also supports Japanese, Thai, and Chinese.

## Further reading

- [Ragmir overview and package comparison](https://github.com/jcode-works/jcode-ragmir#readme)
- [Offline TTS preparation](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/offline-tts-preload.md)
- [Configuration and privacy](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/configuration.md)
- [Troubleshooting](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/troubleshooting.md)

Ragmir TTS is open source under the [MIT License](https://github.com/jcode-works/jcode-ragmir/blob/main/LICENSE).
