# @jcode.labs/ragmir-chat

[![npm version](https://img.shields.io/npm/v/@jcode.labs/ragmir-chat)](https://www.npmjs.com/package/@jcode.labs/ragmir-chat)
[![npm downloads](https://img.shields.io/npm/dm/@jcode.labs/ragmir-chat)](https://www.npmjs.com/package/@jcode.labs/ragmir-chat)
[![Node.js](https://img.shields.io/node/v/@jcode.labs/ragmir-chat)](https://www.npmjs.com/package/@jcode.labs/ragmir-chat)
[![MIT](https://img.shields.io/npm/l/@jcode.labs/ragmir-chat)](https://github.com/jcode-works/jcode-ragmir/blob/main/LICENSE)

Optional cited answer generation with a verified local GGUF model.

*Stop sending confidential documents directly to the cloud.*

Ragmir Chat accepts passages retrieved by Core, generates on the workstation, and validates the
visible citation markers. It does not discover or index project files by itself.

[Project overview](https://github.com/jcode-works/jcode-ragmir#readme) ·
[Offline chat guide](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/offline-chat-preload.md) ·
[API reference](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/api-reference.md#chat-cited-local-generation)

## Use Chat with Ragmir Core

Requires Node.js 20 or later and enough disk and memory for the selected model.

```bash
npm install --save-dev @jcode.labs/ragmir @jcode.labs/ragmir-chat
npx rgr setup
npx rgr sources add "README.md" "docs/**/*.md"
npx rgr ingest
npx rgr chat setup --profile fast
npx rgr chat "What evidence supports this decision?" --profile fast --offline
```

`rgr chat setup` downloads and verifies one model under `.ragmir/models/chat/<profile>`. Normal
generation uses that local file and rejects remote model resolution.

| Profile | Pinned model | Download | Thinking | Choose it when |
| --- | --- | --- | --- | --- |
| `lite` | Qwen2.5 0.5B Q4_K_M | ~0.49 GB | Off | Memory and startup time matter most |
| `fast` | Gemma 4 E2B Q4_0 | ~3.35 GB | Standard or deep | You want the balanced default |
| `quality` | Gemma 4 E4B Q4_0 | ~5.15 GB | Standard or deep | You accept a larger model for stronger answers |

Use the same profile for `setup`, `doctor`, and each answer. The `fast` profile is the default;
`lite` always disables thinking. These are Chat profiles, not requirements of Ragmir Core, the CLI,
API, or MCP server. Verify a prepared profile with
`npx rgr chat doctor --profile fast --verify` before offline use.

## TypeScript API

```ts
import { generateChatAnswer, setupChatModel } from "@jcode.labs/ragmir-chat"

await setupChatModel({ profile: "lite" })

const result = await generateChatAnswer({
  question: "What changed in the rollout?",
  profile: "lite",
  sources: [
    {
      relativePath: "docs/rollout.md",
      chunkIndex: 0,
      text: "The rollout moved from Friday to Monday after the review.",
    },
  ],
})

console.log(result.answer, result.citationStatus)
```

If no usable source is supplied, the package returns an insufficient-context result without loading
a model. The result reports citation validity and model metadata; raw model thought is never
returned or persisted. Model output still needs human review for high-impact decisions.

Applications with their own retrieval layer can use `rgr-chat answer --context <file>`. The
standalone `rgr-chat serve` command exposes a local line-delimited JSON process, not an HTTP server.

## Privacy boundary

Normal generation sends retrieved passages only to the local model process. The explicit setup step
may download public model weights, never project documents. Keep model state and generated output
under ignored `.ragmir/` paths. A hosted agent that displays or consumes the answer remains subject
to that provider's data policy.

Read the [project documentation](https://github.com/jcode-works/jcode-ragmir/wiki) and
[troubleshooting guide](https://github.com/jcode-works/jcode-ragmir/blob/main/docs/troubleshooting.md)
for the complete workflow.

Ragmir Chat is open source under the [MIT License](https://github.com/jcode-works/jcode-ragmir/blob/main/LICENSE).
Selected GGUF models carry their own pinned license metadata.
