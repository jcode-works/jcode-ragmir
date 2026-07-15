# Offline TTS

Ragmir renders local WAV audio through Transformers.js. Download the model once with non-sensitive text, then render confidential content offline.

```bash
printf '%s\n' "Non-sensitive model preload text." > /tmp/ragmir-tts-preload.txt
rgr audio /tmp/ragmir-tts-preload.txt --lang en --allow-remote-models --out .ragmir/audio/preload.wav
rgr audio ./brief.md --lang en --offline --out .ragmir/audio/brief.wav
```

The first command warms `.ragmir/models/tts`. The second command requires the local model and does not download anything. Generated files stay in ignored `.ragmir/audio/` state.

For an online MP3 voice, choose Edge explicitly:

```bash
rgr audio ./brief.md --engine edge --out .ragmir/audio/brief.mp3
```

Use that path only when sending the narration text to the external service is acceptable.
