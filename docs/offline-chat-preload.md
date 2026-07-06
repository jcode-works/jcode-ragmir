# Offline Chat Preload

`rgr chat` uses the optional `@jcode.labs/ragmir-chat` add-on. Ragmir Core still returns retrieval
context only; the add-on takes the retrieved passages, builds a cited prompt, and runs a local
Transformers.js text-generation model.

The default model is `onnx-community/Qwen2.5-0.5B-Instruct` with q4 weights. It is small enough for
local experiments, but it is still a local LLM: expect slower CPU answers and validate important
outputs against the cited passages.

## One-Time Setup

Run this from the target repository after `rgr setup` and `rgr ingest`:

```bash
rgr chat setup
```

This downloads the configured model into `.ragmir/models/chat`. The command is explicit setup, so it
allows remote model loading for that preload. Normal answers keep remote model loading disabled.

To preload a different Transformers.js-compatible model:

```bash
rgr chat setup \
  --model onnx-community/Qwen2.5-0.5B-Instruct \
  --model-path .ragmir/models/chat
```

## Offline Answer

After setup, answer from the local index without downloading model files:

```bash
rgr chat "Which evidence supports offline operation?" --offline
```

`rgr chat` first retrieves Ragmir passages with `rgr search` semantics, then asks the local model to
answer only from that context and cite sources as `[1]`, `[2]`, and so on.

Useful options:

```bash
rgr chat "Question" --top-k 5
rgr chat "Question" --max-new-tokens 256
rgr chat "Question" --context-limit 6000
rgr chat doctor --json
```

## Air-Gapped Use

For a fully offline machine, copy the already populated `.ragmir/models/chat` directory into the
target repository or equivalent model path, then run:

```bash
rgr chat doctor
rgr chat "Question" --offline --model-path .ragmir/models/chat
```

Do not commit `.ragmir/models/chat`; `.ragmir/` is local generated state and should stay ignored.
