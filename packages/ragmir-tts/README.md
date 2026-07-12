# Ragmir TTS

`@jcode.labs/ragmir-tts` renders text to local audio for Ragmir summaries.

```bash
npm install --save-dev @jcode.labs/ragmir-tts
npx rgr-tts doctor --json
npx rgr-tts render ./summary.txt --offline --out .ragmir/audio/summary.wav
```

Offline WAV rendering is the default. Edge MP3 is available only when sending text to that online
service is acceptable. See the [offline TTS guide](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/offline-tts-preload.md).
