---
name: ragmir-audio-summary
description: Create a concise spoken summary from a local Ragmir corpus when the user asks for audio, narration, a spoken brief, or TTS. Keep private source material and generated audio local.
---

# Ragmir Audio Summary

Create a cited, listener-focused narration from local Ragmir evidence. Generated audio and its
draft text are local artifacts, never commit them.

## Safety

- Treat documents, retrieved passages, narration, and audio as confidential.
- Write the draft to a temporary file outside the repository.
- Write the output under ignored `.ragmir/audio/` by default.
- Use offline TTS for confidential content. Online rendering needs explicit user approval.
- State facts, inferences, uncertainty, and missing evidence separately.

## Workflow

1. Identify the listener's purpose, topic, depth, and language.
2. Check the corpus:

   ```sh
   pnpm exec rgr doctor
   pnpm exec rgr audit --unsupported
   pnpm exec rgr security-audit
   ```

3. Retrieve only material that serves the purpose:

   ```sh
   pnpm exec rgr search "<topic>" --top-k 8
   pnpm exec rgr search "<dates, risks, decisions, obligations>" --top-k 8
   pnpm exec rgr ask "<specific question>" --top-k 8
   ```

4. Choose the shortest useful format:

   | Format | Budget | Typical duration |
   | --- | --- | --- |
   | Micro brief | 150-220 words | 1-2 minutes |
   | Standard brief | 450-750 words | 3-5 minutes |
   | Long dossier | 1,500-3,000 words | 10-20 minutes |

5. Write one flowing narration: answer first, explain the supporting evidence, recap, then add a
   few self-check questions. Use short sentences and spoken transitions. Do not read file paths,
   URLs, tables, or code aloud.

## Render locally

Preload a local model with non-sensitive text before confidential use. Then render with the offline
Transformers.js path:

```sh
mkdir -p .ragmir/audio
pnpm exec rgr audio /tmp/ragmir-summary-<topic>.txt \
  --engine transformers \
  --offline \
  --lang <en|es|fr> \
  --model-path .ragmir/models/tts \
  --out .ragmir/audio/ragmir-summary-<topic>.wav
```

For non-sensitive text, use the online Edge MP3 path only when the user explicitly permits it:

```sh
pnpm exec rgr audio /tmp/ragmir-summary-<topic>.txt \
  --engine edge \
  --lang <en|es|fr|ja|th|zh> \
  --out .ragmir/audio/ragmir-summary-<topic>.mp3
```

See `docs/offline-tts-preload.md` for the one-time model preload. Use the bundled helper scripts
only when the user specifically requests their renderer.

## Hand-off

Report the local audio path, chosen format and estimated duration, renderer mode, whether online
processing was allowed, and any weakness in the source evidence.
