# Ragmir Chat

`@jcode.labs/ragmir-chat` is the optional local generation add-on used by `rgr chat`. It runs a
verified GGUF model through `node-llama-cpp` and grounds visible answers in Ragmir citations.

```bash
npm install --save-dev @jcode.labs/ragmir @jcode.labs/ragmir-chat
rgr setup
rgr sources add "docs/**/*.md"
rgr ingest
rgr chat setup --profile fast
rgr chat "What evidence supports this decision?"
```

Setup is the only command that downloads a model. Normal answers stay local. Choose `lite` for
lower-memory machines, `fast` for the default Gemma profile, or `quality` for the larger profile.

See [offline chat setup](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/offline-chat-preload.md)
for model verification, profiles, and air-gapped preparation.
