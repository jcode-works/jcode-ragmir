# Ragmir TTS Add-On

`@jcode.labs/ragmir-tts` is the standalone text-to-speech add-on used by Ragmir audio summaries.
It gives Ragmir a plug-and-play narration renderer without making audio generation part of the core
RAG pipeline.

**Full documentation:** https://github.com/jcode-works/jcode-ragmir#readme

This npm README is intentionally short because package READMEs are displayed separately on npm. The
GitHub root README is the canonical product documentation.

## What It Does

The package renders text files into local audio files for briefings, study notes, project summaries,
or agent-generated narration.

It supports two explicit paths:

- Transformers.js WAV for offline or confidential content. This is the default path.
- Edge TTS MP3 for higher-quality online narration when sending the text to Edge TTS is acceptable.

It does not require Python, ffmpeg, Piper, XTTS, or a local model server for the default
Transformers.js path. Remote model downloads are disabled by default; use `--allow-remote-models`
only for an explicit non-sensitive preload.

## Install

```bash
npm install --save-dev @jcode.labs/ragmir-tts
```

## Quick Start

```bash
npx rgr-tts doctor --json
npx rgr-tts render /tmp/summary.txt --offline --out .ragmir/audio/summary.wav
npx rgr-tts render /tmp/summary.txt --engine edge --out .ragmir/audio/summary.mp3
```

The default engine is `transformers` for offline/confidential WAV output. Use `--engine edge` only
when sending narration text to online Edge TTS is acceptable.

Use `--lang en|es|fr|ja|th|zh` to select the spoken language. English, Spanish, and French have
default offline Transformers.js models; Japanese, Thai, and Mandarin Chinese use Edge voices unless
you pass a compatible offline model with `--model`.

For first-time setup, preload the Transformers.js model with non-sensitive text and
`--allow-remote-models` before rendering confidential narration. See the root
`docs/offline-tts-preload.md` guide.

## License

MIT (c) Jean-Baptiste Thery.
