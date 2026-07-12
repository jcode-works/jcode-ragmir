# Ragmir Chat

`@jcode.labs/ragmir-chat` is Ragmir's optional local answer-generation package. It runs a verified
GGUF model with `node-llama-cpp`, over retrieval context supplied by Ragmir Core, and keeps visible
answers grounded in source citations.

It does not replace Core's retrieval-first behavior. Install it only when local, cited answer
generation is useful after documents have been indexed.

## Choose this package when you need

| Need | What Chat provides |
| --- | --- |
| Ask questions about an already indexed repository | Local answers over cited retrieval passages. |
| Keep model inference on the workstation | A local GGUF runtime, without a hosted chat API. |
| Prepare an air-gapped workflow | Download and verify the model once, then run with `--offline`. |
| Use local generation from code | `generateChatAnswer()` and the runtime exports. |

For document ingestion, search, and MCP, install [Ragmir Core](https://www.npmjs.com/package/@jcode.labs/ragmir).
For narrated summaries, use [Ragmir TTS](https://www.npmjs.com/package/@jcode.labs/ragmir-tts).

## Quick start with Ragmir Core

```bash
npm install --save-dev @jcode.labs/ragmir @jcode.labs/ragmir-chat
npx rgr setup
npx rgr sources add "docs/**/*.md"
npx rgr ingest
npx rgr chat setup --profile fast
npx rgr chat "What evidence supports this decision?" --offline
```

The first `rgr chat setup` downloads and verifies the selected model under
`.ragmir/models/chat/<profile>`. Normal chat requests reuse that local model and do not download a
runtime or model.

## Model profiles

| Profile | Use |
| --- | --- |
| `lite` | Smaller Qwen2.5 profile for lower-memory machines. |
| `fast` | Default Gemma 4 profile. |
| `quality` | Larger Gemma 4 profile, enabled only when explicitly selected. |

Verify a prepared model before taking a project offline:

```bash
npx rgr chat doctor --profile fast --verify
```

Copy the complete verified profile directory to another machine's ignored
`.ragmir/models/chat/<profile>` directory, then run the same doctor command there before using
`--offline`.

## Use the package directly

The package also exposes the `rgr-chat` command for applications that provide their own retrieval
context:

```bash
npx rgr-chat setup --profile fast
npx rgr-chat answer "What changed?" --context ./retrieved-context.txt --profile fast
```

Its TypeScript API exports `generateChatAnswer`, `setupChatModel`, `doctor`, the model profiles, and
the local runtime. Pass retrieved source passages to `generateChatAnswer` so the result can retain
source attribution.

## Privacy and runtime behavior

Chat selects an available local acceleration backend automatically. Visible answers retain citations;
raw model thought is not shown, logged, or stored. A normal prepared-model workflow stays local. Only
the explicit setup step downloads model files, and only on a connected machine.

## Further reading

- [Ragmir overview and Core setup](https://github.com/jcode-works/jcode-ragmir#readme)
- [Offline chat preparation](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/offline-chat-preload.md)
- [Configuration and privacy](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/configuration.md)
- [Troubleshooting](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/troubleshooting.md)

Ragmir Chat is open source under the [MIT License](https://github.com/jcode-works/jcode-ragmir/blob/main/LICENSE).
