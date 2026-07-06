# Ragmir Chat

`@jcode.labs/ragmir-chat` is the optional local chat add-on used by `rgr chat`.
It keeps Ragmir Core retrieval-only while adding a Transformers.js text-generation
path for cited, offline answers after a one-time model preload.

```bash
npm install --save-dev @jcode.labs/ragmir @jcode.labs/ragmir-chat
rgr setup
rgr chat setup
rgr chat "What evidence supports this decision?"
```

`rgr chat setup` downloads the configured model into `.ragmir/models/chat`.
Normal `rgr chat` runs with remote model loading disabled by default. Pass
`--allow-remote-models` only when a one-off download during the answer is
acceptable.

The default model is `onnx-community/Qwen2.5-0.5B-Instruct` with q4 weights,
matching the small local chat model pattern documented by Transformers.js.
Override it with `--model` or `RAGMIR_CHAT_MODEL` when you have another
Transformers.js-compatible text-generation model preloaded.
