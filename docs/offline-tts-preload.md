# Offline TTS

Ragmir renders local WAV audio through Transformers.js. Download the language model once with
non-sensitive text, then render confidential content offline.

```bash
printf '%s\n' "Non-sensitive model preload text." > /tmp/ragmir-tts-preload.txt
rgr audio /tmp/ragmir-tts-preload.txt --lang en --allow-remote-models --out .ragmir/audio/preload.wav
rgr audio ./brief.md --lang en --offline --out .ragmir/audio/brief.wav
```

The first command warms `.ragmir/models/tts`. The second command requires the local model and does
not download anything. Generated files stay in ignored `.ragmir/audio/` state.

Use the same language code for both commands:

| `--lang` | Language | Offline model |
| --- | --- | --- |
| `en` | English | `Xenova/mms-tts-eng` |
| `fr` | French | `Xenova/mms-tts-fra` |
| `es` | Spanish | `Xenova/mms-tts-spa` |

French is the default when `--lang` is omitted. Run `rgr audio --doctor --json` to inspect the
supported offline and Edge language lists.

For an online MP3 voice, choose Edge explicitly:

```bash
rgr audio ./brief.md --engine edge --lang ja --out .ragmir/audio/brief.mp3
```

Edge also supports `en`, `fr`, `es`, `ja`, `th`, and `zh`; its default voice follows `--lang` unless
`--voice` overrides it. Use that path only when sending the narration text to the external service
is acceptable.
