# Offline TTS Preload

`mimir audio --offline` disables remote model downloads. It only works after the
Transformers.js TTS model has already been cached under `.mimir/models/tts` or the path passed with
`--model-path`.

Use this workflow when you want confidential audio summaries to render without network access.

## Boundary

- Preload with a short non-sensitive sentence while network access is acceptable.
- Render confidential narration only after the offline check succeeds.
- Keep `.mimir/models/tts/` and `.mimir/audio/` untracked.
- Do not use `--engine edge` for confidential content unless online TTS is explicitly acceptable.

The preload step downloads public model files. It should not need to send narration text to a remote
TTS service, but using synthetic text keeps the operation easy to audit.

## Main CLI

Create a synthetic input outside the repository:

```bash
printf 'Mimir offline speech preload check.' > /tmp/mimir-tts-preload.txt
mkdir -p .mimir/audio
```

Preload the default Transformers.js model:

```bash
pnpm exec mimir audio /tmp/mimir-tts-preload.txt \
  --engine transformers \
  --allow-remote-models \
  --model-path .mimir/models/tts \
  --out .mimir/audio/preload-check.wav
```

Then prove the cache works with remote loading disabled:

```bash
pnpm exec mimir audio /tmp/mimir-tts-preload.txt \
  --engine transformers \
  --offline \
  --model-path .mimir/models/tts \
  --out .mimir/audio/offline-check.wav
```

After that, render confidential narration offline:

```bash
pnpm exec mimir audio /tmp/MIMIR-SUMMARY-project.txt \
  --engine transformers \
  --offline \
  --model-path .mimir/models/tts \
  --out .mimir/audio/project-summary.wav
```

## Standalone TTS CLI

The standalone package uses the same model cache:

```bash
pnpm exec mimir-tts render /tmp/mimir-tts-preload.txt \
  --engine transformers \
  --allow-remote-models \
  --model-path .mimir/models/tts \
  --out .mimir/audio/preload-check.wav

pnpm exec mimir-tts render /tmp/mimir-tts-preload.txt \
  --offline \
  --model-path .mimir/models/tts \
  --out .mimir/audio/offline-check.wav
```

## Air-Gapped Machines

If the target machine cannot touch the network:

1. Run the preload command on a trusted internet-connected machine with the same Mimir TTS version,
   model ID, and `--model-path`.
2. Copy the resulting `.mimir/models/tts/` directory to the target machine through an approved local
   transfer path.
3. Run the offline check on the target machine before rendering real narration.

Do not commit the model cache to Git or include it in npm packages.

## Troubleshooting

If offline render fails, check:

- The preload and offline render use the same `--model`, `--model-path`, and package version.
- The target machine received the full `.mimir/models/tts/` directory.
- The output path ends with `.wav`; MP3 requires the online Edge TTS path.
- `MIMIR_TTS_MODEL_PATH` does not point to a different cache directory.
