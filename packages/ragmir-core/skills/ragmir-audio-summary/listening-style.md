# Listening Style Guide

Reference for the narration-writing step of `ragmir-audio-summary`. This file defines how to turn
retrieved evidence into spoken text that a TTS engine can pronounce and a listener can follow and
remember in one pass. There is no second chance to re-read audio.

## Pacing And Duration

- Conversational narration lands around **130-150 words per minute**. Plan on **140 words/minute**
  as the working estimate.
- Estimated duration = `word count / 140`. Keep a short narration under the target; never pad to
  reach a target.
- Per-format word budgets (use them as ceilings, not goals):

| Format | Target duration | Word budget |
| --- | --- | --- |
| Micro-brief | ~60-90 s | 150-220 words |
| Brief standard | ~3-5 min | 450-750 words |
| Dossier long | ~10-20 min | 1500-3000 words |

If the relevant material does not fill the budget, stop earlier. Padding makes audio undrinkable.

## Sentence Shape

- One idea per sentence. If you need "and" twice, split the sentence.
- Aim for **20 words or fewer** per sentence. A few longer sentences are fine for rhythm; never chain
  three long ones in a row.
- Prefer subject-verb-object order. TTS engines and the human ear both handle it best.
- Avoid stacked subordinate clauses and parentheticals. They trip the reader and the listener.

  Before: "Le contrat, qui avait été signé, malgré des réserves émises tardivement, par les deux
  parties, prévoit une rupture."

  After: "Les deux parties ont signé le contrat, avec des réserves de dernière minute. Il prévoit
  une rupture."

## Punctuation For TTS

Punctuation is the only cue a TTS engine has for pausing. Use it deliberately.

- **Comma** `,` — short micro-pause. Use it to separate clauses and ease breathing points.
- **Period** `.` — full pause. End sentences here. Favour periods over commas when in doubt.
- **Ellipsis** `…` — deliberate longer pause. Use it before the answer in an active-recall question,
  so the listener gets a beat to think (about three seconds).
- **Colon** `:` — read as a mild pause; acceptable when introducing a short enumeration spoken as
  prose, but prefer rephrasing into a plain sentence.
- **Semicolon** `;` — avoid. Engines hesitate inconsistently. Split into two sentences.
- **Exclamation** `!` — avoid for TTS. It can trigger an unnatural spike in pitch.
- **Question mark** `?` — use it for the active-recall questions; the engine raises intonation
  naturally.

## Pronounceability

Anything the engine might misread must be rewritten for the ear.

- **Acronyms**: expand on first use, then use the short form if it is pronounceable. "Le RGPD, le
  Règlement Général sur la Protection des Données, ..."
- **Numbers**: write them the way they should be read. "1500" can read as "mille cinq cents" or
  "quinze cents" — write the intended form. For money, spell the currency: "douze mille euros".
- **Symbols**: rewrite in words. `&` becomes "et", `%` becomes "pour cent", `->` becomes "mène à".
- **Dates and times**: write them fully. "Le quinze mars deux mille vingt-cinq", not "2025-03-15".
- **URLs, paths, code**: never read them aloud. Paraphrase: "le fichier de configuration du
  projet" instead of `ragmir/config.json`.
- **Foreign terms**: if the term has no clean translation, introduce it once and keep it.

## Anti-Patterns

Avoid these — they are the main causes of "imbuvable" audio.

- **Jargon without setup.** If a technical term is needed, define it in one short clause first.
- **Spoken bullet lists.** Enumerations read aloud are exhausting. Convert lists into flowing
  sentences with signposting ("D'abord…, Ensuite…, Pour finir…"). See `narration-templates.md`.
- **Meta-commentary.** Drop "Dans ce résumé, nous allons parler de…". Open on the substance.
- **Padding to reach a duration.** Restating the same idea in more words lowers density and respect
  for the listener. Shorter is better than watered down.
- **Reading raw source passages.** The audio is a synthesis, not a quote dump. Reformulate in plain
  speech and keep the citation in your working notes, not in the narration.
- **Overload.** More than ~4 new ideas in a brief is too many to retain. Group, merge, or defer.

## Language

- Write the narration in the same language passed to `--lang` (`fr` default, `en`, `es`).
- Match the working language the user used when asking for the summary when it is one of the three
  supported languages.
- Keep numerals, units, and proper nouns pronounceable in the target language.

## Self-Check Before Rendering

Read the draft aloud once at a normal pace. If you stumble or run out of breath on a sentence, it is
too long or too dense. Fix it, then estimate the duration with `word count / 140` and confirm it
matches the chosen format's budget.
