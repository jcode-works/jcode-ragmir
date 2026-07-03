# Narration Templates

Reference for the drafting step of `ragmir-audio-summary`. These are **thinking skeletons**, not
output formatting. The final narration is plain flowing prose with no markdown, headings, bullets,
tables, SSML, or XML tags. The skeletons below only shape how you order and connect ideas before you
write the spoken text.

Pick the format chosen in the skill, then fill the skeleton with the evidence that serves the user's
intent. Drop anything that does not serve the intent — that is how you avoid superfluous data.

## Format Selection Recap

| Format | When to use | Word budget |
| --- | --- | --- |
| Micro-brief | Little relevant material, or one clear question | 150-220 words |
| Brief standard | Moderate material, a few angles worth keeping | 450-750 words |
| Dossier long | Dense, multi-faceted material needing chapters | 1500-3000 words |

Length follows relevant material. Never pad.

---

## Micro-Brief Skeleton

Spoken-prose shape (write it as one flowing passage, not as headings):

1. **Hook + intent** — one sentence naming the subject and why the listener asked.
2. **Key idea** — the single thing to remember, stated up front (primacy).
3. **Evidence** — one short, plain-language reason or fact that supports it.
4. **Uncertainty / caveat** — one sentence if the evidence is partial or stale; omit only if solid.
5. **Recap + recall** — restate the key idea in other words, then ask one active-recall question,
   pause with `…`, and give the answer.

Abstract example (do not copy the words, follow the shape):

> "Vous vouliez savoir si la clause de rupture est applicable. Oui, elle l'est, mais seulement après
> un préavis de trente jours. Le contrat le prévoit explicitement à la section terminaison. En
> revanche, la date de départ du préavis reste ambiguë, aucun courrier ne la fixe clairement.
> Retenez donc une chose: rupture possible, préavis de trente jours, point de départ à confirmer.
> Question: quelle est la durée du préavis prévu? … Trente jours."

---

## Brief Standard Skeleton (Pyramid + SCQA)

The standard brief follows Barbara Minto's pyramid: answer first, then supporting points, then
recap. Wrap it in a short Situation-Complication-Question-Answer opening.

1. **Situation** — one or two sentences framing the context the listener already shares.
2. **Complication** — the tension, change, or question that prompted the summary.
3. **Question** — the explicit question the summary answers.
4. **Answer (the key message)** — the one-to-three points to retain, stated first (primacy).
5. **Developed points** — each of the two-to-four points expanded in plain speech, grouped with
   signposting ("D'abord…, Ensuite…, Enfin…"). Proven facts only; separate from inference.
6. **Uncertainty, risks, decisions, missing documents** — a short passage on what is not yet
   settled or needs action.
7. **Recap** — restate the two-to-four key points in compressed form (recency).
8. **Active recall** — two or three recall questions, each followed by a `…` pause and the answer.

Abstract example (shape only):

> "Le projet a atteint sa phase de test. Le souci, c'est que deux blocages apparaissent en
> parallèle. Faut-il continuer ou mettre en pause? La réponse tient en deux points: continuez sur
> le module A, mais mettez en pause le module B. D'abord, le module A passe ses tests sans
> régression. Ensuite, le module B dépend d'un composant externe encore instable. Ce qu'on ne sait
> pas encore, c'est la date de livraison du composant externe. Donc retenez: module A en avant,
> module B en attente, dépendance externe à confirmer. Première question: quel module peut
> continuer sans risque? … Le module A. Deuxième question: pourquoi mettre en pause le module B? … À cause d'un
> composant externe instable."

---

## Dossier Long Skeleton (Chaptered)

Use only when the material genuinely has several distinct facets. Each chapter is a self-contained
mini-brief with its own mini-recap, so a listener can step away and come back.

1. **Promise** — what the whole audio covers and the three-to-five landmarks to listen for. State
   the key message of the whole dossier up front.
2. **Chapter 1** — signpost the chapter ("Premier point: …"). Give its mini pyramid
   (answer → evidence → caveat), then a one-sentence mini-recap.
