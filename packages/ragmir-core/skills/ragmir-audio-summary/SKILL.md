---
name: ragmir-audio-summary
description: >-
  Create an intention-driven, memorable spoken audio summary from a Ragmir local knowledge base. Use
  when the user asks for an audio, TTS, spoken brief, briefing, narration, or listenable summary
  based on private repository documents indexed by Ragmir. The skill is confidentiality-first: it
  filters everything against the user's intent, writes only a temporary narration text file outside
  the repository, and renders the final audio under ignored local Ragmir state unless the user
  explicitly chooses another output path.
---

# Ragmir Audio Summary

Use this skill to turn a confidential local Ragmir knowledge base into a spoken summary that
respects the listener: only what serves their intent, structured to be intelligible in one pass, and
designed to be retained.

The knowledge base stays local. The final audio is a generated artifact and must not be committed.

The goal is not a "basic summary read aloud". It is a deliberate narration built from five
techniques:

1. **Intent-first filtering** — drop everything that does not serve what the user actually needs.
2. **Density-driven duration** — short for a small topic, long for a large one. Never pad.
3. **Pyramid structure** — answer first, then the supporting points, then a recap.
4. **Writing for the ear** — short sentences, spoken signposting, deliberate TTS punctuation.
5. **Active recall** — two-to-three self-check questions that force retrieval and anchor memory.

Two reference files sit next to this skill and are read while drafting:

- `listening-style.md` — how to write prose a TTS engine can pronounce and a listener can follow.
- `narration-templates.md` — skeletons per format, plus signposting and active-recall catalogues.

## Confidentiality Rules

- Treat the source documents, retrieved passages, generated narration, and final audio as sensitive.
- Do not use online TTS for confidential content unless the user explicitly allows it.
- Prefer `pnpm exec rgr audio` or `pnpm exec rgr-tts render` for plug-and-play output.
- Use `--engine transformers --offline` when model files are already present and remote model
  loading is not allowed.
- Use `--engine edge` only when online TTS is acceptable and global Voice Forge quality is required.
- Write the narration text to a temp file outside the repository, such as `/tmp/RAGMIR-SUMMARY-topic.txt`.
- Render audio under `.ragmir/audio/` by default. This directory is ignored by Git when Ragmir is installed.
- Never stage or commit generated audio, temporary text, WAV, AIFF, or intermediate files.

## 1. Capture The Intent Before Searching

Do not run any search yet. First make the intent explicit so every later step filters by it. Confirm
with the user when it is ambiguous, or infer it from their request and state your assumption.

Capture four things:

- **Purpose** — what the listener will do with this: decide, learn, monitor, compare, or plan.
- **Subject** — the precise question or topic, narrower than "summarize everything".
- **Depth** — a quick scan or a deep dossier. Let the user steer, but default from the material.
- **Language** — the spoken language, passed later to `--lang` (`fr` default, `en`, `es`, `ja`,
  `th`, `zh`).

This is the guardrail against superfluous data: anything that does not advance the captured intent
gets dropped at the drafting step, not added because it was "also in the documents".

## 2. Verify The Knowledge Base

From the repository root, run:

```bash
pnpm exec rgr doctor
pnpm exec rgr status
pnpm exec rgr audit
pnpm exec rgr audit --unsupported
pnpm exec rgr security-audit
```

If the audit reports missing or stale files, run:

```bash
pnpm exec rgr doctor --fix
pnpm exec rgr audit --unsupported
```

`rgr doctor --fix` rebuilds the index only when supported files are present and the privacy posture
has no warnings. Do not create an audio summary from stale or incomplete evidence unless the user
explicitly accepts that limitation.

## 3. Search Deeply, Guided By The Intent

Use Ragmir search or MCP tools to gather evidence, and derive the queries from the intent captured
in step 1 — not from the subject alone.

For a broad summary, run multiple searches:

```bash
pnpm exec rgr search "<main topic>" --top-k 8
pnpm exec rgr search "<people, dates, money, obligations, risks, or decisions>" --top-k 8
pnpm exec rgr ask "<specific synthesis question>" --top-k 8
```

When MCP is available, prefer `ragmir_search`, `ragmir_ask`, `ragmir_audit`, and
`ragmir_security_audit` over shell commands.

Keep citations in your working notes, but do not read long raw passages aloud. The audio is a clear
synthesis, not a dump of source text.

While searching, also gauge the **density of relevant material** for step 4:

