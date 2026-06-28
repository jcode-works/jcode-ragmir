---
name: mimir-audio-summary
description: >-
  Create an optional spoken audio summary from a Mimir local knowledge base. Use when the user asks
  for an audio, TTS, spoken brief, briefing, narration, or listenable summary based on private
  repository documents indexed by Mimir. The skill is confidentiality-first: gather facts through
  Mimir, write only a temporary narration text file outside the repository, and render the final
  audio under ignored local Mimir state unless the user explicitly chooses another output path.
---

# Mimir Audio Summary

Use this skill to turn a confidential local Mimir knowledge base into an optional audio summary.
The knowledge base stays local; the final audio is a generated artifact and must not be committed.

## Confidentiality Rules

- Treat the source documents, retrieved passages, generated narration, and final audio as sensitive.
- Do not use online TTS for confidential content unless the user explicitly allows it.
- Prefer `pnpm exec kb audio` or `pnpm exec mimir-tts render` for plug-and-play local WAV output.
- Use `--offline` when model files are already present and remote model loading is not allowed.
- Write the narration text to a temp file outside the repository, such as `/tmp/MIMIR-SUMMARY-topic.txt`.
- Render audio under `.mimir/audio/` by default. This directory is ignored by Git when Mimir is installed.
- Never stage or commit generated audio, temporary text, WAV, AIFF, or intermediate files.

## 1. Verify The Knowledge Base

From the repository root, run:

```bash
pnpm exec kb status
pnpm exec kb audit
pnpm exec kb security-audit
```

If the audit reports missing or stale files, run:

```bash
pnpm exec kb ingest
pnpm exec kb audit
```

Do not create an audio summary from stale or incomplete evidence unless the user explicitly accepts
that limitation.

## 2. Search Deeply Before Writing

Use Mimir search or MCP tools to gather evidence before drafting the narration.

For a broad summary, run multiple searches:

```bash
pnpm exec kb search "<main topic>" --top-k 8
pnpm exec kb search "<people, dates, money, obligations, risks, or decisions>" --top-k 8
pnpm exec kb ask "<specific synthesis question>" --top-k 8
```

When MCP is available, prefer `mimir_search`, `mimir_ask`, `mimir_audit`, and
`mimir_security_audit` over shell commands.

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
mkdir -p .mimir/audio
```

Then render with the default Mimir TTS path:

```bash
pnpm exec kb audio /tmp/MIMIR-SUMMARY-<subject-kebab>.txt \
  --out .mimir/audio/MIMIR-SUMMARY-<subject-kebab>.wav
```

For air-gapped operation, preload the model files under `.mimir/models/tts` and run:

```bash
pnpm exec kb audio /tmp/MIMIR-SUMMARY-<subject-kebab>.txt \
  --out .mimir/audio/MIMIR-SUMMARY-<subject-kebab>.wav \
  --offline
```

The default renderer uses `@jcode.labs/mimir-tts` and Transformers.js. It does not require Python,
ffmpeg, Piper, XTTS, or a local TTS server. The first non-offline render can download public model
files into `.mimir/models/tts`, but the narration text is processed locally.

Use the legacy voice-forge helper only when the user explicitly wants MP3 output or an engine not
covered by Mimir TTS:

```bash
OUT_MP3="<repo-root>/.mimir/audio/MIMIR-SUMMARY-<subject-kebab>.mp3" \
  TTS_ENGINE=auto \
  bash <this-skill-dir>/forge-voice.sh /tmp/MIMIR-SUMMARY-<subject-kebab>.txt
```

Engine selection:

- `auto`: confidentiality-first order: XTTS, macOS `say`, Piper, then online Edge only when
  `MIMIR_ALLOW_ONLINE_TTS=1`.
- `xtts`: local Coqui XTTS-v2.
- `say`: local macOS speech engine, converted to MP3 with `ffmpeg`.
- `piper`: local neural TTS, converted to MP3 with `ffmpeg`.
- `edge`: online Edge TTS. Use only with explicit user approval for non-sensitive text.

Voice can be selected with `TTS_VOICE`. Speed for Edge can be selected with `TTS_RATE`.

## 5. Report The Result

After rendering, report:

- the audio path;
- which renderer/model was used or requested;
- whether remote model downloads or online TTS were allowed;
- any evidence limitation, such as stale index, missing documents, or weak search results.