3. **Chapter 2** — same shape, explicit transition ("Deuxième point: …").
4. **Continue** for each facet. Keep chapters balanced in length; merge thin ones.
5. **Global recap** — compress the key message of every chapter into one flowing passage (recency).
6. **Active recall** — three to five recall questions across the chapters, each with a `…` pause
   and the answer. Spread the questions across chapters, not only the last one.

Transitions between chapters are essential in long audio — see the signposting catalogue below.

Abstract shape:

> "Ce dossier couvre les trois enjeux du contrat: la durée, la rupture, et les pénalités. En une
> ligne: la durée est ferme, la rupture est conditionnée, les pénalités sont plafonnées. Premier
> point: la durée. Le contrat court sur trois ans, fermes. … [chapitre] … Donc, durée ferme de
> trois ans. Deuxième point: la rupture. … [chapitre] … Donc, rupture possible sous préavis.
> Troisième point: les pénalités. … [chapitre] … Donc, pénalités plafonnées à dix pour cent. Pour
> récapituler l'ensemble: trois ans fermes, rupture sous préavis, pénalités plafonnées. Première
> question: quelle est la durée ferme du contrat? … Trois ans. …"

---

## Signposting Catalogue

Signposting is the connective tissue that makes audio followable without visuals. Use these spoken
transitions instead of lists or headings.

| Move | Spoken cue (FR examples) |
| --- | --- |
| Open | "Voici l'essentiel sur…" / "Vous vouliez savoir si… La réponse courte est…" |
| Enumerate | "D'abord…, Ensuite…, Enfin…" / "Il y a trois points…" (then speak each) |
| Contrast | "En revanche…" / "Mais attention…" / "À l'inverse…" |
| Cause / effect | "Parce que…" / "C'est pourquoi…" / "La conséquence est…" |
| Emphasize | "Retenez ceci…" / "Le point clé, c'est…" |
| Transition chapter | "Deuxième point…" / "Passons à…" / "Cela nous amène à…" |
| Mini-recap | "En un mot…" / "Donc, pour ce point…" |
| Close | "Pour récapituler…" / "En résumé…" |
| Recall question | "Question: …? … [answer]" |

When enumerating, say the count first ("trois points") then speak each one with "D'abord / Ensuite /
Enfin" — never read a literal list.

---

## Active-Recall Question Catalogue

Active recall forces the listener to retrieve from memory, which anchors retention far better than
passive re-exposure. Phrase questions so they require **recall**, not recognition (no multiple
choice, no "est-ce que c'est X?" with the answer embedded).

### By intent

| Intent | What to drill | Question shape (FR examples) |
| --- | --- | --- |
| Decide | The decision and its one main driver | "Quelle option recommande-t-on, et pourquoi?" |
| Learn | The definitions and the one mechanism to remember | "Comment définit-on X, et qu'est-ce qui le déclenche?" |
| Monitor | The thresholds and the alert condition | "À partir de quel seuil déclenche-t-on l'alerte?" |
| Compare | The decisive differentiator | "Quelle est la principale différence entre A et B?" |
| Plan | The next concrete action and its owner | "Quelle est la première action à mener, et par qui?" |

### Rules

- Two to three questions for a brief, three to five for a dossier. One is enough for a micro-brief.
- Each question targets a key point from the recap, not a peripheral detail.
- After the question mark, insert `…` so the TTS pause gives the listener a beat to answer silently,
  then state the answer in the fewest words possible.
- Do not reveal the answer inside the question. "Le préavis est-il de trente jours?" leaks the
  answer — prefer "Quelle est la durée du préavis?".

---

## Evidence Separation In Spoken Form

Spoken audio can still respect the Ragmir separation of evidence and inference. Use language cues,
not formatting:

- Proven fact: state plainly. "Le contrat fixe le préavis à trente jours."
- Inference: mark it. "Cela suggère que…" / "On peut en déduire que…"
- Uncertainty: mark it. "Ce qu'on ne sait pas encore, c'est…" / "Reste à confirmer…"
- Missing document: name it. "Il manque le courrier de notification, donc…"
- Decision / action: mark it. "La décision à prendre est…"

This keeps the narration honest without leaning on tables or footnotes that audio cannot carry.
