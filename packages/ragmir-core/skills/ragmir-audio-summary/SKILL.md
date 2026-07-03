---
name: ragmir-audio-summary
description: >-
  Create an optional spoken audio summary from a Ragmir local knowledge base. Use when the user asks
  for an audio, TTS, spoken brief, briefing, narration, or listenable summary based on private
  repository documents indexed by Ragmir. The skill is confidentiality-first: gather facts through
  Ragmir, write only a temporary narration text file outside the repository, and render the final
  audio under ignored local Ragmir state unless the user explicitly chooses another output path.
---

# Ragmir Audio Summary

Use this skill to turn a confidential local Ragmir knowledge base into an optional audio summary.
The knowledge base stays local; the final audio is a generated artifact and must not be committed.

## Confidentiality Rules

- Treat the source documents, retrieved passages, generated narration, and final audio as sensitive.
- Do not use online TTS for confidential content unless the user explicitly allows it.
- Prefer `pnpm exec ragmir audio` or `pnpm exec ragmir-tts render` for plug-and-play output.
- Use `--engine transformers --offline` when model files are already present and remote model
  loading is not allowed.
- Use `--engine edge` only when online TTS is acceptable and global Voice Forge quality is required.
- Write the narration text to a temp file outside the repository, such as `/tmp/RAGMIR-SUMMARY-topic.txt`.
- Render audio under `.ragmir/audio/` by default. This directory is ignored by Git when Ragmir is installed.
- Never stage or commit generated audio, temporary text, WAV, AIFF, or intermediate files.

## 1. Verify The Knowledge Base

From the repository root, run:

```bash
pnpm exec ragmir doctor
pnpm exec ragmir status
pnpm exec ragmir audit
pnpm exec ragmir audit --unsupported
pnpm exec ragmir security-audit
```

If the audit reports missing or stale files, run:

```bash
pnpm exec ragmir doctor --fix
pnpm exec ragmir audit --unsupported
```

`ragmir doctor --fix` rebuilds the index only when supported files are present and the privacy posture
has no warnings. Do not create an audio summary from stale or incomplete evidence unless the user
explicitly accepts that limitation.

## 2. Search Deeply Before Writing

Use Ragmir search or MCP tools to gather evidence before drafting the narration.

For a broad summary, run multiple searches:

```bash
pnpm exec ragmir search "<main topic>" --top-k 8
pnpm exec ragmir search "<people, dates, money, obligations, risks, or decisions>" --top-k 8
pnpm exec ragmir ask "<specific synthesis question>" --top-k 8
```

When MCP is available, prefer `ragmir_search`, `ragmir_ask`, `ragmir_audit`, and
`ragmir_security_audit` over shell commands.

Keep citations in your working notes, but do not read long raw passages aloud. The audio should be a
clear synthesis, not a dump of source text.

## 3. Write For Listening

Write one flowing narration in the user's working language. Do not use markdown, headings, bullets,
tables, SSML, XML tags, or stage directions in the spoken text.

Good audio structure:

1. Start with the purpose of the summary and the two-to-four ideas to retain.
2. Explain the current evidence in plain language.
3. Separate proven facts from uncertainty.
4. Highlight decisions, risks, deadlines, and missing documents.
5. End with a concise recap and two or three self-check questions.

Use short sentences and natural punctuation. Spell acronyms and symbols in a way a TTS engine can
pronounce.

## 4. Render The Audio

Create the output directory and write the narration to a temp file outside the repo:

```bash
mkdir -p .ragmir/audio
```

Select the narration language with `--lang en|es|fr` (default `fr`). It picks the matching
self-contained offline model (English, Spanish, or French) for the Transformers.js path and a native
neural voice for the Edge path. Write the narration in the same language you pass to `--lang`.

For global Voice Forge quality on non-confidential text, render with Edge MP3:

```bash
pnpm exec ragmir audio /tmp/RAGMIR-SUMMARY-<subject-kebab>.txt \
  --engine edge \
  --lang <en|es|fr> \
  --out .ragmir/audio/RAGMIR-SUMMARY-<subject-kebab>.mp3
```

The Edge path uses the online Edge TTS service through the `edge-tts` CLI. Use it only when sending
the narration text to that service is acceptable.

For confidential or air-gapped operation, preload the model files under `.ragmir/models/tts` and run:

```bash
pnpm exec ragmir audio /tmp/RAGMIR-SUMMARY-<subject-kebab>.txt \
  --engine transformers \
  --offline \
  --lang <en|es|fr> \
  --model-path .ragmir/models/tts \
  --out .ragmir/audio/RAGMIR-SUMMARY-<subject-kebab>.wav
```

The Transformers.js path does not require Python, ffmpeg, Piper, XTTS, or a local TTS server. Remote
model downloads are disabled by default and require `--allow-remote-models` for an explicit
non-sensitive preload into `.ragmir/models/tts`. Preload with a synthetic non-sensitive sentence
first; the repository guide is `docs/offline-tts-preload.md`.

Use the voice-forge helper only when the user explicitly wants XTTS, macOS `say`, or Piper:

```bash
OUT_MP3="<repo-root>/.ragmir/audio/RAGMIR-SUMMARY-<subject-kebab>.mp3" \
  TTS_ENGINE=auto \
  bash <this-skill-dir>/forge-voice.sh /tmp/RAGMIR-SUMMARY-<subject-kebab>.txt
```

Helper engine selection:

- `auto`: Edge first when installed, then XTTS, macOS `say`, and Piper.
- `edge`: online Edge TTS with the global Voice Forge default voice.
- `xtts`: local Coqui XTTS-v2.
- `say`: local macOS speech engine, converted to MP3 with `ffmpeg`.
- `piper`: local neural TTS, converted to MP3 with `ffmpeg`.

Voice can be selected with `TTS_VOICE`. Speed for Edge can be selected with `TTS_RATE`.

## 5. Report The Result

After rendering, report:

- the audio path;
- which renderer/model was used or requested;
- whether remote model downloads or online TTS were allowed;
- any evidence limitation, such as stale index, missing documents, or weak search results.