- How many passages directly serve the intent?
- Do they overlap, reinforce, or contradict each other?
- Are there clear facets (chapters) or one tight question?

## 4. Choose The Format From The Density

Pick the format from the relevant material found, not from a fixed default. Length follows material;
never pad.

| Format | Use when | Word budget | Duration |
| --- | --- | --- | --- |
| **Micro-brief** | One clear question or little relevant material | 150-220 words | ~60-90 s |
| **Brief standard** | Moderate material, a few angles worth keeping | 450-750 words | ~3-5 min |
| **Dossier long** | Dense, multi-faceted material needing chapters | 1500-3000 words | ~10-20 min |

If two formats plausibly fit, prefer the shorter one unless the user asked for depth. A short,
dense summary respects the listener more than a padded one.

If the user explicitly asks for a long audio on a thin topic, say so in the final report and keep
the narration tight rather than inflated.

## 5. Write For Listening

Write one flowing narration in the chosen language. No markdown, headings, bullets, tables, SSML, or
XML tags in the spoken text. Open `listening-style.md` for the full rules; the cardinal ones:

- **Pyramid first.** State the key message (one-to-four points to retain) up front, then develop it,
  then recap it. This exploits primacy and recency.
- **Signpost, do not list.** Use spoken transitions ("D'abord…, Ensuite…, Enfin…") instead of
  enumerated lists. See `narration-templates.md` for the catalogue.
- **Short sentences.** One idea per sentence, twenty words or fewer. Split long ones.
- **Deliberate punctuation.** Periods for full pauses, commas for micro-pauses, `…` for the
  deliberate beat before an active-recall answer. Avoid semicolons and exclamation marks.
- **Pronounceable.** Expand acronyms on first use, write numbers and symbols in words, never read
  URLs, paths, or code aloud.

Read the draft aloud once at a normal pace. If you stumble or run out of breath, the sentence is too
long or too dense — fix it.

## 6. Anchor Memorability

Build two devices into every narration, systematically:

1. **Recap the key points twice** — once right after the opening message, once at the very end.
   Same points, compressed, in different words the second time.
2. **Active recall** — end with self-check questions that force retrieval, not recognition:
   - One question for a micro-brief, two-to-three for a standard brief, three-to-five for a dossier.
   - Each question targets a key point from the recap, not a peripheral detail.
   - Phrase so the answer is not leaked: "Quelle est la durée du préavis?" beats "Le préavis est-il
     de trente jours?".
   - After each question mark, insert `…` so the TTS pause gives the listener a beat to answer
     silently, then state the answer in the fewest words possible.

For the full skeleton per format and the active-recall catalogue by intent, see
`narration-templates.md`.

Respect the Ragmir evidence separation in spoken form using language cues rather than formatting:
state proven facts plainly, mark inferences ("Cela suggère que…"), mark uncertainty ("Reste à
confirmer…"), and name missing documents.

## 7. Render The Audio

Create the output directory and write the narration to a temp file outside the repo:

```bash
mkdir -p .ragmir/audio
```

Select the narration language with `--lang en|es|fr|ja|th|zh` (default `fr`). English, Spanish, and
French pick matching self-contained offline models for the Transformers.js path and native neural
voices for the Edge path. Japanese, Thai, and Mandarin Chinese currently pick native Edge voices; for
offline rendering in those languages, pass a Transformers.js-compatible model explicitly. Write the
narration in the same language you pass to `--lang`.

For global Voice Forge quality on non-confidential text, render with Edge MP3:

```bash
pnpm exec rgr audio /tmp/RAGMIR-SUMMARY-<subject-kebab>.txt \
  --engine edge \
  --lang <en|es|fr|ja|th|zh> \
  --out .ragmir/audio/RAGMIR-SUMMARY-<subject-kebab>.mp3
```

The Edge path uses the online Edge TTS service through the `edge-tts` CLI. Use it only when sending
the narration text to that service is acceptable.

For confidential or air-gapped operation, preload the model files under `.ragmir/models/tts` and run:

```bash
pnpm exec rgr audio /tmp/RAGMIR-SUMMARY-<subject-kebab>.txt \
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

## 8. Report The Result

After rendering, report:

- the audio path;
- the **format chosen** (micro-brief, brief standard, dossier long) and the **intention served**;
- the **estimated duration** (`word count / 140`) versus the target budget;
- which renderer/model was used or requested;
- whether remote model downloads or online TTS were allowed;
- any evidence limitation, such as stale index, missing documents, or weak search results.
