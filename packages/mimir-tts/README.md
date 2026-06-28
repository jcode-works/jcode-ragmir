# Mimir TTS

Plug-and-play local text-to-speech for Mimir audio summaries.

`@jcode.labs/mimir-tts` renders narration text to WAV with Transformers.js. It does not require
Python, ffmpeg, Piper, XTTS, or a local server. The first render can download a public ONNX model
from Hugging Face into `.mimir/models/tts`; the source text is processed locally.

## Install

```bash
pnpm add -D @jcode.labs/mimir-tts
```

## Render

```bash
pnpm exec mimir-tts render /tmp/MIMIR-SUMMARY-tax.txt --out .mimir/audio/tax-summary.wav
```

For offline or air-gapped use, preload the model files and run:

```bash
pnpm exec mimir-tts render summary.txt --offline --model-path .mimir/models/tts
```

## Doctor

```bash
pnpm exec mimir-tts doctor --json
```

The default model is `Xenova/mms-tts-fra`. Override it with `--model` or `MIMIR_TTS_MODEL`.
