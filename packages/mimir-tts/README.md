# Mimir TTS Package

`@jcode.labs/mimir-tts` is the standalone text-to-speech package used by Mimir audio summaries.

**Full documentation:** https://github.com/jcode-works/jcode-mimir#readme

This npm README is intentionally short because package READMEs are displayed separately on npm. The
GitHub root README is the canonical product documentation.

## Install

```bash
pnpm add -D @jcode.labs/mimir-tts
```

## Quick Commands

```bash
pnpm exec mimir-tts doctor --json
pnpm exec mimir-tts render /tmp/summary.txt --offline --out .mimir/audio/summary.wav
pnpm exec mimir-tts render /tmp/summary.txt --engine edge --out .mimir/audio/summary.mp3
```

The default engine is `transformers` for offline/confidential WAV output. Use `--engine edge` only
when sending narration text to online Edge TTS is acceptable.

## License

MIT (c) Jean-Baptiste Thery.
