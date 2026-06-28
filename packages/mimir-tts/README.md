# Mimir TTS Package

`@jcode.labs/mimir-tts` is the standalone text-to-speech package used by Mimir audio summaries.
It gives Mimir a plug-and-play narration renderer without making audio generation part of the core
RAG pipeline.

**Full documentation:** https://github.com/jcode-works/jcode-mimir#readme

This npm README is intentionally short because package READMEs are displayed separately on npm. The
GitHub root README is the canonical product documentation.

## What It Does

The package renders text files into local audio files for briefings, study notes, project summaries,
or agent-generated narration.

It supports two explicit paths:

- Transformers.js WAV for offline or confidential content. This is the default path.
- Edge TTS MP3 for higher-quality online narration when sending the text to Edge TTS is acceptable.

It does not require Python, ffmpeg, Piper, XTTS, or a local model server for the default
Transformers.js path.

## Install

```bash
pnpm add -D @jcode.labs/mimir-tts
```

## Quick Start

```bash
pnpm exec mimir-tts doctor --json
pnpm exec mimir-tts render /tmp/summary.txt --offline --out .mimir/audio/summary.wav
pnpm exec mimir-tts render /tmp/summary.txt --engine edge --out .mimir/audio/summary.mp3
```

The default engine is `transformers` for offline/confidential WAV output. Use `--engine edge` only
when sending narration text to online Edge TTS is acceptable.

## License

MIT (c) Jean-Baptiste Thery.
